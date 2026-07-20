import type { TextMatch } from './types';

const COMPANY_SUFFIX = 'Inc|LLC|Ltd|Corp|Corporation|Co|Company|Group|Technologies|Tech|Solutions|Partners';

/** One or more capitalized words ending in a recognized company suffix. */
const COMPANY_PATTERN = new RegExp(
  `\\b[A-Z][\\w&]*(?:\\s+(?:&|and|[A-Z][\\w&]*))*\\s+(?:${COMPANY_SUFFIX})\\.?\\b`,
  'g',
);

export function extractCompanyNames(text: string): TextMatch[] {
  const matches: TextMatch[] = [];
  for (const match of text.matchAll(COMPANY_PATTERN)) {
    if (match.index === undefined) continue;
    matches.push({ value: match[0].trim(), offset: match.index });
  }
  return matches;
}
