import { getEnv, logger } from '@bond-os/shared/server';
import { createClient } from '@supabase/supabase-js';

const log = logger.child('storage');

/** The single public bucket used for user avatars and organization logos. */
const BUCKET = 'bondos-public';

let client: ReturnType<typeof createClient> | null | undefined;

/** Server-only Supabase client, or `null` if Supabase isn't configured (SUPABASE_URL/SUPABASE_KEY unset). */
function getSupabaseClient() {
  if (client === undefined) {
    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      log.warn('Supabase Storage is not configured — file uploads will be rejected. Set SUPABASE_URL and SUPABASE_KEY to enable.');
      client = null;
    } else {
      client = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { auth: { persistSession: false } });
    }
  }
  return client;
}

export interface StorageHealth {
  configured: boolean;
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}

/**
 * Phase 10 — lightweight storage health probe for the health monitoring
 * subsystem. When Supabase isn't configured this is a benign
 * `configured:false, healthy:true` (uploads are simply disabled, not broken).
 */
export async function checkStorageHealth(): Promise<StorageHealth> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { configured: false, healthy: true, message: 'Storage not configured (uploads disabled).' };
  }
  const start = Date.now();
  try {
    const { error } = await supabase.storage.from(BUCKET).list('', { limit: 1 });
    const latencyMs = Date.now() - start;
    if (error) return { configured: true, healthy: false, latencyMs, message: error.message };
    return { configured: true, healthy: true, latencyMs };
  } catch (err) {
    return {
      configured: true,
      healthy: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Storage check failed.',
    };
  }
}

export interface UploadResult {
  path: string;
  publicUrl: string;
}

/**
 * Uploads a file to the shared public bucket under `folder/filename` and
 * returns its public URL. Used for avatar (`folder: "avatars"`), organization
 * logo (`folder: "logos"`), Knowledge Graph document (`folder: "documents"`),
 * Phase 2 Library (`folder: "knowledge"`), and Phase 9 comment attachment
 * (`folder: "comments"`) uploads.
 */
export async function uploadPublicFile(
  folder: 'avatars' | 'logos' | 'documents' | 'knowledge' | 'comments',
  filename: string,
  file: Blob,
): Promise<UploadResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured.');
  }

  const path = `${folder}/${filename}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/** Deletes a previously-uploaded file (e.g. when its owning record is deleted). Silently no-ops if Storage isn't configured. */
export async function deletePublicFile(path: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    log.error(`Failed to delete file "${path}": ${error.message}`);
  }
}

/** A time-limited signed URL for downloading/previewing a file directly (bypasses the public URL, works even for content you'd rather not make permanently public). */
export async function getSignedDownloadUrl(path: string, expiresInSeconds = 60 * 10): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured.');
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error(`Failed to create signed URL: ${error?.message ?? 'unknown error'}`);
  }
  return data.signedUrl;
}
