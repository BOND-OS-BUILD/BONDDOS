import { createHash } from 'node:crypto';

/** Content-addressable hash used by Chunk.contentHash for future change detection on re-sync. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
