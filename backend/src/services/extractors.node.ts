import { spawn } from 'node:child_process';
import { z } from 'zod';
import {
  pdfTextLimit,
  StatementError,
  unreadablePdf,
  unreadableWorkbook,
  type DocumentExtractors,
} from './extractors.js';

const pdfWorker = `
  const { PDFParse } = require('pdf-parse');
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', async () => {
    let parser;
    try {
      parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)), stopAtErrors: true, verbosity: 0 });
      const result = await parser.getText({ first: 1, last: 25 });
      if (result.total > 25 || result.text.length > ${pdfTextLimit}) throw new Error('Statement too large');
      process.stdout.write(JSON.stringify({ text: result.text }));
    } catch { process.exitCode = 1; }
    finally { if (parser) await parser.destroy(); }
  });
`;

const workbookWorker = (sheets: readonly string[]) => `
  const { readSheet } = require('read-excel-file/node');
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', async () => {
    try {
      const result = {};
      for (const name of ${JSON.stringify(sheets)}) {
        const rows = await readSheet(Buffer.concat(chunks), name, { parseNumber: value => value });
        if (rows.length > 502 || rows.some(row => row.length > 40)) throw new Error('Unsupported sheet');
        result[name] = rows;
      }
      process.stdout.write(JSON.stringify(result));
    } catch { process.exitCode = 1; }
  });
`;

let active = 0;

/** Runs untrusted-document parsing in a memory-capped, time-limited child process. */
async function sandboxed(code: string, input: Uint8Array, unreadable: () => StatementError) {
  if (active >= 2) throw new StatementError('The document parser is busy. Please retry shortly.');
  active++;
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=128', '--input-type=commonjs', '-e', code],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
      );
      let text = '';
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new StatementError('Document parsing timed out. Use a smaller export.');
        child.kill();
      }, 15000);
      child.stdout.on('data', (data: Buffer) => {
        text += data.toString('utf8');
        if (text.length > 1000000) {
          failure = new StatementError('Document content exceeds the supported size.');
          child.kill();
        }
      });
      child.stdin.on('error', () => {
        failure = new StatementError('The document could not be sent to the parser.');
      });
      child.on('error', () => {
        failure = new StatementError('The document parser could not be started.');
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (exitCode !== 0) reject(unreadable());
        else resolve(text);
      });
      child.stdin.end(input);
    });
    try {
      return JSON.parse(output) as unknown;
    } catch {
      throw unreadable();
    }
  } finally {
    active--;
  }
}

export const nodeExtractors: DocumentExtractors = {
  async pdfText(pdf) {
    const parsed = z
      .object({ text: z.string().max(pdfTextLimit) })
      .safeParse(await sandboxed(pdfWorker, pdf, unreadablePdf));
    if (!parsed.success) throw unreadablePdf();
    return parsed.data.text;
  },
  workbookSheets: (xlsx, sheets) => sandboxed(workbookWorker(sheets), xlsx, unreadableWorkbook),
};
