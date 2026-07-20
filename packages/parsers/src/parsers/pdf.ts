import pdfParse from 'pdf-parse';

import type { Parser } from '../types';

/** Minimal shape of the pdf.js page proxy `pdf-parse` hands to `pagerender`. */
interface PdfJsPageProxy {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}

export const pdfParser: Parser = {
  format: 'PDF',

  supports(mimeType, fileName) {
    return mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  },

  async parse(buffer) {
    const pages: string[] = [];

    const data = await pdfParse(buffer, {
      pagerender: async (pageData: PdfJsPageProxy) => {
        const content = await pageData.getTextContent();
        const text = content.items.map((item) => item.str ?? '').join(' ');
        pages.push(text);
        return text;
      },
    });

    return {
      text: data.text,
      pages,
      metadata: {
        title: data.info?.Title || undefined,
        author: data.info?.Author || undefined,
        creationDate: data.info?.CreationDate || undefined,
        pageCount: data.numpages,
      },
    };
  },
};
