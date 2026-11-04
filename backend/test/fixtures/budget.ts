import { zipSync, strToU8 } from 'fflate';

export function budgetXlsx(
  options: {
    invalidDate?: boolean;
    extra?: boolean;
    missingHeader?: boolean;
    negativeIncome?: boolean;
  } = {},
) {
  const expenses = [
    [
      'Date',
      options.missingHeader ? 'Wrong' : 'Cost',
      'Description',
      'Category',
      'Paid By',
      'Notes',
    ],
    [options.invalidDate ? '2024-02-30' : '2024-07-01', '100.10', 'Market', 'Food', 'Alex', ''],
    ['2024-07-01', '100.10', 'Market', 'Food', 'Alex', ''],
    ['2024-07-02', '-6.56', 'Refund', 'Personal', 'Sam', ''],
    ['2024-07-03', '22.012', 'Precision', 'Food', 'Alex', ''],
    ['', '', '', '', '', 'Not a transaction; ignore helper columns'],
    ...(options.extra ? [['2024-07-04', '1.00', 'Bus', 'Travel', 'Sam', '']] : []),
  ];
  const income = [
    ['Date', 'Amount', 'Description', 'Whose'],
    ['2024-07-01', options.negativeIncome ? '-500.00' : '500.00', 'Pay', 'Sam'],
    ['2023-12-30', '10.00', 'Reimbursement', 'Alex'],
  ];
  const escape = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const sheet = (rows: string[][]) =>
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (row, i) =>
          `<row r="${i + 1}">${row.map((value, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  return Buffer.from(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
        ),
        '_rels/.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        ),
        'xl/workbook.xml': strToU8(
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Expenses" sheetId="1" r:id="rId1"/><sheet name="Income" sheetId="2" r:id="rId2"/></sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
        ),
        'xl/worksheets/sheet1.xml': strToU8(sheet(expenses)),
        'xl/worksheets/sheet2.xml': strToU8(sheet(income)),
      },
      { mtime: new Date('2020-01-01T00:00:00Z') },
    ),
  );
}
