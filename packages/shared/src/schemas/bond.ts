import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Phase 5 "Mr. Bond" — chat/settings/cost request validation. See docs/chat.md. */

export const AI_PROVIDER_IDS = ['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA'] as const;
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);

export const conversationQuerySchema = paginationQuerySchema.extend({
  archived: z.coerce.boolean().optional(),
});
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;

export const createConversationSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const messageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessageQuery = z.infer<typeof messageQuerySchema>;

/** The `/api/bond/chat` request body. `conversationId` omitted starts a new conversation. `model` is a per-message override (spec §9's Model Selector) — falls back to the organization's configured model, then the env default. */
export const sendBondMessageSchema = z.object({
  conversationId: z.string().min(1).optional(),
  content: z.string().trim().min(1, 'A message is required.').max(8000),
  model: z.string().trim().min(1).optional(),
});
export type SendBondMessageInput = z.infer<typeof sendBondMessageSchema>;

export const updateOrganizationAiSettingsSchema = z.object({
  provider: aiProviderIdSchema.nullable().optional(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  temperature: z.coerce.number().min(0).max(2).nullable().optional(),
  topP: z.coerce.number().min(0).max(1).nullable().optional(),
  maxTokens: z.coerce.number().int().positive().max(32_000).nullable().optional(),
  streamingEnabled: z.boolean().optional(),
  contextWindow: z.coerce.number().int().min(100).max(200_000).nullable().optional(),
  retrievalDepth: z.coerce.number().int().min(1).max(100).nullable().optional(),
});
export type UpdateOrganizationAiSettingsInput = z.infer<typeof updateOrganizationAiSettingsSchema>;

export const bondCostQuerySchema = z.object({
  conversationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  sinceDays: z.coerce.number().int().positive().max(365).default(30),
});
export type BondCostQuery = z.infer<typeof bondCostQuerySchema>;

export const archiveConversationsSchema = z.object({
  olderThanDays: z.coerce.number().int().positive().max(3650).optional(),
});
export type ArchiveConversationsInput = z.infer<typeof archiveConversationsSchema>;

/** Shared AI Sessions (Phase 9). Always to a specific org member — never public/cross-organization. See docs/shared-ai.md. */
export const sharePermissionSchema = z.enum(['READ', 'COLLABORATE']);

export const shareConversationSchema = z.object({
  sharedWithUserId: z.string().min(1),
  permission: sharePermissionSchema,
});
export type ShareConversationInput = z.infer<typeof shareConversationSchema>;

export const transferConversationOwnershipSchema = z.object({
  newOwnerId: z.string().min(1),
});
export type TransferConversationOwnershipInput = z.infer<typeof transferConversationOwnershipSchema>;
