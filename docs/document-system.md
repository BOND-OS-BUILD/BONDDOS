# Document System

Covers file storage, parsing, chunking, and metadata extraction — the pipeline behind
`/library` (see docs/data-layer.md for why it's `/library`/`KnowledgeDocument`, not `/documents`).

## Upload pipeline

`createKnowledgeDocumentService` (`apps/web/features/library/services/library.service.ts`) runs the
whole thing **synchronously in one request** (no background workers this phase):

1. **Validate** — size (25MB cap) and MIME allowlist (PDF, DOCX, TXT, Markdown, CSV, PNG/JPEG/
   WebP/GIF — matching the spec's "Supported formats" for storage, which is wider than what's
   actually parseable; images upload and store fine but aren't parsed, see below).
2. **Virus scan** — `getVirusScanner().scan(buffer, fileName)`
   (`packages/shared/src/virus-scan.ts`). The default implementation always reports clean — a
   documented placeholder, not a real scanner. Swap the implementation before trusting uploads in
   production.
3. **Upload** — `uploadPublicFile('knowledge', ..., file)` (`apps/web/lib/supabase.ts`), a Supabase
   Storage bucket path distinct from Phase 1's `'documents'`/`'avatars'`/`'logos'` prefixes. See
   docs/storage.md.
4. **Persist** — `createKnowledgeDocument` (`packages/database/src/repositories/knowledge-
   documents.ts`) creates the `Entity` + `KnowledgeDocument` pair atomically via a Prisma nested
   write.
5. **Parse** — `defaultParserRegistry.find(mimeType, fileName)` (`packages/parsers`) picks a parser;
   if none matches (e.g. an image), `parseStatus` becomes `UNSUPPORTED`. On success, `parseStatus`
   becomes `PARSED` and `parsedText`/`parsedPages`/`parsedMetadata` are stored; on a thrown parser
   error, `FAILED` (logged, not surfaced as a request failure — the upload itself still succeeds,
   only parsing didn't).
6. **Chunk** — `chunkText(result.text)` (`packages/parsers`), persisted via `replaceChunks`.

`getQueue().enqueue('parse-knowledge-document', {...})` is also called to demonstrate the
Background Architecture queue interface (see docs/connectors.md) — it doesn't actually defer any
work; parsing already happened synchronously by the time this call returns.

## Parsers (`packages/parsers`)

```ts
interface Parser {
  readonly format: string;
  supports(mimeType: string, fileName: string): boolean;
  parse(buffer: Buffer, fileName: string): Promise<{ text: string; pages: string[]; metadata: ParsedMetadata }>;
}
```

Real, non-AI text extraction — no LLM calls anywhere in this package:

| Format | Library | Notes |
| --- | --- | --- |
| PDF | `pdf-parse` | Per-page text via a `pagerender` override; `info.Title`/`Author`/`CreationDate`/`numpages` become metadata. |
| DOCX | `mammoth` (`extractRawText`) | Plain text only — DOCX core-properties metadata (author, etc.) isn't extracted; a documented limitation, not a bug. |
| TXT / Markdown | none — `buffer.toString('utf-8')` | |
| CSV | `csv-parse/sync` | Rows joined as `col1 \| col2 \| ...` per line; `rowCount`/`columnCount` become metadata. |

`ParserRegistry.register(parser)` (`packages/parsers/src/registry.ts`) makes the set open for
extension — `defaultParserRegistry` is pre-populated with the four above. Add a new format by
writing a `Parser` and registering it; nothing else needs to change.

`pdf-parse` and `mammoth` are listed in `apps/web/next.config.ts`'s `serverExternalPackages` —
they're Node-oriented libraries with their own dynamic `require`s, the same class of webpack-
bundling issue Phase 0 hit with `pino`/`thread-stream`, avoided proactively here rather than
rediscovered.

## Chunking Engine (`packages/parsers/src/chunking.ts`)

`chunkText(text): TextChunk[]` — a heuristic structural chunker, not AI-based segmentation:

- Blank lines separate `PARAGRAPH` chunks.
- Lines starting with `#`–`######` become their own `HEADING` chunk.
- Lines starting with `-`/`*`/`+`/`1.` group into `LIST` chunks.
- Lines matching `| ... |` group into `TABLE` chunks.
- Triple-backtick fences become a single `CODE_BLOCK` chunk.

Each chunk gets a `sha256` `contentHash` (`packages/parsers/src/hash.ts`) so a future re-sync can
detect which chunks actually changed. No embeddings are computed or stored — `Chunk` has no vector
column; "prepare for vector search later" is satisfied by the table being shaped correctly for one
to be added in a future migration, not by adding an unused pgvector dependency now.

## Metadata Extractor

There's no separate "extractor" module — metadata extraction is a property of each `Parser`'s
`parse()` output (`ParsedMetadata`: title/author/creationDate/language/pageCount, plus format-
specific extras like CSV's rowCount). File-level metadata (size, extension, MIME type, last
modified) comes directly from the uploaded `File` object and Prisma's own `updatedAt`, not from
parsing. `GET /api/library/documents/[id]/metadata` exposes this as its own sub-resource.

## Chunking / metadata as REST resources

Per the spec's API section naming "Metadata" and "Chunking" as their own endpoint groups:

- `GET /api/library/documents/[id]/chunks` — `{ chunkCount, chunks }`.
- `GET /api/library/documents/[id]/metadata` — `{ fileName, mimeType, size, parseStatus, extracted }`.

Both are thin views over the same `KnowledgeDocument` detail already returned by `GET /api/library/
documents/[id]` — separate endpoints exist for REST-resource clarity, not because the underlying
data is fetched differently.
