import 'server-only';

import pino from 'pino';

import { getEnv } from './env';

const isProd = () => getEnv().NODE_ENV === 'production';

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
