import 'server-only';

import { z } from 'zod';

/**
 * Server-only, fail-fast environment validation. Import from
 * `@bond-os/shared/server` in server code only (route handlers, server
 * components, packages/auth, packages/database). Importing this from a
 * Client Component is a build-time error thanks to the `server-only` guard.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres:// connection string.'),

  BETTER_AUTH_SECRET: z
    .string()
    .min(1)
    .optional()
    .or(z.literal(''))
    .transform((value, ctx) => {
      const fallback = process.env.NEXTAUTH_SECRET;
      const resolved = value || fallback;
      if (!resolved || resolved.length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'BETTER_AUTH_SECRET (or legacy NEXTAUTH_SECRET) must be set to a random string of at least 16 characters.',
        });
        return z.NEVER;
      }
      return resolved;
    }),

  APP_URL: z.string().url().default('http://localhost:3000'),

  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_KEY: z.string().optional().or(z.literal('')),

  REDIS_URL: z.string().optional().or(z.literal('')),

  SMTP_HOST: z.string().optional().or(z.literal('')),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional().or(z.literal('')),
  SMTP_PASS: z.string().optional().or(z.literal('')),
  EMAIL_FROM: z.string().default('BOND OS <noreply@bondos.dev>'),

  // Phase 4 — AI Memory & Retrieval. Every provider key is optional: the
  // zero-config default (EMBEDDING_PROVIDER unset -> "local") means the
  // whole embedding pipeline works with no secrets configured at all, the
  // same "always have a working default" pattern as REDIS_URL/Cache above.
  // AI_PROVIDER has no working zero-config default (see
  // packages/ai/src/registry.ts's doc comment on why) — left unset/optional
  // here too, since nothing calls generate()/stream() this phase anyway.
  EMBEDDING_PROVIDER: z.enum(['LOCAL', 'OPENAI', 'GEMINI', 'VOYAGE', 'OLLAMA']).default('LOCAL'),
  EMBEDDING_MODEL: z.string().optional().or(z.literal('')),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  OPENAI_API_KEY: z.string().optional().or(z.literal('')),
  OPENAI_EMBEDDING_MODEL: z.string().optional().or(z.literal('')),
  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  VOYAGE_API_KEY: z.string().optional().or(z.literal('')),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),

  AI_PROVIDER: z
    .enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA'])
    .optional()
    .or(z.literal(''))
    .transform((value) => (value ? value : undefined)),
  AI_MODEL: z.string().optional().or(z.literal('')),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal('')),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(2048),

  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(8000),

  // Phase 5 — Mr. Bond AI Copilot. Both have working zero-config defaults —
  // Mr. Bond runs with neither set.
  BOND_MAX_TOOL_CALLS: z.coerce.number().int().min(0).max(10).default(3),
  MEMORY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // Phase 6 — Tool Execution Framework. How long an ApprovalRequest stays
  // PENDING before `expireStaleApprovalRequests` flags it EXPIRED.
  APPROVAL_EXPIRY_MINUTES: z.coerce.number().int().positive().default(15),

  // Phase 7 — Multi-Agent Architecture. The depth backstop on top of
  // `DelegationBudget.visitedAgentKeys`' own cycle detection — bounds long
  // acyclic delegation chains, not just A<->B ping-pong.
  AGENT_MAX_DELEGATION_DEPTH: z.coerce.number().int().min(0).max(10).default(3),

  // Phase 8 — Workflow Automation Platform. `publishEvent()` dispatches
  // synchronously and in-process — these bound one event's total dispatch
  // chain (mirrors BOND_MAX_TOOL_CALLS/AGENT_MAX_DELEGATION_DEPTH's own
  // "bounded work per turn" shape) so a triggering write's own HTTP request
  // can never be blocked for long, and a workflow that keeps re-triggering
  // itself can't run away before the cycle guard (WorkflowCyclicDispatchError)
  // even gets a chance to fire.
  WORKFLOW_MAX_SYNC_STEPS: z.coerce.number().int().min(0).max(100).default(20),
  WORKFLOW_MAX_SYNC_MS: z.coerce.number().int().min(0).max(30_000).default(5000),
  // Shared-secret header the tick endpoint (`POST /api/workflows/schedule/tick`)
  // requires, compared via `crypto.timingSafeEqual` — fails closed (404) if
  // unset. No default: an operator must deliberately set this to wire an
  // external caller (Vercel Cron, GitHub Actions, OS Task Scheduler) to the
  // tick URL. See docs/scheduling.md.
  CRON_SECRET: z.string().optional().or(z.literal('')),

  // ── Phase 10 — Operations, Observability & Administration ────────────────
  // Comma-separated allowlist of emails granted platform-admin (Admin Console)
  // access without the User.isPlatformAdmin DB flag — the bootstrap path for
  // the first administrator. See packages/auth/src/admin.ts.
  PLATFORM_ADMIN_EMAILS: z.string().optional().or(z.literal('')),
  // Fallback rate limit applied when no RateLimitPolicy row matches a scope
  // (mirrors the *_MAX_* knob precedent). See rate-limit.service.
  RATE_LIMIT_DEFAULT_LIMIT: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_DEFAULT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Retention windows (days) for the observability tables, used by the ops
  // cleanup routine. 0 disables cleanup for that table.
  ERROR_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  USAGE_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  SECURITY_EVENT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  SEARCH_LOG_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  // Default per-organization storage soft-limit (MB), surfaced by metering.
  STORAGE_LIMIT_MB: z.coerce.number().int().positive().default(1024),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `\n❌ Invalid environment variables:\n${formatted}\n\nCheck your .env file against .env.example.\n`,
    );
  }

  return parsed.data;
}

let cached: Env | undefined;

/** Validated, typed environment. Parsed lazily and cached on first access. */
export function getEnv(): Env {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
