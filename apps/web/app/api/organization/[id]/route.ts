import { requireRole } from '@bond-os/auth';
import { Prisma, prisma } from '@bond-os/database';
import { ConflictError, NotFoundError, ROLES, updateOrganizationSchema } from '@bond-os/shared';

import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  await requireRole(id, ROLES.MEMBER);

  const organization = await prisma.organization.findUnique({ where: { id } });
  if (!organization) {
    throw new NotFoundError('Organization not found.');
  }

  return apiSuccess(organization);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await requireRole(id, ROLES.ADMIN);
  const body = await parseJsonBody(request, updateOrganizationSchema);

  try {
    const updated = await prisma.organization.update({
      where: { id },
      data: { name: body.name, slug: body.slug, logo: body.logo },
    });
    return apiSuccess(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('That slug is already taken.');
    }
    throw error;
  }
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await requireRole(id, ROLES.OWNER);

  await prisma.organization.delete({ where: { id } });

  return apiSuccess({ id });
});
