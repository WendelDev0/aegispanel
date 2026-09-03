import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Validates req.body against a Zod schema before the route handler runs.
 *
 * Routes used to sprinkle ad-hoc typeof/length checks that drifted out of
 * sync with the UI. Centralising the schema keeps the failure message
 * Portuguese and rejects unknown fields early.
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: formatZodError(result.error),
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

function formatZodError(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'Payload inválido.';
  const where = first.path.length ? ` (${first.path.join('.')})` : '';
  return `Payload inválido${where}: ${first.message}`;
}
