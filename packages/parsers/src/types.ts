/**
 * Result of extracting plain text from a document. No AI/summarization —
 * this is pure format-level text extraction. `pages` is empty for formats
 * without a natural page concept (TXT/Markdown/CSV).
 */
export interface ParseResult {
  text: string;
  pages: string[];
  metadata: ParsedMetadata;
}

/** Best-effort metadata extracted directly from the file/format — never inferred by AI. */
export interface ParsedMetadata {
  title?: string;
  author?: string;
  creationDate?: string;
  language?: string;
  pageCount?: number;
  [key: string]: unknown;
}

export interface Parser {
  /** The human-readable format name, e.g. "PDF". */
  readonly format: string;
  supports(mimeType: string, fileName: string): boolean;
  parse(buffer: Buffer, fileName: string): Promise<ParseResult>;
}
