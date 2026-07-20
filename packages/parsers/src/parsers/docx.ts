import mammoth from 'mammoth';

import type { Parser } from '../types';

export const docxParser: Parser = {
  format: 'DOCX',

  supports(mimeType, fileName) {
    return (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.toLowerCase().endsWith('.docx')
    );
  },

  async parse(buffer) {
    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      pages: [],
      metadata: {},
    };
  },
};
