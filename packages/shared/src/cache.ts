import 'server-only';

import type { Redis } from 'ioredis';

import { getEnv } from './env';
import { logger } from './logger';

/**
 * Minimal cache abstraction. Ships with a zero-config in-memory
 * implementation; set REDIS_URL to transparently switch to Redis without
 * touching call sites. This is infrastructure only — nothing in Phase 0
 * actually needs caching yet, but future modules (Search, Memory) will.
 */
export interface Cache {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

class InMemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt: number | null }>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
}

class RedisCache implements Cache {
  private clientPromise: Promise<Redis>;

  constructor(url: string) {
    this.clientPromise = import('ioredis').then(({ default: RedisClient }) => new RedisClient(url));
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const client = await this.clientPromise;
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const client = await this.clientPromise;
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await client.set(key, raw, 'EX', ttlSeconds);
    } else {
      await client.set(key, raw);
    }
  }

  async del(key: string): Promise<void> {
    const client = await this.clientPromise;
    await client.del(key);
  }

  async has(key: string): Promise<boolean> {
    const client = await this.clientPromise;
    return (await client.exists(key)) === 1;
  }
}

let instance: Cache | undefined;

export function getCache(): Cache {
  if (!instance) {
    const { REDIS_URL } = getEnv();
    if (REDIS_URL) {
      logger.info('Cache backend: redis');
      instance = new RedisCache(REDIS_URL);
    } else {
      logger.info('Cache backend: in-memory (set REDIS_URL to use Redis)');
      instance = new InMemoryCache();
    }
  }
  return instance;
}
