import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';

import { AiSettingsForm } from '@/features/ai/components/ai-settings-form';
import { getModelManagementInfoService } from '@/features/ai/services/ai.service';
import { getOrganizationAiSettingsService } from '@/features/bond/services/ai-settings.service';
import { getActiveOrganization } from '@/lib/organization';

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default async function AiSettingsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.ADMIN);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Configuration</CardTitle>
          <CardDescription>Admins and owners can view AI configuration.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [info, currentSettings] = await Promise.all([
    getModelManagementInfoService(active.id),
    getOrganizationAiSettingsService(active.id),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Override Settings</CardTitle>
          <CardDescription>
            These override the environment defaults below when set. Clear a field to fall back to the
            environment default again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AiSettingsForm currentSettings={currentSettings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Provider</p>
            <div className="flex items-center gap-2">
              <p className="text-sm">{info.aiProvider ?? 'Not configured'}</p>
              <Badge variant={info.aiProviderConfigured ? 'success' : 'secondary'}>
                {info.aiProviderConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
          </div>
          <ReadOnlyField label="Active model" value={info.activeModel ?? 'Not configured'} />
          <ReadOnlyField label="Temperature" value={String(info.temperature)} />
          <ReadOnlyField label="Max tokens" value={String(info.maxTokens)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embeddings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Provider</p>
            <div className="flex items-center gap-2">
              <p className="text-sm">{info.embeddingProvider}</p>
              <Badge variant={info.embeddingProviderConfigured ? 'success' : 'secondary'}>
                {info.embeddingProviderConfigured ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
          </div>
          <ReadOnlyField label="Embedding model" value={info.embeddingModel} />
          <ReadOnlyField label="Context token budget" value={String(info.contextTokenBudget)} />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Configured via environment variables, unless overridden above.
      </p>
    </div>
  );
}
