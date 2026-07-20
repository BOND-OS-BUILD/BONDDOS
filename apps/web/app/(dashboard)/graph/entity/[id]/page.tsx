import Link from 'next/link';

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@bond-os/ui';

import { getNodeStyle, nodeHref } from '@/features/graph/lib/node-style';
import { getEntityDetailService, type EntityDetail } from '@/features/graph/services/graph.service';
import { requireActiveOrganizationId } from '@/lib/organization';

type RelationshipEdge = EntityDetail['relationships']['outgoing'][number];

function getLinkedRecord(metadata: unknown): { type: 'PROJECT' | 'MEETING'; id: string } | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  if (!('linkedRecordType' in metadata) || !('linkedRecordId' in metadata)) return null;
  const { linkedRecordType, linkedRecordId } = metadata as Record<string, unknown>;
  if (linkedRecordType !== 'PROJECT' && linkedRecordType !== 'MEETING') return null;
  if (typeof linkedRecordId !== 'string') return null;
  return { type: linkedRecordType, id: linkedRecordId };
}

function RelationshipRow({ edge, direction }: { edge: RelationshipEdge; direction: 'outgoing' | 'incoming' }) {
  const other = direction === 'outgoing' ? edge.targetEntity : edge.sourceEntity;
  const style = getNodeStyle(other.entityType);
  const Icon = style.icon;
  const href = nodeHref(other.entityType, other.id);

  return (
    <div className="flex items-center gap-2 text-sm">
      <Badge variant="secondary">{edge.relationshipType}</Badge>
      <span className="text-xs text-muted-foreground">{Math.round(edge.confidence * 100)}%</span>
      <Icon className="h-4 w-4 shrink-0" style={{ color: style.color }} />
      {href ? (
        <Link href={href} className="truncate underline underline-offset-4">
          {other.title}
        </Link>
      ) : (
        <span className="truncate">{other.title}</span>
      )}
    </div>
  );
}

export default async function EntityViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const detail = await getEntityDetailService(organizationId, id);

  const style = getNodeStyle(detail.type);
  const linkedRecord = getLinkedRecord(detail.metadata);
  const { outgoing, incoming } = detail.relationships;
  const hasRelationships = outgoing.length > 0 || incoming.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.title}</h1>
          <Badge variant="outline">{style.label}</Badge>
        </div>
        {detail.description ? <p className="max-w-2xl text-sm text-muted-foreground">{detail.description}</p> : null}
        {linkedRecord ? (
          <p className="text-sm">
            <Link
              href={linkedRecord.type === 'PROJECT' ? `/projects/${linkedRecord.id}` : `/meetings/${linkedRecord.id}`}
              className="text-muted-foreground underline underline-offset-4"
            >
              Linked to the real {linkedRecord.type === 'PROJECT' ? 'Project' : 'Meeting'} record →
            </Link>
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relationships</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasRelationships ? (
              <p className="text-sm text-muted-foreground">No relationships yet.</p>
            ) : (
              <>
                {outgoing.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Outgoing</p>
                    <div className="space-y-2">
                      {outgoing.map((edge) => (
                        <RelationshipRow key={edge.id} edge={edge} direction="outgoing" />
                      ))}
                    </div>
                  </div>
                ) : null}
                {incoming.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Incoming</p>
                    <div className="space-y-2">
                      {incoming.map((edge) => (
                        <RelationshipRow key={edge.id} edge={edge} direction="incoming" />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.timeline.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              detail.timeline.items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline">{item.eventType}</Badge>
                    <span>{item.description}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
