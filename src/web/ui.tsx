import { useEffect, useRef, type ReactNode } from 'react';
import type { Field, Member, Value } from '../shared/domain.js';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 3v18"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    undo: <><path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 6 6v3"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, check: <path d="m5 12 4 4L19 6"/>,
    logout: <><path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/></>, filter: <><path d="M3 4h18l-7 8v7l-4 2v-9z"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}
export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} onCancel={onClose}><header className="dialog-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close"/></button></header>{children}</dialog>;
}
export function ErrorBox({ text }: { text: string }) { return text ? <div className="error" role="alert">{text}</div> : null; }
export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) { return <div className="empty"><div className="empty-icon"><Icon name="people" size={30}/></div><h3>{title}</h3><p>{text}</p>{children}</div>; }
export function ValueInput({ field, value, onChange, members, autoFocus = false }: { field: Field; value: Value | undefined; onChange: (value: Value) => void; members: Member[]; autoFocus?: boolean }) {
  if (field.type === 'boolean') return <select autoFocus={autoFocus} aria-label={field.label} value={value == null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? null : e.target.value === 'true')}><option value="">Selecionar</option><option value="true">Sim</option><option value="false">Não</option></select>;
  if (['single', 'user', 'multiple'].includes(field.type)) {
    const options = field.type === 'user' ? members.filter(m => m.active || m.id === value).map(m => ({ id: m.id, label: m.name, archived: !m.active })) : field.options.filter(o => !o.archived || o.id === value || (Array.isArray(value) && value.includes(o.id)));
    return <select autoFocus={autoFocus} aria-label={field.label} multiple={field.type === 'multiple'} value={field.type === 'multiple' ? (Array.isArray(value) ? value : []) : String(value ?? '')} onChange={e => onChange(field.type === 'multiple' ? Array.from(e.target.selectedOptions, o => o.value) : e.target.value || null)}>{field.type !== 'multiple' && <option value="">Selecionar</option>}{options.map(o => <option key={o.id} value={o.id} disabled={o.archived}>{o.label}{o.archived ? ' (arquivado)' : ''}</option>)}</select>;
  }
  if (field.type === 'longText') return <textarea autoFocus={autoFocus} aria-label={field.label} rows={3} value={String(value ?? '')} maxLength={field.maxLength ?? 20000} onChange={e => onChange(e.target.value || null)}/>;
  const type = ({ number: 'number', date: 'date', email: 'email', phone: 'tel', url: 'url' } as Record<string, string>)[field.type] ?? 'text';
  return <input autoFocus={autoFocus} aria-label={field.label} type={type} step="any" value={String(value ?? '')} placeholder={field.type === 'datetime' ? '2026-09-13T14:00:00-03:00' : undefined} onChange={e => onChange(e.target.value === '' ? null : field.type === 'number' ? Number(e.target.value) : e.target.value)}/>;
}
