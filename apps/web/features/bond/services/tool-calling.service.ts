import { listCustomersService } from '@/features/customers/services/customer.service';
import { listEmailsService } from '@/features/emails/services/email.service';
import { getDocumentRetrievalInfoService } from '@/features/retrieval/services/document-info.service';
import { getGraphAnalyticsService, getNeighborsService, getTimelineService } from '@/features/graph/services/graph.service';
import { getOrganizationMemoryService } from '@/features/retrieval/services/memory.service';
import { listMeetingsService } from '@/features/meetings/services/meeting.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { retrieve } from '@/features/retrieval/services/retrieval.service';

/**
 * Tool Calling — Read Only (spec §11-12). A prompt-marker convention
 * (`<<TOOL:name>>{...}`), not native per-provider function-calling — keeps
 * the Prompt Builder provider-independent (no per-provider `tools` wire
 * format to maintain) and lets tool dispatch be a single, fixed, hardcoded
 * switch. Every branch below calls an EXISTING, already org-scoped,
 * already read-only *Service function — never a bare repository export —
 * so every branch independently enforces its own `requireRole`, the same
 * "never trust a caller's pre-check alone" convention every other service
 * in this codebase follows. There is no code path from a tool call to any
 * DOMAIN-data write operation, which is the actual mechanism behind "NO
 * write operations," not just a prompt instruction. The one intentional
 * exception is audit logging: the `search` branch's `retrieve()` call (and
 * the pipeline's own end-of-turn call) writes an `AiAuditLog` row via
 * `logAiRequest` — bookkeeping, never a domain/business-data table.
 */

export const TOOL_NAMES = [
  'search',
  'graph',
  'timeline',
  'documents',
  'projects',
  'meetings',
  'customers',
  'emails',
  'analytics',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

const TOOL_MARKER = /<<TOOL:([a-zA-Z]+)>>\s*(\{[^\n]*\})/;

/** Scans a (non-streamed) planning turn for a single tool-call marker. Malformed markers (unknown tool name, invalid JSON) are treated as "no tool call" — the text is used as the final answer rather than crashing the pipeline. */
export function parseToolCall(text: string): ToolCall | null {
  const match = TOOL_MARKER.exec(text);
  if (!match) return null;

  const [, toolName, argsJson] = match;
  if (!toolName || !isToolName(toolName)) return null;

  try {
    const args = JSON.parse(argsJson!) as Record<string, unknown>;
    return { tool: toolName, args };
  } catch {
    return null;
  }
}

/** Strips a recognized tool-call marker out of a planning turn's text, so any prose the model wrote around it doesn't leak into the tool-result exchange. */
export function stripToolCall(text: string): string {
  return text.replace(TOOL_MARKER, '').trim();
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

const LIST_PAGE = { page: 1, pageSize: 10, sortDir: 'desc' as const };

/**
 * Executes exactly one tool call and returns its result serialized as a
 * string — appended as the tool's turn before the model is re-invoked.
 * `organizationId` is threaded into every branch; every callee already
 * enforces its own `requireRole`/org-scoping, matching the rest of this
 * codebase's convention of never trusting a caller's pre-check alone.
 *
 * `allowedTools` (Phase 7) is the caller's real permission boundary, not
 * just a prompt suggestion — a per-agent `supportedTools` allowlist means
 * nothing if any caller could still invoke any of the 9 tools regardless
 * of what the prompt told the model. `runBondChatPipeline` passes the full
 * `TOOL_NAMES` set (identical behavior to before this parameter existed);
 * specialist agents pass their own narrower `supportedTools`.
 */
export async function executeToolCall(organizationId: string, call: ToolCall, allowedTools: readonly ToolName[]): Promise<string> {
  if (!allowedTools.includes(call.tool)) {
    return JSON.stringify({ error: `Tool "${call.tool}" is not available to this agent.` });
  }

  switch (call.tool) {
    case 'search': {
      const results = await retrieve(organizationId, stringArg(call.args, 'query'), { limit: 10 });
      return JSON.stringify(results.map((result) => ({ ref: result.key, title: result.title, snippet: result.snippet })));
    }
    case 'graph': {
      const entityId = stringArg(call.args, 'entityId');
      if (!entityId) return JSON.stringify({ error: 'entityId is required.' });
      const neighbors = await getNeighborsService(organizationId, entityId);
      return JSON.stringify(neighbors.slice(0, 20));
    }
    case 'timeline': {
      const entityId = stringArg(call.args, 'entityId');
      if (!entityId) return JSON.stringify({ error: 'entityId is required.' });
      const timeline = await getTimelineService(organizationId, entityId, { page: 1, pageSize: 10 });
      return JSON.stringify(timeline.items);
    }
    case 'documents': {
      const knowledgeDocumentId = stringArg(call.args, 'documentId');
      if (!knowledgeDocumentId) return JSON.stringify({ error: 'documentId is required.' });
      const info = await getDocumentRetrievalInfoService(organizationId, knowledgeDocumentId);
      return JSON.stringify(info);
    }
    case 'projects': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listProjectsService(organizationId, { ...LIST_PAGE, search, sortBy: 'createdAt' });
      return JSON.stringify(results.items);
    }
    case 'meetings': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listMeetingsService(organizationId, { ...LIST_PAGE, search, sortBy: 'meetingDate' });
      return JSON.stringify(results.items);
    }
    case 'customers': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listCustomersService(organizationId, { ...LIST_PAGE, search, sortBy: 'createdAt' });
      return JSON.stringify(results.items);
    }
    case 'emails': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listEmailsService(organizationId, { ...LIST_PAGE, search, sortBy: 'sentAt' });
      return JSON.stringify(results.items);
    }
    case 'analytics': {
      const [graphAnalytics, orgMemory] = await Promise.all([
        getGraphAnalyticsService(organizationId),
        getOrganizationMemoryService(organizationId),
      ]);
      return JSON.stringify({ graphAnalytics, orgMemory });
    }
    default: {
      const exhaustive: never = call.tool;
      return JSON.stringify({ error: `Unknown tool: ${String(exhaustive)}` });
    }
  }
}
