import { prisma } from '../client';

/**
 * One row per organization, every field nullable — a null field means "fall
 * back to the env-var default," not "unset the org default." See the schema
 * comment and docs/mr-bond.md.
 */
export interface OrganizationAiSettingsData {
  provider: string | null;
  model: string | null;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  streamingEnabled: boolean;
  contextWindow: number | null;
  retrievalDepth: number | null;
  updatedAt: Date;
}

export async function getOrganizationAiSettings(organizationId: string): Promise<OrganizationAiSettingsData | null> {
  return prisma.organizationAiSettings.findUnique({
    where: { organizationId },
    select: {
      provider: true,
      model: true,
      temperature: true,
      topP: true,
      maxTokens: true,
      streamingEnabled: true,
      contextWindow: true,
      retrievalDepth: true,
      updatedAt: true,
    },
  });
}

export interface UpsertOrganizationAiSettingsData {
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
  topP?: number | null;
  maxTokens?: number | null;
  streamingEnabled?: boolean;
  contextWindow?: number | null;
  retrievalDepth?: number | null;
  updatedById?: string | null;
}

export async function upsertOrganizationAiSettings(
  organizationId: string,
  data: UpsertOrganizationAiSettingsData,
): Promise<OrganizationAiSettingsData> {
  return prisma.organizationAiSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
    select: {
      provider: true,
      model: true,
      temperature: true,
      topP: true,
      maxTokens: true,
      streamingEnabled: true,
      contextWindow: true,
      retrievalDepth: true,
      updatedAt: true,
    },
  });
}
