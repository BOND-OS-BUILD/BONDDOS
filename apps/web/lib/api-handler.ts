import { isAppError, ValidationError, type ApiResponse } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';
import { NextResponse } from 'next/server';
import type { output, ZodError, ZodType } from 'zod';

const log = logger.child('api');

/**
 * Wraps a Next.js Route Handler so any thrown `AppError` (see
 * `@bond-os/shared`), `ZodError`, or unexpected error is translated into a
 * consistent `ApiResponse` JSON envelope with the right HTTP status —
 * handlers can just `throw` instead of manually building error responses.
 */
export function apiHandler<Context = { params: Promise<Record<string, string>> }>(
  handler: (request: Request, context: Context) => Promise<Response>,
) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(request, error);
    }
  };
}

function isZodError(error: unknown): error is ZodError {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ZodError';
}

function toErrorResponse(request: Request, error: unknown): NextResponse<ApiResponse<never>> {
  if (isZodError(error)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: error.flatten() },
      },
      { status: 422 },
    );
  }

  if (isAppError(error)) {
    if (error.statusCode >= 500) {
      log.error(error.message, { code: error.code, path: new URL(request.url).pathname });
    }
    return NextResponse.json(
      { success: false, error: { code: error.code, message: error.message, details: error.details } },
      { status: error.statusCode },
    );
  }

  log.error('Unhandled API error', {
    path: new URL(request.url).pathname,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return NextResponse.json(
    { success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
    { status: 500 },
  );
}

/** Shorthand for a successful `ApiResponse` JSON body. */
export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data } satisfies ApiResponse<T>, init);
}

/**
 * Parses and validates a JSON request body against `schema`, or throws.
 * Bound as `S extends ZodType` (the schema's own concrete type) rather than
 * `ZodType<T>` with `T` inferred positionally — inferring `T` that way
 * through a generic re-binding loses `.default(...)`'s effect on field
 * optionality, so callers would see every defaulted field as optional even
 * though `.parse()` always fills it in. `output<S>` (zod's own extraction
 * utility) reports the precise, correct type.
 */
export async function parseJsonBody<S extends ZodType>(request: Request, schema: S): Promise<output<S>> {
  const json = await request.json().catch(() => {
    throw new ValidationError('Request body must be valid JSON.');
  });
  return schema.parse(json) as output<S>;
}

/**
 * Parses and validates a request's `?page=&pageSize=&search=&sort=...` query
 * string against `schema` (typically a `paginationQuerySchema.extend({...})`
 * from `@bond-os/shared`). Throws a `ZodError` (→ 422 via `apiHandler`) on
 * invalid values instead of silently falling back, so bad client input never
 * reaches the repository layer. See `parseJsonBody` above for why `S extends
 * ZodType` + `output<S>` is used instead of a positionally-inferred `T`.
 */
export function parseQueryParams<S extends ZodType>(request: Request, schema: S): output<S> {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams)) as output<S>;
}
