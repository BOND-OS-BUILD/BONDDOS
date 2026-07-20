'use client';

import { useEffect, useRef, useState } from 'react';

import type { CommentableEntityType } from '@bond-os/database';
import { Button, Textarea, toast } from '@bond-os/ui';
import { AtSign } from 'lucide-react';

interface OrgMember {
  userId: string;
  name: string;
}

export function CommentComposer({
  organizationId,
  entityType,
  entityId,
  parentCommentId,
  onSubmitted,
  onCancel,
  autoFocus,
}: {
  organizationId: string;
  entityType: CommentableEntityType;
  entityId: string;
  parentCommentId?: string;
  onSubmitted: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [content, setContent] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!showMentionPicker || members !== null) return;
    fetch(`/api/organization/${organizationId}/members`)
      .then((response) => response.json())
      .then((result) => {
        if (result.success) {
          setMembers(result.data.map((member: { userId: string; name: string }) => ({ userId: member.userId, name: member.name })));
        }
      })
      .catch(() => setMembers([]));
  }, [showMentionPicker, members, organizationId]);

  function insertMention(member: OrgMember) {
    const token = `@[${member.name}](user:${member.userId}) `;
    setContent((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${token}`);
    setShowMentionPicker(false);
    textareaRef.current?.focus();
  }

  async function handleSubmit() {
    if (!content.trim()) return;
    setIsPending(true);
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId, content, parentCommentId }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setContent('');
      onSubmitted();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Write a comment… use @ to mention someone"
        rows={parentCommentId ? 2 : 3}
        autoFocus={autoFocus}
      />
      {showMentionPicker && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-input bg-popover p-1 shadow-md">
          {members === null ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">No members found.</p>
          ) : (
            members.map((member) => (
              <button
                key={member.userId}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                onClick={() => insertMention(member)}
              >
                {member.name}
              </button>
            ))
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowMentionPicker((open) => !open)}>
          <AtSign className="mr-1 h-3.5 w-3.5" />
          Mention
        </Button>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="button" size="sm" onClick={handleSubmit} disabled={isPending || !content.trim()}>
            {isPending ? 'Posting…' : parentCommentId ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
