'use client';

import { useCallback, useEffect, useState } from 'react';

import type { CommentableEntityType, CommentData } from '@bond-os/database';
import { Avatar, AvatarFallback, AvatarImage, Badge, EmptyState, toast } from '@bond-os/ui';
import { MessageSquare } from 'lucide-react';

import { MarkdownMessage } from '@/features/bond/components/markdown-message';

import { CommentComposer } from './comment-composer';

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function CommentRow({
  comment,
  organizationId,
  entityType,
  entityId,
  currentUserId,
  depth,
  onChanged,
}: {
  comment: CommentData;
  organizationId: string;
  entityType: CommentableEntityType;
  entityId: string;
  currentUserId: string;
  depth: number;
  onChanged: () => void;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const isAuthor = comment.author.id === currentUserId;

  async function handleResolveToggle() {
    setIsPending(true);
    try {
      const response = await fetch(`/api/comments/${comment.id}/${comment.resolved ? 'unresolve' : 'resolve'}`, { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      onChanged();
    } finally {
      setIsPending(false);
    }
  }

  async function handleDelete() {
    setIsPending(true);
    try {
      const response = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      onChanged();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={depth > 0 ? 'ml-8 border-l border-border pl-4' : undefined}>
      <div className="flex items-start gap-3 py-3">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarImage src={comment.author.avatar ?? undefined} />
          <AvatarFallback>{comment.author.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{comment.author.name}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
            {comment.resolved && <Badge variant="success">Resolved</Badge>}
          </div>
          <div className="text-sm">
            <MarkdownMessage content={comment.content} />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => setIsReplying((open) => !open)}>
              Reply
            </button>
            <button type="button" className="text-muted-foreground hover:underline" onClick={handleResolveToggle} disabled={isPending}>
              {comment.resolved ? 'Unresolve' : 'Resolve'}
            </button>
            {isAuthor && (
              <button type="button" className="text-muted-foreground hover:underline" onClick={handleDelete} disabled={isPending}>
                Delete
              </button>
            )}
          </div>
          {isReplying && (
            <div className="pt-2">
              <CommentComposer
                organizationId={organizationId}
                entityType={entityType}
                entityId={entityId}
                parentCommentId={comment.id}
                autoFocus
                onCancel={() => setIsReplying(false)}
                onSubmitted={() => {
                  setIsReplying(false);
                  onChanged();
                }}
              />
            </div>
          )}
        </div>
      </div>
      {comment.replies.map((reply) => (
        <CommentRow
          key={reply.id}
          comment={reply}
          organizationId={organizationId}
          entityType={entityType}
          entityId={entityId}
          currentUserId={currentUserId}
          depth={depth + 1}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

export function CommentThread({
  organizationId,
  entityType,
  entityId,
  currentUserId,
}: {
  organizationId: string;
  entityType: CommentableEntityType;
  entityId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = useState<CommentData[] | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/comments?entityType=${entityType}&entityId=${entityId}&page=1&pageSize=50`);
    const result = await response.json();
    if (result.success) {
      setComments(result.data.items);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4" /> Comments
      </h3>
      <CommentComposer organizationId={organizationId} entityType={entityType} entityId={entityId} onSubmitted={load} />
      {comments === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : comments.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No comments yet" description="Be the first to add one." />
      ) : (
        <div className="divide-y divide-border">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              organizationId={organizationId}
              entityType={entityType}
              entityId={entityId}
              currentUserId={currentUserId}
              depth={0}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
