/**
 * Mentions are parsed from a STRUCTURED token the client's `@`-autocomplete
 * inserts into `Comment.content` — `@[Display Name](type:id)` — never from
 * free-text name-matching. This keeps parsing a plain regex, not an NLP
 * step: the client already resolved "who", this just extracts the id it
 * already resolved to. The extracted ids are still re-validated against the
 * caller's own organization by `comment.service.ts` before anything is
 * persisted — this parser never itself decides a mention is valid. See
 * docs/comments.md.
 */

const MENTION_TOKEN = /@\[([^\]]+)\]\((user|space|agent):([a-zA-Z0-9_-]+)\)/g;

export type ParsedMentionType = 'USER' | 'SPACE' | 'AGENT';

export interface ParsedMention {
  label: string;
  type: ParsedMentionType;
  targetId: string;
}

export function parseMentions(content: string): ParsedMention[] {
  const seen = new Set<string>();
  const mentions: ParsedMention[] = [];

  for (const match of content.matchAll(MENTION_TOKEN)) {
    const [, label, rawType, targetId] = match;
    if (!label || !rawType || !targetId) continue;

    const type = rawType.toUpperCase() as ParsedMentionType;
    const key = `${type}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ label, type, targetId });
  }

  return mentions;
}
