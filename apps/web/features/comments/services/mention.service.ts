import { requireRole } from '@bond-os/auth';
import { listMentionsForUser, type MentionData } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';

/** A lighter-weight "mentioned in" lookup than the Inbox's own Notification-backed Mentions category (which has read/archive state) — see docs/comments.md. */
export async function listMentionsForUserService(
  organizationId: string,
  userId: string,
  page: number,
  pageSize: number,
): Promise<MentionData[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listMentionsForUser({ organizationId, userId, page, pageSize });
}
