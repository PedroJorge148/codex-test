import { z } from 'zod';

export const fieldTypes = ['text', 'longText', 'number', 'date', 'datetime', 'email', 'phone', 'boolean', 'single', 'multiple', 'url', 'user'] as const;
export const typeLabels: Record<FieldType, string> = { text: 'Texto', longText: 'Texto longo', number: 'Número', date: 'Data', datetime: 'Data e hora', email: 'E-mail', phone: 'Telefone', boolean: 'Sim / não', single: 'Seleção única', multiple: 'Seleção múltipla', url: 'URL', user: 'Responsável' };
export type FieldType = typeof fieldTypes[number];
export type Value = string | number | boolean | string[] | null;
export const valueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]);
export const optionSchema = z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(100), archived: z.boolean().default(false) });
export const fieldSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(100), type: z.enum(fieldTypes),
  required: z.boolean().default(false), defaultValue: valueSchema.default(null),
  min: z.number().finite().optional(), max: z.number().finite().optional(),
  minLength: z.number().int().min(0).max(20000).optional(), maxLength: z.number().int().min(1).max(20000).optional(),
  minDate: z.string().optional(), maxDate: z.string().optional(),
  options: z.array(optionSchema).max(200).default([]), archived: z.boolean().default(false),
  position: z.number().int().min(0).max(1000).default(0), version: z.number().int().positive().default(1)
}).strict();
export type Field = z.infer<typeof fieldSchema>;
export interface Member { id: string; name: string; email: string; role: 'admin' | 'user'; active: boolean }
export interface Job { id: string; title: string; version: number; deleted_at: string | null }
export interface Candidate { id: string; name: string; email: string | null; phone: string | null; version: number }
export interface Application { id: string; candidate_id: string; job_id: string; version: number; candidate: Candidate; job_title: string; values: Record<string, Value>; deleted_at: string | null; created_at: string }
export interface Organization { id: string; name: string; timezone: string; role: 'admin' | 'user'; schema_version: number }
export interface Session { user: { id: string; name: string }; organizations: Organization[]; csrf: string }
export interface Page { rows: Application[]; total: number; fields: Field[]; schemaVersion: number }

export class DomainError extends Error {
  constructor(public status: number, public code: string, message: string, public details: unknown = undefined) { super(message); }
}
export function fail(message: string, details?: unknown): never { throw new DomainError(422, 'VALIDATION', message, details); }
export function assertAdmin(role: string): void { if (role !== 'admin') throw new DomainError(403, 'FORBIDDEN', 'Ação disponível apenas para administradores.'); }

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateValue(field: Field, raw: Value | undefined, memberIds: string[], previous?: Value): Value {
  const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
  if (empty) { if (field.required) fail(`${field.label}: campo obrigatório.`); return null; }
  const bad = () => fail(`${field.label}: valor inválido para ${typeLabels[field.type].toLowerCase()}.`);
  let value: Value = raw;
  switch (field.type) {
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) return bad();
      if ((field.min !== undefined && raw < field.min) || (field.max !== undefined && raw > field.max)) fail(`${field.label}: fora dos limites numéricos.`);
      break;
    case 'boolean': if (typeof raw !== 'boolean') return bad(); break;
    case 'multiple': {
      if (!Array.isArray(raw) || raw.some(v => typeof v !== 'string') || new Set(raw).size !== raw.length) return bad();
      const old = Array.isArray(previous) ? previous : [];
      if (raw.some(v => !field.options.some(o => o.id === v && (!o.archived || old.includes(v))))) return bad();
      value = [...raw].sort(); break;
    }
    default: {
      if (typeof raw !== 'string') return bad();
      value = raw.trim();
      if (!value) { if (field.required) fail(`${field.label}: campo obrigatório.`); return null; }
      if (value.length > (field.maxLength ?? (field.type === 'longText' ? 20000 : 500)) || value.length < (field.minLength ?? 0)) fail(`${field.label}: comprimento fora dos limites.`);
      if (field.type === 'email') { if (!z.email().safeParse(value).success) return bad(); value = value.toLowerCase(); }
      if (field.type === 'phone' && !/^\+?[\d\s().-]{7,30}$/.test(value)) return bad();
      if (field.type === 'date' && !validDate(value)) return bad();
      if (field.type === 'datetime') {
        if (!z.iso.datetime({ offset: true }).safeParse(value).success) return bad();
        value = new Date(value).toISOString();
      }
      if (field.type === 'date' || field.type === 'datetime') {
        if ((field.minDate && Date.parse(value) < Date.parse(field.minDate)) || (field.maxDate && Date.parse(value) > Date.parse(field.maxDate))) fail(`${field.label}: data fora dos limites.`);
      }
      if (field.type === 'url') { try { if (!['https:', 'http:'].includes(new URL(value).protocol)) return bad(); } catch { return bad(); } }
      if (field.type === 'single' && !field.options.some(o => o.id === value && (!o.archived || previous === value))) return bad();
      if (field.type === 'user' && !memberIds.includes(value) && previous !== value) return bad();
    }
  }
  return value;
}
export function validateField(field: Field, members: string[]): void {
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail('Limite mínimo maior que máximo.');
  if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) fail('Comprimento mínimo maior que máximo.');
  for (const d of [field.minDate, field.maxDate]) if (d && !(field.type === 'date' ? validDate(d) : z.iso.datetime({ offset: true }).safeParse(d).success)) fail('Limite de data inválido.');
  if (field.minDate && field.maxDate && Date.parse(field.minDate) > Date.parse(field.maxDate)) fail('Data mínima maior que máxima.');
  if (new Set(field.options.map(o => o.id)).size !== field.options.length || new Set(field.options.map(o => o.label.toLowerCase())).size !== field.options.length) fail('Opções duplicadas.');
  if (['single', 'multiple'].includes(field.type) && !field.options.some(o => !o.archived)) fail('Adicione ao menos uma opção ativa.');
  if (field.defaultValue !== null) validateValue(field, field.defaultValue, members);
}
export const candidateSchema = z.object({ name: z.string().trim().min(1).max(200), email: z.union([z.email().max(254), z.null()]).default(null), phone: z.union([z.string().regex(/^\+?[\d\s().-]{7,30}$/), z.null()]).default(null) }).strict();
export const createSchema = z.object({ candidateId: z.string().uuid().optional(), candidate: candidateSchema.optional(), jobId: z.string().uuid(), values: z.record(z.string().uuid(), valueSchema).default({}), schemaVersion: z.number().int().positive(), operationId: z.string().uuid() }).strict();
export type CreateInput = z.infer<typeof createSchema>;
export const editSchema = z.object({ id: z.string().uuid(), version: z.number().int().positive(), candidateVersion: z.number().int().positive().optional(), candidate: candidateSchema.partial().optional(), values: z.record(z.string().uuid(), valueSchema).default({}) }).strict();
export const batchSchema = z.object({ operationId: z.string().uuid(), schemaVersion: z.number().int().positive(), edits: z.array(editSchema).min(1).max(200) }).strict();
export type BatchInput = z.infer<typeof batchSchema>;
export const filterSchema = z.object({ field: z.string().max(100), operator: z.enum(['eq', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'any']), value: valueSchema.optional() }).strict();
export const querySchema = z.object({ page: z.number().int().min(1).max(10000).default(1), pageSize: z.number().int().min(1).max(200).default(50), filters: z.array(filterSchema).max(20).default([]), sort: z.array(z.object({ field: z.string().max(100), direction: z.enum(['asc', 'desc']) }).strict()).max(3).default([]), deleted: z.boolean().default(false), search: z.string().max(200).default('') }).strict();
export type GridQuery = z.infer<typeof querySchema>;

export function parseCell(field: Field, text: string, members: Member[] = []): Value {
  const raw = text.trim();
  if (!raw) return null;
  if (field.type === 'number') { if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) fail(`${field.label}: número inválido.`); return Number(raw.replace(',', '.')); }
  if (field.type === 'boolean') { if (/^(true|sim|1)$/i.test(raw)) return true; if (/^(false|não|nao|0)$/i.test(raw)) return false; fail(`${field.label}: use sim ou não.`); }
  const option = (s: string) => field.options.find(o => o.id === s || o.label.toLowerCase() === s.toLowerCase())?.id ?? s;
  if (field.type === 'single') return option(raw);
  if (field.type === 'multiple') return raw.split('|').map(v => option(v.trim()));
  if (field.type === 'user') return members.find(m => m.id === raw || m.email.toLowerCase() === raw.toLowerCase())?.id ?? raw;
  return raw;
}
export function displayValue(field: Field, value: Value | undefined, members: Member[] = []): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'boolean') return value ? 'Sim' : 'Não';
  if (field.type === 'user') return members.find(m => m.id === value)?.name ?? 'Membro desativado';
  if (field.type === 'multiple' && Array.isArray(value)) return value.map(v => field.options.find(o => o.id === v)?.label ?? v).join(' | ');
  if (field.type === 'single') return field.options.find(o => o.id === value)?.label ?? String(value);
  return String(value);
}
