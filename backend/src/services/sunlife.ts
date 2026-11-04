import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import {
  moneyPattern,
  statementFileLimit,
  statementPreviewSchema,
  statementInvestmentSchema,
  type StatementInvestment,
} from '@studious/api';

export class StatementError extends Error {
  readonly statusCode = 422;
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function dateFrom(monthName: string, day: string, year: string) {
  const month = months.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
  const date = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!z.iso.date().safeParse(date).success || date < '1000-01-01') {
    throw new StatementError('The statement contains an invalid date.');
  }
  return date;
}

export function parseSunLifeInvestments(
  text: string,
  statementDate: string,
  closingAmount: string,
): StatementInvestment[] | null {
  const headings = [...text.matchAll(/\bMy investments\b/gi)];
  if (!headings.length) return null;
  if (headings.length !== 1)
    throw new StatementError(
      'Multiple investment sections were found. Use a single-plan statement.',
    );
  const section = text.slice(headings[0]!.index! + headings[0]![0].length);
  const end = section.search(/\bHow ongoing contributions are invested\b|-- \d+ of \d+ --/i);
  const table = end < 0 ? section : section.slice(0, end);
  const dates = [...table.matchAll(/\b(PRICE|VALUE)\s+ON\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/gi)];
  if (
    dates.length !== 2 ||
    new Set(dates.map((match) => match[1]!.toUpperCase())).size !== 2 ||
    dates.some((match) => dateFrom(match[2]!, match[3]!, match[4]!) !== statementDate)
  ) {
    throw new StatementError(
      'Investment price/value dates do not match the statement closing date.',
    );
  }
  const total = /\bTotal investments\s+\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?![\d.,])/i.exec(
    table,
  );
  if (!total) throw new StatementError('The investment table is missing its total.');
  const headerEnd = Math.max(...dates.map((match) => match.index! + match[0].length));
  if (headerEnd > total.index)
    throw new StatementError('The investment table layout is not supported.');
  const body = table.slice(headerEnd, total.index);
  const decimal = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,8})?`;
  const rowPattern = new RegExp(
    String.raw`^(.+?)\s+(${decimal})\s+\$\s*(${decimal})\s+\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$`,
  );
  const investments: StatementInvestment[] = [];
  let category: string | null = null;
  let pending: string[] = [];
  const categoryPattern =
    /^(?:Balanced|Equity|Equities|Fixed income|Money market|Cash|Guaranteed(?: funds| investments)?|Target(?: date| risk)(?: funds)?|Canadian equity|U\.?S\.? equity|International equity|Global equity|Specialty|Segregated funds)$/i;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    if (categoryPattern.test(line)) {
      if (pending.length)
        throw new StatementError('An investment row could not be read completely.');
      category = line;
      continue;
    }
    pending.push(line);
    const match = rowPattern.exec(pending.join(' '));
    if (!match) continue;
    const parsed = statementInvestmentSchema.safeParse({
      name: match[1]!.trim(),
      category,
      units: match[2]!.replaceAll(',', ''),
      unitPrice: match[3]!.replaceAll(',', ''),
      value: match[4]!.replaceAll(',', ''),
    });
    if (!parsed.success || parsed.data.name.includes('$') || investments.length >= 500)
      throw new StatementError('The investment table contains an unsupported row.');
    investments.push(parsed.data);
    pending = [];
  }
  if (pending.length || !investments.length)
    throw new StatementError('The investment table could not be read completely.');
  const cents = (value: string) => BigInt(value.replace('.', ''));
  const tableTotal = total[1]!.replaceAll(',', '');
  if (
    !moneyPattern.test(tableTotal) ||
    cents(tableTotal) !== cents(closingAmount) ||
    investments.reduce((sum, item) => sum + cents(item.value), 0n) !== cents(tableTotal)
  ) {
    throw new StatementError(
      'Investment values do not reconcile with the table total and closing plan value.',
    );
  }
  return investments;
}

export function parseSunLifeText(text: string) {
  if (!/\bsun\s*life\b/i.test(text))
    throw new StatementError('This is not a recognized Sun Life statement.');
  const periods = [
    ...text.matchAll(
      /(?:For\s+the\s+period|My\s+statement\s+for)\s+[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?\s+to\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/gi,
    ),
  ].map((match) => dateFrom(match[1]!, match[2]!, match[3]!));
  if (!periods.length || new Set(periods).size !== 1) {
    throw new StatementError(
      'A single Sun Life statement period could not be identified. Use a single-plan statement in the supported layout.',
    );
  }
  // Match plan totals only, never contributions, fund values, or projected income.
  const pattern =
    /Value\s+of\s+my\s+plan\s+on\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})[\s.]*\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?![\d.,])/gi;
  const candidates = [...text.matchAll(pattern)].map((match) => {
    const statementDate = dateFrom(match[1]!, match[2]!, match[3]!);
    const amount = match[4]!.replaceAll(',', '');
    if (!z.iso.date().safeParse(statementDate).success || !moneyPattern.test(amount)) {
      throw new StatementError('The statement contains an invalid plan date or amount.');
    }
    return { statementDate, amount };
  });
  if (!candidates.length) {
    throw new StatementError(
      'No dated Sun Life plan total was found. Scanned PDFs and other statement layouts are not supported; record a manual balance instead.',
    );
  }
  const closing = candidates.filter((item) => item.statementDate === periods[0]);
  if (!closing.length)
    throw new StatementError(
      'No plan total matches the statement closing date. Record a manual balance instead.',
    );
  const latest = closing[0]!;
  if (
    candidates.some(
      (item) => item.statementDate === latest.statementDate && item.amount !== latest.amount,
    )
  ) {
    throw new StatementError(
      'Multiple different plan totals were found for the closing date. Import each plan separately or record a manual balance.',
    );
  }
  if (/\b(?:USD|US dollars|U\.S\.\s*dollars)\b/i.test(text)) {
    throw new StatementError('This layout supports Canadian-dollar Sun Life statements only.');
  }
  return {
    ...latest,
    currency: 'CAD' as const,
    investments: parseSunLifeInvestments(text, latest.statementDate, latest.amount),
  };
}

const workerCode = `
  const { PDFParse } = require('pdf-parse');
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', async () => {
    let parser;
    try {
      parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)), stopAtErrors: true, verbosity: 0 });
      const result = await parser.getText({ first: 1, last: 25 });
      if (result.total > 25 || result.text.length > 500000) throw new Error('Statement too large');
      process.stdout.write(JSON.stringify({ text: result.text }));
    } catch { process.exitCode = 1; }
    finally { if (parser) await parser.destroy(); }
  });
`;

let activeParsers = 0;
export async function parseSunLifePdf(pdf: Buffer) {
  if (pdf.length > statementFileLimit)
    throw new StatementError('PDF exceeds the 10 MiB upload limit.');
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new StatementError('Upload a valid PDF file.');
  if (activeParsers >= 2) throw new StatementError('The PDF parser is busy. Please retry shortly.');
  activeParsers++;
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=128', '--input-type=commonjs', '-e', workerCode],
        {
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
        },
      );
      let settled = false;
      let output = '';
      let failure: Error | undefined;
      const finish = (error?: Error, text?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(text!);
      };
      const timer = setTimeout(() => {
        failure = new StatementError('PDF parsing timed out. Use a smaller text-based statement.');
        child.kill();
      }, 15000);
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString('utf8');
        if (output.length > 1000000) {
          failure = new StatementError('PDF text exceeds the supported size.');
          child.kill();
        }
      });
      child.on('error', () => finish(new StatementError('The PDF parser could not be started.')));
      child.stdin.on('error', () => {
        failure = new StatementError('The PDF could not be sent to the parser.');
      });
      child.on('close', (code) => {
        if (failure) return finish(failure);
        const invalid = new StatementError(
          'Cannot read this PDF. It may be encrypted, damaged, or longer than 25 pages.',
        );
        if (code !== 0) return finish(invalid);
        let message: unknown;
        try {
          message = JSON.parse(output);
        } catch {
          return finish(invalid);
        }
        const parsed = z.object({ text: z.string().max(500000) }).safeParse(message);
        if (!parsed.success) finish(invalid);
        else finish(undefined, parsed.data.text);
      });
      child.stdin.end(pdf);
    });
    return statementPreviewSchema.parse({
      ...parseSunLifeText(text),
      sha256: createHash('sha256').update(pdf).digest('hex'),
    });
  } finally {
    activeParsers--;
  }
}
