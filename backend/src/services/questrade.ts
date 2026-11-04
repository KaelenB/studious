import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  statementFileLimit,
  statementPreviewSchema,
  type StatementInvestment,
} from '@studious/api';
import { StatementError } from './sunlife.js';

const worker = `
 const { readSheet } = require('read-excel-file/node');
 const chunks=[];
 process.stdin.on('data', chunk=>chunks.push(chunk));
 process.stdin.on('end',async()=>{
  try {
   const sheets={};
   for(const name of ['Balances','Positions']) {
    const rows=await readSheet(Buffer.concat(chunks), name, {parseNumber: value=>value});
    if(rows.length>502 || rows.some(row=>row.length>40)) throw new Error('Unsupported sheet');
    sheets[name]=rows;
   }
   process.stdout.write(JSON.stringify(sheets));
  } catch { process.exitCode=1; }
 });
`;
const cell = z.union([z.string().max(500), z.number().finite(), z.null()]);
const rowsSchema = z.object({
  Balances: z.array(z.array(cell)).max(502),
  Positions: z.array(z.array(cell)).max(502),
});
type Cell = z.infer<typeof cell>;
let active = 0;

function decimal(value: Cell | undefined, places: number, label: string) {
  const text = String(value ?? '').trim();
  if (!/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,8})?$/.test(text))
    throw new StatementError(`Invalid ${label} in Questrade export.`);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > places) throw new StatementError(`Unsupported precision for ${label}.`);
  return places === 2 ? `${whole}.${fraction.padEnd(2, '0')}` : text;
}
const cents = (value: string) => BigInt(value.replace('.', ''));
function table(rows: Cell[][], required: string[]) {
  const header =
    rows[0]?.map((value) =>
      String(value ?? '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase(),
    ) ?? [];
  const columns = required.map((name) => {
    const index = header.indexOf(name.replace(/\s+/g, '').toLowerCase());
    if (index < 0) throw new StatementError(`Missing Questrade column: ${name}.`);
    return index;
  });
  return rows.slice(1).map((row) => columns.map((index) => row[index]));
}

export async function parseQuestradeXlsx(bytes: Buffer, statementDate: string | undefined) {
  if (
    !statementDate ||
    !z.iso.date().safeParse(statementDate).success ||
    statementDate < '1000-01-01'
  ) {
    throw new StatementError('Enter the observation date for this undated Questrade export.');
  }
  if (
    bytes.length > statementFileLimit ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))
  ) {
    throw new StatementError('Upload a valid XLSX no larger than 10 MiB.');
  }
  if (active >= 2)
    throw new StatementError('The spreadsheet parser is busy. Please retry shortly.');
  active++;
  let output: string;
  try {
    output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=128', '-e', worker], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
      let text = '';
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new StatementError('Spreadsheet parsing timed out.');
        child.kill();
      }, 15000);
      child.stdout.on('data', (data: Buffer) => {
        text += data.toString('utf8');
        if (text.length > 1000000) {
          failure = new StatementError('Spreadsheet content exceeds the supported size.');
          child.kill();
        }
      });
      child.stdin.on('error', () => {
        failure = new StatementError('Could not send spreadsheet to parser.');
      });
      child.on('error', () => {
        failure = new StatementError('Spreadsheet parser could not be started.');
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0)
          reject(
            new StatementError(
              'Cannot read this Questrade workbook. Use an unencrypted export with Balances and Positions sheets.',
            ),
          );
        else resolve(text);
      });
      child.stdin.end(bytes);
    });
  } finally {
    active--;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new StatementError('Invalid spreadsheet parser output.');
  }
  const validated = rowsSchema.safeParse(raw);
  if (!validated.success) throw new StatementError('Unsupported Questrade worksheet cells.');
  const balances = table(validated.data.Balances, [
    'Account Number',
    'Account Type',
    'FX Rate',
    'Cash in CAD',
    'Cash in USD',
    'Cash in CAD Combined',
    'Market Value in CAD',
    'Market Value in USD',
    'Market Valuein CAD Combined',
    'Total Equity in CAD',
    'Total Equity in USD',
    'Total Equity in CAD Combined',
  ]);
  if (balances.length !== 1)
    throw new StatementError('Import an export containing exactly one Questrade account.');
  const b = balances[0]!;
  const accountNumber = String(b[0] ?? '');
  if (!accountNumber || !b[1]) throw new StatementError('Missing Questrade account metadata.');
  const money = (index: number) => decimal(b[index], 2, 'balance');
  const fxRate = decimal(b[2], 8, 'FX rate');
  if (fxRate.startsWith('-') || /^0(?:\.0+)?$/.test(fxRate))
    throw new StatementError('FX rate must be positive.');
  const rate = BigInt(fxRate.replace('.', ''));
  const scale = 10n ** BigInt(fxRate.split('.')[1]?.length ?? 0);
  const combined = (cad: string, usd: string) => {
    const raw = cents(cad) * scale + cents(usd) * rate;
    return raw < 0n ? -((-raw + scale / 2n) / scale) : (raw + scale / 2n) / scale;
  };
  const amount = money(11);
  if (
    cents(money(3)) + cents(money(6)) !== cents(money(9)) ||
    cents(money(4)) + cents(money(7)) !== cents(money(10)) ||
    cents(money(5)) + cents(money(8)) !== cents(amount)
  ) {
    throw new StatementError('Questrade cash, market values and equity totals do not reconcile.');
  }
  if (
    combined(money(3), money(4)) !== cents(money(5)) ||
    combined(money(6), money(7)) !== cents(money(8))
  ) {
    throw new StatementError('Questrade combined values do not reconcile with the export FX rate.');
  }
  const investments: StatementInvestment[] = table(validated.data.Positions, [
    'Equity Symbol',
    'Equity Description',
    'Account Number',
    'Currency',
    'Asset Class',
    'Quantity',
    'Market Price',
    'Market Value',
  ]).map((p) => {
    if (String(p[2]) !== accountNumber || !['CAD', 'USD'].includes(String(p[3])))
      throw new StatementError(
        'Positions must belong to the selected single account and use CAD or USD.',
      );
    return {
      symbol: String(p[0] ?? ''),
      name: String(p[1] ?? ''),
      category: p[4] ? String(p[4]) : null,
      currency: p[3] === 'CAD' ? 'CAD' : 'USD',
      units: decimal(p[5], 8, 'quantity'),
      unitPrice: decimal(p[6], 8, 'market price'),
      value: decimal(p[7], 2, 'market value'),
    };
  });
  for (const [currency, expected] of [
    ['CAD', money(6)],
    ['USD', money(7)],
  ] as const) {
    if (
      investments
        .filter((item) => item.currency === currency)
        .reduce((sum, item) => sum + cents(item.value), 0n) !== cents(expected)
    ) {
      throw new StatementError(
        'Questrade positions do not reconcile with native-currency market values.',
      );
    }
  }
  const result = statementPreviewSchema.safeParse({
    amount,
    statementDate,
    currency: 'CAD',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    investments: investments.length ? investments : null,
    questrade: {
      accountType: String(b[1]),
      fxRate,
      cashCAD: money(3),
      cashUSD: money(4),
      combinedCashCAD: money(5),
    },
  });
  if (!result.success)
    throw new StatementError(
      'Unsupported Questrade amounts or position details. Short positions are not supported.',
    );
  return result.data;
}
