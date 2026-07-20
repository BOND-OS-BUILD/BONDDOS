import { csvParser } from './parsers/csv';
import { docxParser } from './parsers/docx';
import { pdfParser } from './parsers/pdf';
import { textParser } from './parsers/text';
import type { Parser } from './types';

/** Picks the first registered parser that claims to support a given file. Extensible via `.register()`. */
export class ParserRegistry {
  private parsers: Parser[] = [];

  register(parser: Parser): void {
    this.parsers.push(parser);
  }

  find(mimeType: string, fileName: string): Parser | undefined {
    return this.parsers.find((parser) => parser.supports(mimeType, fileName));
  }
}

export const defaultParserRegistry = new ParserRegistry();
defaultParserRegistry.register(pdfParser);
defaultParserRegistry.register(docxParser);
defaultParserRegistry.register(csvParser);
// Registered last: text/* is a broad mimeType prefix match, so more specific
// formats above (markdown is text/*, but .csv sometimes reports as text/csv
// too) get first refusal via their own checks before this catch-all.
defaultParserRegistry.register(textParser);
