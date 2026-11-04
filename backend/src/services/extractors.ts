/**
 * Document text extraction is platform specific: Node uses sandboxed child processes and the
 * browser uses a Web Worker. Parsing and validation of the extracted content is shared.
 */
export interface DocumentExtractors {
  /** Text of a text-based PDF of at most 25 pages; throws StatementError otherwise. */
  pdfText(pdf: Uint8Array): Promise<string>;
  /** Raw cell rows for each named worksheet, keyed by sheet name. */
  workbookSheets(
    xlsx: Uint8Array,
    sheets: readonly string[],
    limits?: { rows: number; columns: number },
  ): Promise<unknown>;
}

export class StatementError extends Error {
  readonly statusCode = 422;
}

export const pdfTextLimit = 500000;

export function startsWith(bytes: Uint8Array, prefix: readonly number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

export const unreadablePdf = () =>
  new StatementError(
    'Cannot read this PDF. It may be encrypted, damaged, or longer than 25 pages.',
  );
export const unreadableWorkbook = () =>
  new StatementError(
    'Cannot read this Questrade workbook. Use an unencrypted export with Balances and Positions sheets.',
  );
