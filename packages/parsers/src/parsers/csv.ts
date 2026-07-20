import { parse } from 'csv-parse/sync';

import type { Parser } from '../types';

export const csvParser: Parser = {
  format: 'CSV',

  supports(mimeType, fileName) {
    return mimeType === 'text/csv' || fileName.toLowerCase().endsWith('.csv');
  },

  async parse(buffer) {
    const records = parse(buffer, {
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][];

    const text = records.map((row) => row.join(' | ')).join('\n');

    return {
      text,
      pages: [],
      metadata: {
        rowCount: records.length,
        columnCount: records[0]?.length ?? 0,
      },
    };
  },
};
