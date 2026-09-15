import { fail } from './domain.js';
/** Excel-compatible TSV, including quoted newlines and doubled quotes. */
export function parseClipboard(text: string): string[][] {
  if (text.length > 2_000_000) fail('Conteúdo da colagem muito grande.');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' && (quoted || cell === '')) { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (char === '\t' || char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (char !== '\t') { rows.push(row); row = []; if (char === '\r' && text[i + 1] === '\n') i++; }
    } else cell += char;
  }
  if (quoted) fail('Colagem contém aspas não fechadas.');
  if (cell || row.length || !rows.length) { row.push(cell); rows.push(row); }
  if (rows.length > 200 || rows.reduce((count, r) => count + r.length, 0) > 2000) fail('Cole no máximo 200 linhas e 2.000 células.');
  return rows;
}
