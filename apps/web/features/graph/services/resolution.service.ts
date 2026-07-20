import { listPersonCandidates } from '@bond-os/database';

/**
 * Deterministic (no ML/embeddings) name resolution — collapses "John Smith",
 * "John", "Mr Smith", "J. Smith" into one entity when it's safe to do so.
 * See docs/entity-resolution.md.
 */

const HONORIFIC_PATTERN = /^(mr|mrs|ms|miss|dr|prof)\.?\s+/i;

function normalizeName(name: string): string {
  return name
    .replace(HONORIFIC_PATTERN, '')
    .replace(/[.,]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function nameParts(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

export interface PersonResolution {
  matchedEntityId: string | null;
}

/**
 * Match order: (1) exact normalized match, (2) last-name + first-initial
 * match ("J. Smith" vs "John Smith"), (3) first-name-only match — but only
 * when exactly one existing candidate shares that first name; an ambiguous
 * first name creates a new entity rather than guessing.
 */
export async function resolvePersonName(organizationId: string, rawName: string): Promise<PersonResolution> {
  const candidates = await listPersonCandidates(organizationId);
  const inputParts = nameParts(normalizeName(rawName));
  const inputFirst = inputParts[0];
  const inputLast = inputParts[inputParts.length - 1];

  if (!inputFirst) return { matchedEntityId: null };

  for (const candidate of candidates) {
    if (normalizeName(candidate.name) === normalizeName(rawName)) {
      return { matchedEntityId: candidate.id };
    }
  }

  if (inputParts.length >= 2 && inputLast) {
    const inputFirstInitial = inputFirst[0];
    for (const candidate of candidates) {
      const candidateParts = nameParts(normalizeName(candidate.name));
      if (candidateParts.length < 2) continue;
      const candidateLast = candidateParts[candidateParts.length - 1];
      const candidateFirstInitial = candidateParts[0]?.[0];
      if (candidateLast === inputLast && candidateFirstInitial === inputFirstInitial) {
        return { matchedEntityId: candidate.id };
      }
    }
  }

  if (inputParts.length === 1) {
    const matches = candidates.filter((candidate) => nameParts(normalizeName(candidate.name))[0] === inputFirst);
    const onlyMatch = matches.length === 1 ? matches[0] : undefined;
    if (onlyMatch) return { matchedEntityId: onlyMatch.id };
  }

  return { matchedEntityId: null };
}
