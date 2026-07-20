import { extractCompanyNames } from './companies';
import { extractMeetingMentions, extractProjectMentions } from './mentions';
import { extractPersonNames } from './names';
import { extractDates, extractEmails, extractFileReferences, extractPhones, extractUrls } from './regex';
import type { ExtractionResult } from './types';

export * from './types';
export { extractCompanyNames } from './companies';
export { extractMeetingMentions, extractProjectMentions } from './mentions';
export { extractPersonNames } from './names';
export { extractDates, extractEmails, extractFileReferences, extractPhones, extractUrls } from './regex';

/**
 * Runs every extractor over one block of text. Purely rule-based
 * (regex/dictionary/heuristic) — no AI, no ML, no embeddings. Imprecision
 * (missed or over-matched names/companies) is expected and documented, not
 * hidden — see docs/entity-resolution.md.
 */
export function extractCandidates(text: string): ExtractionResult {
  return {
    emails: extractEmails(text),
    phones: extractPhones(text),
    urls: extractUrls(text),
    dates: extractDates(text),
    fileReferences: extractFileReferences(text),
    personNames: extractPersonNames(text),
    companyNames: extractCompanyNames(text),
    projectMentions: extractProjectMentions(text),
    meetingMentions: extractMeetingMentions(text),
  };
}
