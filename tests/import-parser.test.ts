import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseFile } from '../src/server/parse-file.js';
import { SimulatedGupySource } from '../src/server/imports.js';
describe('arquivos de importação', () => {
  it('lê CSV com BOM, separador explícito e células citadas', async () => { const result = await parseFile(Buffer.from('\uFEFFnome;email\n"Pessoa; Teste";p@example.test'), 'csv', undefined, ';'); expect(result.headers).toEqual(['nome', 'email']); expect(result.rows[0]).toEqual(['Pessoa; Teste', 'p@example.test']); });
  it('recusa cabeçalhos ambíguos e UTF-8 inválido', async () => { await expect(parseFile(Buffer.from('nome,nome\na,b'), 'csv')).rejects.toThrow(); await expect(parseFile(Buffer.from([0xff, 0xfe]), 'csv')).rejects.toThrow(); });
  it('XLSX seleciona uma planilha e marca fórmulas como erro', async () => {
    const wb = new ExcelJS.Workbook(); const a = wb.addWorksheet('Primeira'); a.addRow(['nome', 'nota']); a.addRow(['Pessoa', { formula: '1+1', result: 2 }]); const b = wb.addWorksheet('Segunda'); b.addRow(['nome']); b.addRow(['Outra']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer()); const first = await parseFile(buffer, 'xlsx'); expect(first.errors[2]).toContain('Fórmula');
    const second = await parseFile(buffer, 'xlsx', 'Segunda'); expect(second.rows).toEqual([['Outra']]); expect(second.sheets).toHaveLength(2);
  });
  it('limita a contagem de linhas e recusa arquivo XLSX falso', async () => { await expect(parseFile(Buffer.from('nome\n' + 'pessoa\n'.repeat(10001)), 'csv')).rejects.toThrow(); await expect(parseFile(Buffer.from('não é zip'), 'xlsx')).rejects.toThrow(); });
  it('fonte simulada pagina e pode simular falhas e duplicatas', async () => { const source = new SimulatedGupySource(); const first = await source.read(); expect(first.nextCursor).toBe('2'); expect((await source.read(first.nextCursor)).nextCursor).toBeUndefined(); await expect(new SimulatedGupySource('failure').read()).rejects.toThrow(); const dup = new SimulatedGupySource('duplicate'); expect((await dup.read()).rows[0]?.candidatura_id).toBe((await dup.read('2')).rows[0]?.candidatura_id); });
});
