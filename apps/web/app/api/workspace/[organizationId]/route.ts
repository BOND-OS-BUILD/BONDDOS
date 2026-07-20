import { requireRole } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

import { apiHandler, apiSuccess } from '@/lib/api-handler';

type Context = { params: Promise<{ organizationId: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { organizationId } = await params;
  await requireRole(organizationId, ROLES.MEMBER);

  const workspace = await prisma.workspace.findUnique({ where: { organizationId } });
  if (!workspace) {
    throw new NotFoundError('Workspace not found.');
  }

  return apiSuccess(workspace);
});
