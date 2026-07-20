/**
 * A minimal, self-contained cron evaluator (Phase 8) — no cron-parsing
 * dependency exists anywhere in this monorepo (confirmed by research before
 * this phase started), and adding a new dependency for standard 5-field
 * cron matching is more than this phase needs. Supports a wildcard, exact
 * numbers, comma lists, and step values (wildcard followed by a slash and a
 * number, e.g. every-5-minutes) — NOT ranges (e.g. one-through-five) — a
 * deliberate, documented scope limit, not an oversight. Time-zone aware via
 * `Intl.DateTimeFormat`'s `timeZone` option, so "every Monday 9am
 * America/New_York" is evaluated against that zone's wall-clock fields, not
 * the server's local time or UTC. See docs/scheduling.md.
 */

export class InvalidCronExpressionError extends Error {}

interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

/** The sentinel `cronExpression` for a one-time schedule — `computeNextRunAt` returns a date far enough in the future that the atomic claim in `claimWorkflowSchedule` effectively retires it after firing once, without a separate pause code path. */
export const ONE_TIME_SENTINEL = 'ONCE';
const NEVER_AGAIN = new Date(8_640_000_000_000_000); // JS's actual max Date value

function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new InvalidCronExpressionError(`Expected 5 space-separated fields (minute hour day-of-month month day-of-week), got "${expression}".`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { minute: minute!, hour: hour!, dayOfMonth: dayOfMonth!, month: month!, dayOfWeek: dayOfWeek! };
}

function matchesField(field: string, value: number): boolean {
  if (field === '*') return true;

  for (const part of field.split(',')) {
    if (part.startsWith('*/')) {
      const step = Number(part.slice(2));
      if (Number.isFinite(step) && step > 0 && value % step === 0) return true;
      continue;
    }
    if (Number(part) === value) return true;
  }
  return false;
}

const WEEKDAY_INDEX: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function normalizeDayOfWeekField(field: string): string {
  return field.replace(/[A-Za-z]{3}/g, (token) => String(WEEKDAY_INDEX[token.toUpperCase()] ?? token));
}

interface LocalFields {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

function getLocalFields(date: Date, timezone: string): LocalFields {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24, // Intl reports midnight as "24" with hour12:false in some environments
    dayOfMonth: Number(get('day')),
    month: Number(get('month')),
    dayOfWeek: WEEKDAY_INDEX[get('weekday').toUpperCase()] ?? -1,
  };
}

function matches(fields: CronFields, local: LocalFields): boolean {
  return (
    matchesField(fields.minute, local.minute) &&
    matchesField(fields.hour, local.hour) &&
    matchesField(fields.dayOfMonth, local.dayOfMonth) &&
    matchesField(fields.month, local.month) &&
    matchesField(normalizeDayOfWeekField(fields.dayOfWeek), local.dayOfWeek)
  );
}

const MAX_LOOKAHEAD_MINUTES = 60 * 24 * 366; // just over a year — a schedule matching nothing within a year is a configuration error, not something to search forever.

/** Finds the next minute-boundary timestamp (strictly after `after`) at which `cronExpression` matches, in `timezone`. Throws `InvalidCronExpressionError` for a malformed expression, never silently returns a wrong time. */
export function computeNextRunAt(cronExpression: string, timezone: string, after: Date): Date {
  if (cronExpression === ONE_TIME_SENTINEL) return NEVER_AGAIN;

  const fields = parseCron(cronExpression);
  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i += 1) {
    if (matches(fields, getLocalFields(candidate, timezone))) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new InvalidCronExpressionError(`"${cronExpression}" (timezone "${timezone}") does not match any time within the next year.`);
}
