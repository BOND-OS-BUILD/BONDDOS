import { hashContent } from './hash';

export type ChunkKind = 'PARAGRAPH' | 'HEADING' | 'TABLE' | 'LIST' | 'CODE_BLOCK';

export interface TextChunk {
  chunkType: ChunkKind;
  /** Zero-based order within the document. */
  position: number;
  content: string;
  contentHash: string;
}

const HEADING_RE = /^#{1,6}\s+/;
const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s+/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const CODE_FENCE_RE = /^```/;

interface Block {
  type: ChunkKind;
  lines: string[];
}

/**
 * Heuristic structural chunker — no AI, no embeddings. Groups consecutive
 * lines of the same kind (paragraph/list/table) into one chunk, splits on
 * blank lines and markdown headings, and treats fenced code blocks as a
 * single chunk each. Good enough for plain text and markdown-ish content;
 * PDF/DOCX text (no markdown) mostly falls back to PARAGRAPH grouping by
 * blank line, which is still a meaningful structural split.
 */
export function chunkText(text: string): TextChunk[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];

  let current: Block | null = null;
  let inCodeBlock = false;

  const flush = () => {
    if (current && current.lines.some((line) => line.trim().length > 0)) {
      blocks.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    if (CODE_FENCE_RE.test(line.trim())) {
      if (inCodeBlock) {
        current?.lines.push(line);
        flush();
        inCodeBlock = false;
      } else {
        flush();
        inCodeBlock = true;
        current = { type: 'CODE_BLOCK', lines: [line] };
      }
      continue;
    }

    if (inCodeBlock) {
      current?.lines.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }

    const type: ChunkKind = HEADING_RE.test(line)
      ? 'HEADING'
      : TABLE_ROW_RE.test(line)
        ? 'TABLE'
        : LIST_ITEM_RE.test(line)
          ? 'LIST'
          : 'PARAGRAPH';

    if (type === 'HEADING') {
      // Each heading is always its own chunk.
      flush();
      blocks.push({ type, lines: [line] });
      continue;
    }

    if (current && current.type === type) {
      current.lines.push(line);
    } else {
      flush();
      current = { type, lines: [line] };
    }
  }
  flush();

  return blocks.map((block, index) => {
    const content = block.lines.join('\n').trim();
    return {
      chunkType: block.type,
      position: index,
      content,
      contentHash: hashContent(content),
    };
  });
}
