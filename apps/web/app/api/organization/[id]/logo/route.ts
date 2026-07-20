import { requireRole } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { ROLES, ValidationError } from '@bond-os/shared';

import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { uploadPublicFile } from '@/lib/supabase';

type Context = { params: Promise<{ id: string }> };

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await requireRole(id, ROLES.ADMIN);

  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    throw new ValidationError('A file is required.');
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    throw new ValidationError('File must be a PNG, JPEG, or WebP image.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ValidationError('File must be smaller than 5MB.');
  }

  const filename = `${id}-${crypto.randomUUID()}.${ext}`;
  const result = await uploadPublicFile('logos', filename, file);

  await prisma.organization.update({
    where: { id },
    data: { logo: result.publicUrl },
  });

  return apiSuccess({ logo: result.publicUrl });
});
