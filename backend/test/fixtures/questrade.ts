import { zipSync, strToU8 } from 'fflate';

export function questradeXlsx(
  options: { badTotal?: boolean; otherAccount?: boolean; empty?: boolean } = {},
) {
  const balances = [
    [
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
    ],
    [
      'TEST123',
      'Individual TFSA',
      '1.40000',
      '2.16',
      '1.00',
      '3.56',
      '100.00',
      '10.00',
      '114.00',
      '102.16',
      '11.00',
      options.badTotal ? '999.99' : '117.56',
    ],
  ];
  const positions = [
    [
      'Equity Symbol',
      'Equity Description',
      'Account Number',
      'Currency',
      'Asset Class',
      'Quantity',
      'Market Price',
      'Market Value',
    ],
    [
      'ETF',
      'Example Canadian ETF',
      options.otherAccount ? 'OTHER' : 'TEST123',
      'CAD',
      'ETF',
      '2.00001',
      '50.0000',
      '100.00',
    ],
    ['STK', 'Example US Stock', 'TEST123', 'USD', 'STK', '1', '10', '10.00'],
  ];
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const sheet = (rows: string[][]) =>
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Balances" sheetId="1" r:id="rId1"/><sheet name="Positions" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet(options.empty ? [] : balances)),
    'xl/worksheets/sheet2.xml': strToU8(sheet(positions)),
  };
  return Buffer.from(zipSync(files, { mtime: new Date('2020-01-01T00:00:00Z') }));
}
