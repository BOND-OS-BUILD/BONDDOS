import type { TextMatch } from './types';

function matchAll(text: string, pattern: RegExp): TextMatch[] {
  const matches: TextMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    matches.push({ value: match[0].trim(), offset: match.index });
  }
  return matches;
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;
/** Matches common US/international formats: +1-555-123-4567, (555) 123-4567, 555.123.4567. */
const PHONE_PATTERN = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const FILE_REFERENCE_PATTERN = /\b[\w-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|md|png|jpe?g|gif)\b/gi;

const MONTH_NAMES =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO: 2026-07-18
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // US: 07/18/2026
  new RegExp(`\\b(?:${MONTH_NAMES})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'g'), // July 18, 2026
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_NAMES})\\s+\\d{4}\\b`, 'g'), // 18 July 2026
];

export function extractEmails(text: string): TextMatch[] {
  return matchAll(text, EMAIL_PATTERN);
}

export function extractUrls(text: string): TextMatch[] {
  return matchAll(text, URL_PATTERN);
}

export function extractPhones(text: string): TextMatch[] {
  return matchAll(text, PHONE_PATTERN);
}

export function extractFileReferences(text: string): TextMatch[] {
  return matchAll(text, FILE_REFERENCE_PATTERN);
}

export function extractDates(text: string): TextMatch[] {
  const results = DATE_PATTERNS.flatMap((pattern) => matchAll(text, pattern));
  return results.sort((a, b) => a.offset - b.offset);
}
