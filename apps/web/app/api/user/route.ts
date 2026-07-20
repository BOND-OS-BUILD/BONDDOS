import { requireAuth } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { updateProfileSchema } from '@bond-os/shared';

import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();

  return apiSuccess({
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.image,
    emailVerified: user.emailVerified,
  });
});

export const PATCH = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const body = await parseJsonBody(request, updateProfileSchema);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name: body.name, image: body.avatar },
  });

  return apiSuccess({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    avatar: updated.image,
    emailVerified: updated.emailVerified,
  });
});
