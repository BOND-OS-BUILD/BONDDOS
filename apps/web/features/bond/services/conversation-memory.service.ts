import { requireRole } from '@bond-os/auth';
import { getCitationRefsForConversation, getRecentMessages, type MessageItem } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';
import type { ChatMessage } from '@bond-os/ai';

import type { Citation } from '@/features/retrieval/services/citation.service';

/**
 * Conversation Memory (spec §5) — deterministic, distinct from Phase 4's
 * `retrieval/services/memory.service.ts` (entity/project/customer/org
 * memory, untouched and reused elsewhere). Every function here derives
 * facts from rows that already exist; nothing is generated. "No
 * hallucinated summaries" — Phase 4's own stated rule for memory — applies
 * identically to conversation summaries and entity memory below.
 */

const DEFAULT_HISTORY_TURNS = 10;

function toChatMessage(message: MessageItem): ChatMessage | null {
  if (message.role === 'USER') return { role: 'user', content: message.content };
  if (message.role === 'ASSISTANT') return { role: 'assistant', content: message.content };
  return null;
}

/** Recent conversation memory — the last N turns, oldest-first, as real `{role, content}` messages ready to splice into `buildPrompt`'s `conversationHistory` option. TOOL/SYSTEM rows (if ever persisted) are dropped — `ChatMessage` has no `tool` role. */
export async function getRecentConversationHistory(
  organizationId: string,
  conversationId: string,
  limit = DEFAULT_HISTORY_TURNS,
): Promise<ChatMessage[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const messages = await getRecentMessages(conversationId, organizationId, limit);
  return messages.map(toChatMessage).filter((message): message is ChatMessage => message !== null);
}

/** Extractive conversation summary — first user message (topic) + turn count + the most recent exchange, templated. No model call. */
export function summarizeConversation(messages: MessageItem[]): string {
  if (messages.length === 0) return 'No messages yet.';

  const firstUser = messages.find((message) => message.role === 'USER');
  const lastUser = [...messages].reverse().find((message) => message.role === 'USER');
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'ASSISTANT');

  const parts: string[] = [];
  if (firstUser) parts.push(`Started with: "${firstUser.content.slice(0, 140)}"`);
  parts.push(`${messages.length} message${messages.length === 1 ? '' : 's'} so far.`);
  if (lastUser && lastUser.id !== firstUser?.id) parts.push(`Most recently asked: "${lastUser.content.slice(0, 140)}"`);
  if (lastAssistant) parts.push(`Last answer: "${lastAssistant.content.slice(0, 140)}"`);

  return parts.join(' ');
}

/** "Important facts" / entity memory (spec §5) — every entity a conversation's citations have touched, deduplicated by title. A deterministic aggregation over `Message.citations`, not a second retrieval pass. */
export async function getConversationMemoryFacts(organizationId: string, conversationId: string): Promise<string[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const rawCitationLists = await getCitationRefsForConversation(conversationId, organizationId);

  const titles = new Set<string>();
  for (const rawList of rawCitationLists) {
    if (!Array.isArray(rawList)) continue;
    for (const entry of rawList as Citation[]) {
      const title = entry?.entityTitle ?? entry?.documentTitle;
      if (title) titles.add(title);
    }
  }

  return Array.from(titles).map((title) => `This conversation has previously discussed "${title}".`);
}
