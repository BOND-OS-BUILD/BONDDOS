import 'server-only';

import pino from 'pino';

/**
 * Read directly from `process.env`, not the zod-validated `getEnv()` — same
 * reasoning as `LOG_LEVEL` below: `NODE_ENV` is always set contextually by
 * Node/Next itself, and `logger` is imported by nearly every module in this
 * codebase, so routing it through `getEnv()` would force full-schema
 * validation (`DATABASE_URL`, `BETTER_AUTH_SECRET`, ...) just to construct a
 * logger — including during Next's build-time "Collecting page data" step,
 * which would then require production secrets to exist just to build.
 */
const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Centralized structured logger. Use `logger.child('scope')` to namespace
 * logs by subsystem — future modules (AI, agents, automations) should plug
 * into this same pipe rather than calling `console.*` directly.
 */
const root = pino({
  level: process.env.LOG_LEVEL ?? (isProd() ? 'info' : 'debug'),
  base: { service: 'bond-os' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isProd()
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      },
});

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  child: (scope: string) => Logger;
}

function wrap(instance: pino.Logger): Logger {
  return {
    info: (msg, meta) => instance.info(meta ?? {}, msg),
    warn: (msg, meta) => instance.warn(meta ?? {}, msg),
    error: (msg, meta) => instance.error(meta ?? {}, msg),
    debug: (msg, meta) => instance.debug(meta ?? {}, msg),
    child: (scope: string) => wrap(instance.child({ scope })),
  };
}

export const logger: Logger = wrap(root);
