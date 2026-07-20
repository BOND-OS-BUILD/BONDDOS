import type { Parser } from '../types';

/** Plain-text formats: TXT and Markdown. No transformation, just UTF-8 decoding. */
export const textParser: Parser = {
  format: 'Text',

  supports(mimeType, fileName) {
    const lower = fileName.toLowerCase();
    return (
      mimeType.startsWith('text/') ||
      mimeType === 'text/markdown' ||
      lower.endsWith('.txt') ||
      lower.endsWith('.md') ||
      lower.endsWith('.markdown')
    );
  },

  async parse(buffer) {
    return {
      text: buffer.toString('utf-8'),
      pages: [],
      metadata: {},
    };
  },
};
