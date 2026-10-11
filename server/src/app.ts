import fs from 'node:fs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config.js';
import { HttpError } from './api/http.js';
import { applierRoutes } from './api/routes/appliers.js';
import { reviewRoutes } from './api/routes/review.js';
import { setupRoutes } from './api/routes/setup.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message });
    const err = e instanceof Error ? e : new Error(String(e));
    const status = (e as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    req.log.error(err);
    console.error(err);
    return reply.code(500).send({ error: `Something went wrong on the server: ${err.message}` });
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(setupRoutes);
      await api.register(applierRoutes);
      await api.register(reviewRoutes);
      api.setNotFoundHandler((req, reply) => reply.code(404).send({ error: `No API route for ${req.method} ${req.url}` }));
    },
    { prefix: '/api' },
  );

  // Serve the built web app, with client-side routes falling back to index.html.
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
