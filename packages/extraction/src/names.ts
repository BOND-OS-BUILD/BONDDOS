import type { TextMatch } from './types';

const HONORIFIC = 'Mr|Mrs|Ms|Miss|Dr|Prof';

/**
 * Common capitalized words that would otherwise false-positive as a
 * `FirstName LastName` pair (sentence starts, days, months, salutations).
 * Rule-based extraction is expected to be imprecise — see
 * docs/entity-resolution.md — this list just trims the most common misses.
 */
const NAME_STOPWORDS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'dear',
  'hi',
  'hello',
  'regards',
  'sincerely',
  'best',
  'thanks',
  'thank',
  'project',
  'meeting',
  'notes',
  'subject',
  'from',
  'to',
  're',
  'fwd',
  'attached',
  'please',
  'note',
  'summary',
  'overview',
  'agenda',
]);

function isStopword(word: string): boolean {
  return NAME_STOPWORDS.has(word.toLowerCase());
}

const COMPANY_SUFFIX_LOOKAHEAD = /^\s*(?:Inc|LLC|Ltd|Corp|Co|Company|Group)\b/;

const TITLED_NAME_PATTERN = new RegExp(
  `\\b(?:${HONORIFIC})\\.?\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?\\b`,
  'g',
);
const INITIAL_NAME_PATTERN = /\b[A-Z]\.\s?[A-Z][a-z]+\b/g;
const FULL_NAME_PATTERN = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g;

/**
 * Deterministic `FirstName LastName` / `Mr. LastName` / `J. Smith` heuristic
 * — no NLP model. Titled and initial-based matches are trusted outright;
 * plain `Capitalized Capitalized` pairs are filtered against a stopword list
 * and rejected if immediately followed by a company suffix (that's a company
 * name, not a person — see `extractCompanyNames`).
 */
export function extractPersonNames(text: string): TextMatch[] {
  const byOffset = new Map<number, TextMatch>();

  for (const match of text.matchAll(TITLED_NAME_PATTERN)) {
    if (match.index === undefined) continue;
    byOffset.set(match.index, { value: match[0].trim(), offset: match.index });
  }

  for (const match of text.matchAll(INITIAL_NAME_PATTERN)) {
    if (match.index === undefined || byOffset.has(match.index)) continue;
    byOffset.set(match.index, { value: match[0].trim(), offset: match.index });
  }

  for (const match of text.matchAll(FULL_NAME_PATTERN)) {
    if (match.index === undefined || byOffset.has(match.index)) continue;

    const [first, second] = match[0].split(/\s+/);
    if (!first || !second || isStopword(first) || isStopword(second)) continue;

    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 20);
    if (COMPANY_SUFFIX_LOOKAHEAD.test(after)) continue;

    byOffset.set(match.index, { value: match[0].trim(), offset: match.index });
  }

  return Array.from(byOffset.values()).sort((a, b) => a.offset - b.offset);
}
