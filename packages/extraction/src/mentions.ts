import type { TextMatch } from './types';

const PROJECT_PATTERN_1 = /\bProject\s+[A-Z][\w-]*\b/g;
const PROJECT_PATTERN_2 = /\bthe\s+([A-Z][\w-]*)\s+project\b/gi;

/** Matches `"Project Phoenix"` and `"the Phoenix project"` (normalized to `"Phoenix Project"`). */
export function extractProjectMentions(text: string): TextMatch[] {
  const byOffset = new Map<number, TextMatch>();

  for (const match of text.matchAll(PROJECT_PATTERN_1)) {
    if (match.index === undefined) continue;
    byOffset.set(match.index, { value: match[0].trim(), offset: match.index });
  }

  for (const match of text.matchAll(PROJECT_PATTERN_2)) {
    if (match.index === undefined || byOffset.has(match.index) || !match[1]) continue;
    byOffset.set(match.index, { value: `${match[1]} Project`, offset: match.index });
  }

  return Array.from(byOffset.values()).sort((a, b) => a.offset - b.offset);
}

const MEETING_KEYWORDS = 'meeting|sync|standup|stand-up|kickoff|kick-off|review|retro|retrospective';
const MEETING_PATTERN_1 = new RegExp(
  `\\b[A-Z][\\w-]*(?:\\s+[A-Z][\\w-]*)?\\s+(?:${MEETING_KEYWORDS})\\b`,
  'g',
);
const MEETING_PATTERN_2 = /\b(?:meeting|sync)\s*:\s*([A-Z][\w\s-]{2,40})/gi;

/** Matches `"Roadmap Sync"` / `"Q3 Kickoff"` and `"Meeting: Roadmap Review"`. */
export function extractMeetingMentions(text: string): TextMatch[] {
  const byOffset = new Map<number, TextMatch>();

  for (const match of text.matchAll(MEETING_PATTERN_1)) {
    if (match.index === undefined) continue;
    byOffset.set(match.index, { value: match[0].trim(), offset: match.index });
  }

  for (const match of text.matchAll(MEETING_PATTERN_2)) {
    if (match.index === undefined || byOffset.has(match.index) || !match[1]) continue;
    byOffset.set(match.index, { value: match[1].trim(), offset: match.index });
  }

  return Array.from(byOffset.values()).sort((a, b) => a.offset - b.offset);
}
