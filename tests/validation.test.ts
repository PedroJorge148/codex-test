import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assertAdmin, fieldSchema, fieldTypes, parseCell, validateField, validateValue, type Field, type Value } from '../src/shared/domain.js';
import { parseClipboard } from '../src/shared/clipboard.js';
import { decrypt, encrypt } from '../src/server/crypto.js';
const option = randomUUID(); const member = randomUUID();
const make = (type: Field['type'], extra: Partial<Field> = {}) => fieldSchema.parse({ id: randomUUID(), label: 'Campo', type, options: [{ id: option, label: 'Opção' }], ...extra });
const cases: Record<Field['type'], [Value, Value]> = { text: ['texto', 12], longText: ['texto\nlongo', true], number: [0, 'zero'], date: ['2024-02-29', '2025-02-29'], datetime: ['2026-09-13T10:00:00-03:00', '2026-09-13 10:00'], email: ['pessoa@example.test', 'email-inválido'], phone: ['+55 (85) 99999-0000', 'abc'], boolean: [false, 'false'], single: [option, 'desconhecida'], multiple: [[option], ['desconhecida']], url: ['https://example.test', 'javascript:alert(1)'], user: [member, randomUUID()] };
describe('validação tipada compartilhada', () => {
  it.each(fieldTypes)('%s: valor válido, inválido, vazio, obrigatório e padrão', type => {
    const field = make(type); expect(validateValue(field, cases[type][0], [member])).not.toBeNull();
    expect(() => validateValue(field, cases[type][1], [member])).toThrow();
    expect(validateValue(field, undefined, [member])).toBeNull();
    expect(() => validateValue({ ...field, required: true }, null, [member])).toThrow();
    expect(() => validateField({ ...field, defaultValue: cases[type][0] }, [member])).not.toThrow();
    expect(() => validateField({ ...field, defaultValue: cases[type][1] }, [member])).toThrow();
  });
  it('preserva zero e falso em campos obrigatórios', () => { expect(validateValue(make('number', { required: true }), 0, [])).toBe(0); expect(validateValue(make('boolean', { required: true }), false, [])).toBe(false); });
  it('recusa valores fora dos limites e limites contraditórios', () => { expect(() => validateValue(make('number', { min: 2, max: 4 }), 1, [])).toThrow(); expect(() => validateField(make('number', { min: 4, max: 2 }), [])).toThrow(); expect(() => validateValue(make('text', { minLength: 4 }), 'oi', [])).toThrow(); expect(() => validateValue(make('date', { minDate: '2026-01-01' }), '2025-01-01', [])).toThrow(); });
  it('mantém opção arquivada existente sem permitir novas atribuições', () => { const f = make('single', { options: [{ id: option, label: 'Antiga', archived: true }] }); expect(validateValue(f, option, [], option)).toBe(option); expect(() => validateValue(f, option, [])).toThrow(); });
  it('recusa opções repetidas e números imprecisos', () => { expect(() => validateValue(make('multiple'), [option, option], [])).toThrow(); expect(() => validateValue(make('number'), Number.MAX_SAFE_INTEGER + 1, [])).toThrow(); });
  it('normaliza e-mail e data/hora', () => { expect(validateValue(make('email'), 'A@EXAMPLE.TEST', [])).toBe('a@example.test'); expect(validateValue(make('datetime'), cases.datetime[0], [])).toBe('2026-09-13T13:00:00.000Z'); });
  it('não aceita usuário desconhecido e respeita administração', () => { expect(() => assertAdmin('user')).toThrow(); expect(() => assertAdmin('admin')).not.toThrow(); expect(() => validateValue(make('user'), member, [])).toThrow(); });
  it('converte células e recusa conversões silenciosas', () => { expect(parseCell(make('number'), '12,5')).toBe(12.5); expect(parseCell(make('boolean'), 'não')).toBe(false); expect(() => parseCell(make('number'), '1.200,50')).toThrow(); });
});
describe('colagem TSV', () => {
  it('suporta CRLF, tabulações, aspas e quebras de linha dentro de células', () => { expect(parseClipboard('a\t"b\nc"\r\n"d""e"\t0\r\n')).toEqual([['a', 'b\nc'], ['d"e', '0']]); });
  it('recusa blocos muito grandes e aspas abertas', () => { expect(() => parseClipboard('a\n'.repeat(201))).toThrow(); expect(() => parseClipboard('"abc')).toThrow(); });
});
it('criptografa auditoria com autenticação e IV único', () => { const key = 'a'.repeat(64); const value = { before: 'pessoa@example.test', after: null }; const a = encrypt(value, key); const b = encrypt(value, key); expect(a).not.toContain('example.test'); expect(a).not.toBe(b); expect(decrypt(a, key)).toEqual(value); expect(() => decrypt(a, 'b'.repeat(64))).toThrow(); });
