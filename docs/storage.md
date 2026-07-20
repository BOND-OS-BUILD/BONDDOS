# File Storage

Built on Supabase Storage, extending the client Phase 1 already set up
(`apps/web/lib/supabase.ts`) — additively, nothing existing changed.

## Operations

| Operation | Function | Notes |
| --- | --- | --- |
| Upload | `uploadPublicFile(folder, filename, file)` | `folder` is now `'avatars' \| 'logos' \| 'documents' \| 'knowledge'` — Phase 2 uploads use `'knowledge'`, a prefix distinct from Phase 1's `'documents'` (Phase 1's own file model, unrelated to `KnowledgeDocument`). |
| Delete | `deletePublicFile(path)` — **new** | Called by `deleteKnowledgeDocumentService` after the DB row is gone, so a delete can't leave an orphaned file if the DB delete fails first. Silently no-ops if Storage isn't configured (logs the failure, doesn't throw — a missing file during cleanup shouldn't block anything). |
| Download / Preview | `getSignedDownloadUrl(path, expiresInSeconds = 600)` — **new** | A time-limited signed URL (`supabase.storage.from(bucket).createSignedUrl`), not the permanent public URL — used by `GET /api/library/documents/[id]/download`, which returns `{ url }` for the client to open, rather than streaming the file through the Next.js server. |
| Metadata | Stored on `KnowledgeDocument`, not re-fetched from Storage | `fileName`/`mimeType`/`size` are captured from the uploaded `File` object at upload time and persisted in Postgres — no extra Storage API round-trip needed to display them. |

## Validation (Security §13)

Enforced in `apps/web/features/library/services/library.service.ts`, the same layer Phase 1's
avatar/document uploads validate in:

- **Size limit**: 25MB (`MAX_FILE_SIZE`).
- **MIME allowlist**: PDF, DOCX, TXT, Markdown, CSV, PNG/JPEG/WebP/GIF — matches the spec's
  "Supported formats" for storage (images are storable even though they're not parsed — see
  docs/document-system.md).
- **Organization isolation**: every repository function takes `organizationId` and every mutation is
  scoped by it (`updateMany`/`deleteMany`, never a bare `update`/`delete` by id alone) — the same
  pattern every Phase 1 repository already uses.
- **Virus scan**: `getVirusScanner().scan(buffer, fileName)` — a placeholder interface
  (`packages/shared/src/virus-scan.ts`) that always reports clean by default. This satisfies "virus
  scan interface placeholder" from the spec; it is **not** a real scan. Replace
  `NoopVirusScanner` with a real implementation (ClamAV, a hosted scanning API) before accepting
  untrusted uploads in production.

## Bucket layout

A single bucket (`bondos-public`, set in `apps/web/lib/supabase.ts`) with folder prefixes:

```
avatars/     Phase 0 — user profile pictures
logos/       Phase 1 — organization logos
documents/   Phase 1 — Document (project/meeting-scoped attachments)
knowledge/   Phase 2 — KnowledgeDocument (Library uploads)
```

Despite the "public" bucket name, downloads go through signed URLs
(`getSignedDownloadUrl`) rather than the bucket's public URL for Library content, so access isn't
purely bucket-policy-dependent — the app-level `requireRole` check on `GET /api/library/documents/
[id]/download` is what actually gates who can generate a download link.
