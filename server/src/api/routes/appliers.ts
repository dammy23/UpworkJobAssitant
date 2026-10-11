import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { appliers, jobMatches, jobs, materials, upworkAccounts } from '../../db/schema.js';
import { extractText } from '../../lib/extract.js';
import { applyFilters } from '../../pipeline/filters.js';
import { HeuristicLlm } from '../../pipeline/llm.js';
import { jobToPrompt, runApplier } from '../../pipeline/run.js';
import { FixtureJobSource } from '../../pipeline/sources/fixtures.js';
import { TEMPLATES } from '../../services/templates.js';
import { HttpError, notFound, parse } from '../http.js';
import { accountRef, applierSummaries, applierView, materialView } from '../views.js';

const nullableInt = (max: number) => z.number().int().min(0).max(max).nullable();
const terms = z.array(z.string().trim().min(1).max(100)).max(50);

export const ApplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  upworkAccountId: z.string().uuid('Choose an Upwork account'),
  aiProvider: z.enum(['groq', 'claude', 'openai', 'ollama']).nullable(),
  active: z.boolean(),
  category: z.string().trim().max(100).nullable(),
  roles: terms,
  keywords: terms,
  excludeKeywords: terms,
  jobType: z.enum(['any', 'fixed', 'hourly']),
  minFixedBudget: nullableInt(1_000_000),
  minHourlyRate: nullableInt(1000),
  experienceLevel: z.enum(['any', 'entry', 'intermediate', 'expert']),
  clientPaymentVerified: z.boolean(),
  clientMinHireRate: nullableInt(100),
  clientMinTotalSpend: nullableInt(100_000_000),
  maxProposals: nullableInt(1000),
  excludedCountries: terms,
  profileSummary: z.string().max(5000),
  tone: z.string().trim().min(1).max(100),
  maxWords: z.number().int().min(40).max(500),
  bidRate: nullableInt(1000),
  defaultDuration: z.string().trim().min(1).max(100).default('Less than 1 month'),
  drafterInstructions: z.string().max(2000),
  scoreThreshold: z.number().int().min(0).max(100),
  scheduleMinutes: z.number().int().min(15).max(24 * 60),
  telegramEnabled: z.boolean(),
});
export type ApplierInput = z.infer<typeof ApplierInputSchema>;

async function assertAccount(id: string) {
  const [acc] = await db.select({ id: upworkAccounts.id }).from(upworkAccounts).where(eq(upworkAccounts.id, id));
  if (!acc) throw new HttpError(400, 'That Upwork account no longer exists');
}

async function detail(id: string) {
  const [a] = await db.select().from(appliers).where(eq(appliers.id, id));
  if (!a) throw notFound('Applier');
  const [acc] = await db.select().from(upworkAccounts).where(eq(upworkAccounts.id, a.upworkAccountId));
  const mats = await db.select().from(materials).where(eq(materials.applierId, id)).orderBy(asc(materials.createdAt));
  return {
    ...applierView(a),
    account: acc ? accountRef(acc) : { id: a.upworkAccountId, name: 'Unknown account' },
    materials: mats.map(materialView),
  };
}

const RESUME_MAX = 10 * 1024 * 1024;

export async function applierRoutes(app: FastifyInstance) {
  app.get('/templates', async () => TEMPLATES);

  app.get('/appliers', async () => {
    const rows = await db.select().from(appliers).orderBy(asc(appliers.createdAt));
    return applierSummaries(rows);
  });

  app.get<{ Params: { id: string } }>('/appliers/:id', async (req) => detail(req.params.id));

  app.post('/appliers', async (req, reply) => {
    const input = parse(ApplierInputSchema, req.body);
    await assertAccount(input.upworkAccountId);
    const [row] = await db.insert(appliers).values(input).returning();
    reply.code(201);
    return detail(row.id);
  });

  app.put<{ Params: { id: string } }>('/appliers/:id', async (req) => {
    const input = parse(ApplierInputSchema, req.body);
    await assertAccount(input.upworkAccountId);
    const [row] = await db
      .update(appliers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(appliers.id, req.params.id))
      .returning();
    if (!row) throw notFound('Applier');
    return detail(row.id);
  });

  app.patch<{ Params: { id: string } }>('/appliers/:id/active', async (req) => {
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const [row] = await db
      .update(appliers)
      .set({ active, updatedAt: new Date() })
      .where(eq(appliers.id, req.params.id))
      .returning();
    if (!row) throw notFound('Applier');
    return (await applierSummaries([row]))[0];
  });

  app.delete<{ Params: { id: string } }>('/appliers/:id', async (req, reply) => {
    const mats = await db.select().from(materials).where(eq(materials.applierId, req.params.id));
    const deleted = await db.delete(appliers).where(eq(appliers.id, req.params.id)).returning();
    if (!deleted.length) throw notFound('Applier');
    for (const m of mats) if (m.storedName) fs.rm(path.join(config.uploadDir, m.storedName), { force: true }, () => {});
    reply.code(204);
  });

  app.post<{ Params: { id: string } }>('/appliers/:id/run', async (req) => {
    const [a] = await db.select({ id: appliers.id }).from(appliers).where(eq(appliers.id, req.params.id));
    if (!a) throw notFound('Applier');
    return runApplier(a.id);
  });

  /**
   * What the rules would do to the account's 50 most recent jobs. Uses scores already recorded
   * for a job; jobs never scored get a quick offline estimate. No paid LLM calls.
   */
  app.post('/appliers/preview', async (req) => {
    const input = parse(ApplierInputSchema.partial({ name: true, upworkAccountId: true }), req.body);
    let pool = await db.select().from(jobs).orderBy(desc(jobs.fetchedAt)).limit(50);
    if (pool.length === 0) {
      const sample = await new FixtureJobSource().search({ terms: [], category: null, limit: 50 });
      pool = sample.map((s, i) => ({
        ...s,
        id: `sample-${i}`,
        fetchedAt: new Date(),
        experienceLevel: s.experienceLevel,
      }));
    }
    const scored = pool.length
      ? await db
          .select({ jobId: jobMatches.jobId, score: jobMatches.score })
          .from(jobMatches)
          .where(and(inArray(jobMatches.jobId, pool.map((p) => p.id).filter((id) => !id.startsWith('sample-')))))
      : [];
    const known = new Map<string, number>();
    for (const s of scored) if (s.score != null) known.set(s.jobId, Math.max(known.get(s.jobId) ?? 0, s.score));
    const estimate = new HeuristicLlm();
    const ctx = {
      applier: {
        name: input.name ?? '',
        category: input.category,
        roles: input.roles,
        keywords: input.keywords,
        profileSummary: input.profileSummary,
        tone: input.tone,
        maxWords: input.maxWords,
        bidRate: input.bidRate,
        drafterInstructions: input.drafterInstructions,
      },
      resumeText: '',
      portfolio: [],
      hasVideo: false,
    };

    const items: { title: string; score: number | null; outcome: 'draft' | 'below' | 'skipped'; reason: string }[] = [];
    let passed = 0;
    let wouldDraft = 0;
    for (const j of pool) {
      const pj = jobToPrompt(j);
      const f = applyFilters(input, pj);
      if (!f.pass) {
        items.push({ title: j.title, score: null, outcome: 'skipped', reason: f.reason });
        continue;
      }
      passed++;
      const score = known.get(j.id) ?? (await estimate.score(ctx, pj)).score;
      const est = !known.has(j.id);
      if (score >= input.scoreThreshold) {
        wouldDraft++;
        items.push({ title: j.title, score, outcome: 'draft', reason: est ? 'Would be drafted (estimated score)' : 'Would be drafted' });
      } else {
        items.push({ title: j.title, score, outcome: 'below', reason: `Scored under ${input.scoreThreshold}` });
      }
    }
    // Drafts first, then near misses, then skips; keep the list short.
    const rank = { draft: 0, below: 1, skipped: 2 } as const;
    items.sort((a, b) => rank[a.outcome] - rank[b.outcome] || (b.score ?? 0) - (a.score ?? 0));
    return { sampled: pool.length, passed, wouldDraft, items: items.slice(0, 8) };
  });

  // ---- Materials ----
  async function requireApplier(id: string) {
    const [a] = await db.select({ id: appliers.id }).from(appliers).where(eq(appliers.id, id));
    if (!a) throw notFound('Applier');
  }

  app.post<{ Params: { id: string } }>('/appliers/:id/materials/resume', async (req, reply) => {
    await requireApplier(req.params.id);
    const file = await req.file({ limits: { fileSize: RESUME_MAX } });
    if (!file) throw new HttpError(400, 'Choose a file to upload');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'Resumes can be up to 10 MB');
    const text = await extractText(buffer, file.filename, file.mimetype).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const storedName = `${crypto.randomUUID()}${path.extname(file.filename).toLowerCase()}`;
    fs.mkdirSync(config.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadDir, storedName), buffer);
    const [m] = await db
      .insert(materials)
      .values({
        applierId: req.params.id,
        kind: 'resume',
        title: file.filename,
        description: text,
        fileName: file.filename,
        storedName,
        mimeType: file.mimetype,
        sizeBytes: buffer.length,
      })
      .returning();
    reply.code(201);
    return materialView(m);
  });

  app.post<{ Params: { id: string } }>('/appliers/:id/materials/video', async (req, reply) => {
    await requireApplier(req.params.id);
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw new HttpError(400, 'Choose a video to upload');
      if (!file.mimetype.startsWith('video/')) throw new HttpError(400, 'That file is not a video');
      const storedName = `${crypto.randomUUID()}${path.extname(file.filename).toLowerCase()}`;
      fs.mkdirSync(config.uploadDir, { recursive: true });
      const dest = path.join(config.uploadDir, storedName);
      await pipeline(file.file, fs.createWriteStream(dest));
      if (file.file.truncated) {
        fs.rmSync(dest, { force: true });
        throw new HttpError(413, 'Videos can be up to 200 MB. Use a link for longer ones.');
      }
      const [m] = await db
        .insert(materials)
        .values({
          applierId: req.params.id,
          kind: 'video',
          title: file.filename,
          fileName: file.filename,
          storedName,
          mimeType: file.mimetype,
          sizeBytes: fs.statSync(dest).size,
        })
        .returning();
      reply.code(201);
      return materialView(m);
    }
    const { url, title } = parse(z.object({ url: z.string().url('Enter a full link, starting with https://'), title: z.string().max(200).optional() }), req.body);
    const [m] = await db
      .insert(materials)
      .values({ applierId: req.params.id, kind: 'video', title: title || 'Intro video', url })
      .returning();
    reply.code(201);
    return materialView(m);
  });

  app.post<{ Params: { id: string } }>('/appliers/:id/materials/portfolio', async (req, reply) => {
    await requireApplier(req.params.id);
    const input = parse(
      z.object({
        title: z.string().trim().min(1, 'Give it a title').max(200),
        description: z.string().max(3000).default(''),
        useInProposals: z.boolean().default(true),
      }),
      req.body,
    );
    const [m] = await db.insert(materials).values({ applierId: req.params.id, kind: 'portfolio', ...input }).returning();
    reply.code(201);
    return materialView(m);
  });

  app.patch<{ Params: { id: string } }>('/materials/:id', async (req) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(20000).optional(),
        useInProposals: z.boolean().optional(),
      }),
      req.body,
    );
    const [m] = await db
      .update(materials)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(materials.id, req.params.id))
      .returning();
    if (!m) throw notFound('File');
    return materialView(m);
  });

  app.delete<{ Params: { id: string } }>('/materials/:id', async (req, reply) => {
    const [m] = await db.delete(materials).where(eq(materials.id, req.params.id)).returning();
    if (!m) throw notFound('File');
    if (m.storedName) fs.rmSync(path.join(config.uploadDir, m.storedName), { force: true });
    reply.code(204);
  });

  app.get<{ Params: { id: string } }>('/materials/:id/file', async (req, reply) => {
    const [m] = await db.select().from(materials).where(eq(materials.id, req.params.id));
    if (!m?.storedName) throw notFound('File');
    const file = path.join(config.uploadDir, m.storedName);
    if (!fs.existsSync(file)) throw notFound('File');
    reply.header('Content-Type', m.mimeType ?? 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${(m.fileName ?? 'file').replace(/"/g, '')}"`);
    return reply.send(fs.createReadStream(file));
  });
}
