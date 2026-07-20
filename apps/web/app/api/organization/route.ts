import { requireAuth } from '@bond-os/auth';
import { createOrganizationWithWorkspace, getOrganizationsForUser, Prisma } from '@bond-os/database';
import { ConflictError, createOrganizationSchema } from '@bond-os/shared';

import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  const organizations = await getOrganizationsForUser(user.id);
  return apiSuccess(organizations);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const body = await parseJsonBody(request, createOrganizationSchema);

  try {
    const organization = await createOrganizationWithWorkspace({
      name: body.name,
      slug: body.slug,
      ownerId: user.id,
    });
    return apiSuccess(organization, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('That slug is already taken.');
    }
    throw error;
  }
});
