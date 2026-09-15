import { parentPort, workerData } from 'node:worker_threads';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface ParsedFile { sheets: string[]; headers: string[]; rows: string[][]; errors: Record<number, string> }
export function inspectZip(buffer: Buffer): void {
  let offset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { offset = i; break; }
  if (offset < 0) throw new Error('XLSX inválido.');
  const count = buffer.readUInt16LE(offset + 10); let position = buffer.readUInt32LE(offset + 16); let size = 0;
  if (count > 1000 || count === 65535) throw new Error('XLSX excede o limite de arquivos internos.');
  for (let i = 0; i < count; i++) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) throw new Error('Estrutura XLSX inválida.');
    size += buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28); const extraLength = buffer.readUInt16LE(position + 30); const commentLength = buffer.readUInt16LE(position + 32);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    if (/vbaproject|externallinks/i.test(name)) throw new Error('Macros e vínculos externos não são aceitos.');
    if (size > 50 * 1024 * 1024) throw new Error('XLSX excede 50 MB descompactados.');
    position += 46 + nameLength + extraLength + commentLength;
  }
}
export async function parseFile(buffer: Buffer, format: 'csv' | 'xlsx', sheet?: string, delimiter = ','): Promise<ParsedFile> {
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Limite de 10 MB excedido.');
  let matrix: string[][]; const errors: Record<number, string> = {}; let sheets: string[] = [];
  if (format === 'csv') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    matrix = parse(text, { bom: true, delimiter, skip_empty_lines: true, max_record_size: 100000, to: 10002 }) as string[][];
  } else {
    inspectZip(buffer); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    sheets = workbook.worksheets.map(w => w.name); const ws = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
    if (!ws) throw new Error('Planilha não encontrada.');
    if (ws.rowCount > 10001 || ws.columnCount > 100) throw new Error('Limite de 10 mil linhas ou 100 colunas excedido.');
    matrix = [];
    for (let rowIndex = 1; rowIndex <= ws.rowCount; rowIndex++) {
      const row: string[] = [];
      for (let col = 1; col <= ws.columnCount; col++) {
        const cell = ws.getRow(rowIndex).getCell(col); const value = cell.value;
        if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value || 'error' in value)) { errors[rowIndex] = 'Fórmula ou erro de planilha não aceito.'; row.push(''); }
        else if (value instanceof Date) row.push(value.toISOString());
        else row.push(cell.text);
      }
      matrix.push(row);
    }
  }
  if (matrix.length > 10001 || matrix.some(r => r.length > 100)) throw new Error('Limite de 10 mil linhas ou 100 colunas excedido.');
  const headers = matrix.shift()?.map(h => h.trim()) ?? [];
  if (!headers.length || headers.some(h => !h || h.length > 200) || new Set(headers).size !== headers.length) throw new Error('Cabeçalhos devem ser preenchidos e únicos.');
  return { sheets, headers, rows: matrix, errors };
}
if (parentPort) {
  const data = workerData as { base64: string; format: 'csv' | 'xlsx'; sheet?: string; delimiter?: string };
  try { parentPort.postMessage({ result: await parseFile(Buffer.from(data.base64, 'base64'), data.format, data.sheet, data.delimiter) }); }
  catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : 'Arquivo inválido.' }); }
}
