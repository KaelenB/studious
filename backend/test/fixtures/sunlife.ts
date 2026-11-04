// Synthetic PDF fixture, deliberately containing no customer data.
export function sunLifePdf(
  lines = [
    'Sun Life',
    'For the period July 1 to September 30, 2026',
    'Value of my plan on Jul 1, 2026 . . . $1,000.00',
    'Money contributed this period $500.00',
    'Value of my plan on Sep 30, 2026 . . . $1,234.56',
  ],
) {
  const content = `BT /F1 12 Tf 50 750 Td ${lines
    .map((line, index) => `${index ? '0 -20 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`)
    .join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export function sunLifeInvestmentPdf() {
  return sunLifePdf([
    'Sun Life',
    'For the period July 1 to September 30, 2026',
    'Value of my plan on Jul 1, 2026 . . . $1,000.00',
    'Value of my plan on Sep 30, 2026 . . . $1,234.56',
    'My investments',
    'INVESTMENT NAME NUMBER OF UNITS',
    'PRICE ON',
    'SEP 30, 2026',
    'VALUE ON',
    'SEP 30, 2026',
    'Balanced',
    'Example Balanced Fund 10.12345 $12.3456 $1,000.00',
    'Fixed income',
    'Example Bond Fund',
    '20.50000 $11.4420 $234.56',
    'Total investments $1,234.56',
    'How ongoing contributions are invested',
    'Example Balanced Fund 60.00% 60.00%',
    'Example Bond Fund 40.00% 40.00%',
  ]);
}
