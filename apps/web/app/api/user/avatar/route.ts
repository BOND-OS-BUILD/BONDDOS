import { requireAuth } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { ValidationError } from '@bond-os/shared';

import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { uploadPublicFile } from '@/lib/supabase';

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();

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

  const filename = `${user.id}-${crypto.randomUUID()}.${ext}`;
  const result = await uploadPublicFile('avatars', filename, file);

  await prisma.user.update({
    where: { id: user.id },
    data: { image: result.publicUrl },
  });

  return apiSuccess({ avatar: result.publicUrl });
});
