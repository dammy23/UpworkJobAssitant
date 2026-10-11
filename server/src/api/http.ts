import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Validates a request body, turning zod errors into a readable 400. */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const where = first?.path.length ? `${first.path.join('.')}: ` : '';
  throw new HttpError(400, `${where}${first?.message ?? 'Invalid request'}`);
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
