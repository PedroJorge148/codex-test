import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type Column, type RenderEditCellProps, type SortColumn } from 'react-data-grid';
import { candidateSchema, displayValue, fieldSchema, parseCell, validateValue, type Application, type BatchInput, type Candidate, type Field, type GridQuery, type Job, type Member, type Organization, type Page, type Session, type Value } from '../shared/domain.js';
import { parseClipboard } from '../shared/clipboard.js';
import { ApiError, message, operationId, request, scoped, setCsrf, type Api } from './api.js';
import { Dialog, Empty, ErrorBox, Icon, ValueInput } from './ui.js';
import { Activity, ImportScreen, Settings } from './screens.js';

export interface Metadata { fields: Field[]; members: Member[]; jobs: Job[]; schemaVersion: number }
const baseQuery: GridQuery = { page: 1, pageSize: 50, search: '', filters: [], sort: [], deleted: false };
const fixedFields: Record<string, Field> = Object.fromEntries(['name', 'email', 'phone'].map((key, i) => [key, fieldSchema.parse({ id: `00000000-0000-4000-8000-00000000000${i}`, label: { name: 'Nome', email: 'E-mail', phone: 'Telefone' }[key], type: key === 'name' ? 'text' : key, required: key === 'name', maxLength: key === 'name' ? 200 : 254 })]));

export function App() {
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [orgId, setOrgId] = useState(''); const [view, setView] = useState('grid');
  useEffect(() => { void request<Session>('/api/session').then(data => { setSession(data); setCsrf(data.csrf); setOrgId(data.organizations[0]?.id ?? ''); }).catch(error => { if (!(error instanceof ApiError && error.status === 401)) setError(message(error)); }).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="loading-page"><span className="brand-mark">e.</span><p>Preparando seu espaço…</p></div>;
  if (!session) return <main className="login"><section className="login-story"><div className="brand"><span className="brand-mark">e.</span><span>entre</span></div><div><p className="eyebrow">PESSOAS NO CENTRO</p><h1>O próximo encontro<br/>começa aqui.</h1><p>Um espaço compartilhado para acompanhar candidaturas e construir boas equipes.</p></div><span className="login-note">Menos planilhas espalhadas. Mais clareza para decidir.</span></section><section className="login-form"><div className="login-card"><span className="eyebrow">SEU ESPAÇO DE TRABALHO</span><h2>Bem-vindo de volta.</h2><p>Entre com o acesso enviado pela sua equipe de RH.</p><ErrorBox text={error}/><a className="button primary" href="/auth/login">Entrar com minha conta <Icon name="arrow"/></a><p className="small">Primeiro acesso? Abra o convite recebido por e-mail.<br/>Para recuperar sua senha, use “Esqueci minha senha” na tela de login.</p></div></section></main>;
  const org = session.organizations.find(o => o.id === orgId);
  if (!org) return <Empty title="Sem organização disponível" text="Solicite um convite ao administrador."/>;
  const nav = [{ id: 'grid', label: 'Candidaturas', icon: 'grid' }, ...(org.role === 'admin' ? [{ id: 'imports', label: 'Importações', icon: 'upload' }, { id: 'activity', label: 'Atividade', icon: 'activity' }, { id: 'settings', label: 'Configurações', icon: 'settings' }] : [])];
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">e.</span><span>entre<span className="brand-dot">.</span></span></div><div className="workspace-label">ESPAÇO DE TRABALHO</div><label className="org-picker"><span className="org-avatar">{org.name.slice(0, 1)}</span><select aria-label="Organização" value={orgId} onChange={e => { setOrgId(e.target.value); setView('grid'); }}>{session.organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><nav>{nav.map(item => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.id)}><Icon name={item.icon}/>{item.label}{view === item.id && <span className="nav-dot"/>}</button>)}</nav><div className="sidebar-note"><span className="live-dot"/><strong>Um espaço, uma equipe</strong><p>As alterações são compartilhadas com sua organização.</p></div><div className="profile"><span className="avatar">{session.user.name.slice(0, 2).toUpperCase()}</span><div><strong>{session.user.name}</strong><small>{org.role === 'admin' ? 'Administrador' : 'Usuário'}</small></div><button className="icon-button" aria-label="Sair" onClick={() => { void request('/auth/logout', {}).then(() => location.reload()).catch(e => setError(message(e))); }}><Icon name="logout" size={17}/></button></div></aside><main className="workspace"><header className="topbar"><span>Workspace <span className="slash">/</span> {nav.find(n => n.id === view)?.label}</span><span className="workspace-tag">{org.name}</span></header><ErrorBox text={error}/><Workspace key={orgId} organization={org} view={view}/></main></div>;
}

function Workspace({ organization, view }: { organization: Organization; view: string }) {
  const api = useMemo(() => scoped(organization.id), [organization.id]);
  const [meta, setMeta] = useState<Metadata>({ fields: [], jobs: [], members: [], schemaVersion: organization.schema_version });
  const [error, setError] = useState('');
  const reload = useCallback(async () => { try { setMeta(await api<Metadata>('/metadata')); } catch (e) { setError(message(e)); } }, [api]);
  useEffect(() => { void reload(); }, [reload]);
  return <div className="page-content"><ErrorBox text={error}/>{view === 'grid' && <CandidateGrid api={api} organization={organization} meta={meta} reloadMeta={reload}/>} {view === 'imports' && <ImportScreen api={api} meta={meta}/>} {view === 'activity' && <Activity api={api}/>} {view === 'settings' && <Settings api={api} meta={meta} reload={reload}/>}</div>;
}

function CellEditor(props: RenderEditCellProps<Application> & { field: Field; members: Member[]; editing: (value: boolean) => void }) {
  const { row, column, onRowChange, onClose, field, members, editing } = props;
  const fixed = Object.hasOwn(fixedFields, column.key); const initial = fixed ? row.candidate[column.key as 'name' | 'email' | 'phone'] : row.values[field.id];
  const [value, setValue] = useState<Value | undefined>(initial); const [error, setError] = useState('');
  useEffect(() => { editing(true); return () => editing(false); }, [editing]);
  function save() {
    try {
      const validated = validateValue(field, value, members.filter(m => m.active).map(m => m.id), initial);
      onRowChange(fixed ? { ...row, candidate: { ...row.candidate, [column.key]: validated } } : { ...row, values: { ...row.values, [field.id]: validated } }, true);
    } catch (e) { setError(message(e)); }
  }
  return <div className="cell-editor" onKeyDown={e => { if (e.key === 'Enter' && field.type !== 'longText') { e.preventDefault(); e.stopPropagation(); save(); } if (e.key === 'Escape') { e.stopPropagation(); onClose(false); } if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); save(); } }}><ValueInput autoFocus field={field} value={value} onChange={setValue} members={members}/><ErrorBox text={error}/><div className="editor-actions"><button onClick={() => onClose(false)}>Cancelar</button><button className="primary" onClick={save}>Salvar</button></div></div>;
}

function CandidateGrid({ api, organization, meta, reloadMeta }: { api: Api; organization: Organization; meta: Metadata; reloadMeta: () => Promise<void> }) {
  const [page, setPage] = useState<Page>({ rows: [], total: 0, fields: [], schemaVersion: meta.schemaVersion });
  const [query, setQuery] = useState<GridQuery>(baseQuery); const [search, setSearch] = useState(''); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [online, setOnline] = useState(false); const [notice, setNotice] = useState('');
  const [create, setCreate] = useState(false); const [filtering, setFiltering] = useState(false); const [lastOp, setLastOp] = useState<string | null>(null);
  const [pending, setPending] = useState<BatchInput | null>(null); const [currentConflict, setCurrentConflict] = useState<Application[]>([]); const [selected, setSelected] = useState<Application | null>(null);
  const editing = useRef(false); const savingRef = useRef(false); const version = useRef(0); const [remotePending, setRemotePending] = useState(false);
  const setEditing = useCallback((value: boolean) => { editing.current = value; }, []);
  const refresh = useCallback(async (force = false) => {
    if (!force && (editing.current || savingRef.current)) { setRemotePending(true); return; }
    const sequence = ++version.current;
    try { const result = await api<Page>('/applications/query', query); if (sequence === version.current) { setPage(result); setRemotePending(false); setError(''); } }
    catch (e) { if (sequence === version.current) setError(message(e)); }
    finally { if (sequence === version.current) setLoading(false); }
  }, [api, query]);
  useEffect(() => { const timer = setTimeout(() => setQuery(q => ({ ...q, search, page: 1 })), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);
  useEffect(() => {
    const stream = new EventSource(`/api/v1/organizations/${organization.id}/events`);
    const update = () => { void refresh(); void reloadMeta(); };
    stream.onopen = () => setOnline(true); stream.onerror = () => setOnline(false); stream.addEventListener('change', update); stream.addEventListener('reconcile', update);
    const interval = setInterval(update, 30000); return () => { stream.close(); clearInterval(interval); };
  }, [organization.id, refresh, reloadMeta]);
  async function save(body: BatchInput) {
    if (savingRef.current) return;
    setSaving(true); savingRef.current = true; setError(''); setNotice('');
    try { const result = await api<{ operationId: string }>('/applications/batch', body); setLastOp(result.operationId); setPending(null); setNotice(body.edits.length > 1 ? `${body.edits.length} linhas salvas.` : 'Alteração salva.'); await refresh(true); }
    catch (e) { setError(message(e)); setPending(body); if (e instanceof ApiError && e.status === 409) { setCurrentConflict(await api<Application[]>('/applications/lookup', { ids: body.edits.map(e => e.id) }).catch(() => [])); } }
    finally { setSaving(false); savingRef.current = false; }
  }
  async function undo() {
    if (!lastOp) return; setSaving(true);
    try { await api(`/operations/${lastOp}/undo`, { operationId: operationId() }); setLastOp(null); setNotice('Última alteração desfeita.'); await refresh(true); }
    catch (e) { setError(message(e)); } finally { setSaving(false); }
  }
  const definitions = page.fields.filter(f => !f.archived);
  const columns: Column<Application>[] = [
    ...(['name', 'email'] as const).map(key => ({ key, name: key === 'name' ? 'Candidato' : 'E-mail', width: key === 'name' ? 245 : 240, frozen: key === 'name', sortable: true, editable: !query.deleted && !saving, renderCell: ({ row }: { row: Application }) => key === 'name' ? <span className="candidate-name"><span className="mini-avatar">{row.candidate.name.slice(0, 1)}</span><span>{row.candidate.name}</span></span> : <span className="muted">{row.candidate.email ?? '—'}</span>, renderEditCell: (props: RenderEditCellProps<Application>) => <CellEditor {...props} field={fixedFields[key]!} members={meta.members} editing={setEditing}/>, editorOptions: { displayCellContent: true, commitOnOutsideClick: false } })),
    { key: 'job', name: 'Vaga', width: 220, sortable: true, renderCell: ({ row }) => <span className="job-label">{row.job_title}</span> },
    ...definitions.map(field => ({ key: field.id, name: `${field.label}${field.required ? ' *' : ''}`, width: 190, sortable: true, editable: !query.deleted && !saving, renderCell: ({ row }: { row: Application }) => { const text = displayValue(field, row.values[field.id], meta.members); return <span className={['single', 'multiple'].includes(field.type) && text ? 'value-chip' : ''}>{text || <span className="muted">—</span>}</span>; }, renderEditCell: (props: RenderEditCellProps<Application>) => <CellEditor {...props} field={field} members={meta.members} editing={setEditing}/>, editorOptions: { displayCellContent: true, commitOnOutsideClick: false } })),
    { key: 'phone', name: 'Telefone', width: 180, sortable: true, editable: !query.deleted && !saving, renderCell: ({ row }) => row.candidate.phone ?? '—', renderEditCell: props => <CellEditor {...props} field={fixedFields.phone!} members={meta.members} editing={setEditing}/>, editorOptions: { commitOnOutsideClick: false } },
    { key: 'actions', name: '', width: 90, renderCell: ({ row }) => <button className="text-button" onClick={() => setSelected(row)}>Detalhes</button> }
  ];
  const paste = (text: string, rowIndex: number, colIndex: number) => {
    if (saving || query.deleted) return;
    try {
      const matrix = parseClipboard(text); const edits: BatchInput['edits'] = [];
      for (const [offset, cells] of matrix.entries()) {
        const row = page.rows[rowIndex + offset]; if (!row) throw new Error('A colagem ultrapassa a página. Use a importação para criar linhas.');
        const edit: BatchInput['edits'][number] = { id: row.id, version: row.version, values: {} };
        for (const [i, cell] of cells.entries()) {
          const column = columns[colIndex + i]; if (!column || ['job', 'actions'].includes(column.key)) throw new Error('A colagem inclui uma coluna não editável.');
          const field = fixedFields[column.key] ?? definitions.find(f => f.id === column.key)!;
          const value = validateValue(field, parseCell(field, cell, meta.members), meta.members.filter(m => m.active).map(m => m.id), row.values[field.id]);
          if (fixedFields[column.key]) { edit.candidate = { ...edit.candidate, [column.key]: value }; edit.candidateVersion = row.candidate.version; }
          else edit.values[field.id] = value;
        }
        edits.push(edit);
      }
      if (edits.some(e => e.candidate) && !window.confirm('Esta colagem altera dados pessoais compartilhados entre as candidaturas. Continuar?')) return;
      void save({ edits, operationId: operationId(), schemaVersion: page.schemaVersion });
    } catch (e) { setError(message(e)); }
  };
  const position = useRef({ row: 0, col: 0 });
  return <><div className="page-heading"><div><p className="eyebrow">RECRUTAMENTO EM EQUIPE</p><h1>Candidaturas<span className="count-pill">{page.total}</span></h1><p>Acompanhe pessoas, compartilhe avanços e encontre o próximo talento.</p></div><button className="primary" onClick={() => setCreate(true)}><Icon name="plus" size={18}/>Nova candidatura</button></div><section className="grid-card"><div className="grid-card-header"><div className="tab active">{query.deleted ? 'Candidaturas excluídas' : 'Todas as candidaturas'}<span>{page.total}</span></div><div className="sync-status" aria-live="polite"><span className={online ? 'live-dot' : 'live-dot offline'}/>{saving ? 'Salvando…' : online ? 'Atualizações em tempo real' : 'Reconectando…'}</div></div><div className="toolbar"><label className="search"><Icon name="search" size={18}/><input aria-label="Buscar candidaturas" placeholder="Buscar por nome, e-mail ou vaga…" value={search} onChange={e => setSearch(e.target.value)}/></label><button className={query.filters.length ? 'filter-active' : ''} onClick={() => setFiltering(true)}><Icon name="filter" size={16}/>Filtros{query.filters.length ? ` (${query.filters.length})` : ''}</button><button disabled={!lastOp || saving} onClick={() => void undo()}><Icon name="undo" size={16}/>Desfazer</button>{organization.role === 'admin' && <label className="checkbox"><input type="checkbox" checked={query.deleted} onChange={e => setQuery(q => ({ ...q, deleted: e.target.checked, page: 1 }))}/>Excluídas</label>}</div><ErrorBox text={error}/>{notice && <div className="notice" role="status"><Icon name="check" size={16}/>{notice}</div>}{remotePending && <div className="notice warning">Há atualizações na equipe. Termine ou cancele a edição para atualizar. <button onClick={() => { if (!editing.current) void refresh(true); }}>Atualizar</button></div>}
      <div className="grid-wrap" onPasteCapture={e => { if (!editing.current) { e.preventDefault(); e.stopPropagation(); paste(e.clipboardData.getData('text/plain'), position.current.row, position.current.col); } }}>
        {page.rows.length ? <DataGrid className="rdg-light" aria-label="Grade de candidaturas" columns={columns} rows={page.rows} rowKeyGetter={row => row.id} rowHeight={58} headerRowHeight={44} defaultColumnOptions={{ resizable: true }} onActivePositionChange={args => { if (args.row && args.column) position.current = { row: args.rowIdx, col: args.column.idx }; }} sortColumns={query.sort.map(s => ({ columnKey: s.field, direction: s.direction === 'asc' ? 'ASC' : 'DESC' })) as SortColumn[]} onSortColumnsChange={sort => setQuery(q => ({ ...q, page: 1, sort: sort.slice(0, 3).map(s => ({ field: s.columnKey, direction: s.direction === 'ASC' ? 'asc' : 'desc' })) }))} onRowsChange={(rows, changes) => {
          const edits: BatchInput['edits'] = [];
          for (const index of changes.indexes) {
            const before = page.rows[index]!; const after = rows[index]!; const key = changes.column.key;
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            if (fixedFields[key]) {
              if (!window.confirm('Os dados deste candidato são compartilhados com suas outras candidaturas. Salvar a alteração?')) continue;
              edits.push({ id: before.id, version: before.version, candidateVersion: before.candidate.version, candidate: { [key]: after.candidate[key as 'name' | 'email' | 'phone'] }, values: {} });
            } else edits.push({ id: before.id, version: before.version, values: { [key]: after.values[key] ?? null } });
          }
          if (edits.length) void save({ edits, operationId: operationId(), schemaVersion: page.schemaVersion });
        }}/> : loading ? <div className="empty">Carregando candidaturas…</div> : <Empty title={search || query.filters.length ? 'Nenhuma candidatura encontrada' : query.deleted ? 'Nenhuma candidatura excluída' : 'Seu próximo talento começa aqui'} text={search || query.filters.length ? 'Tente outros filtros ou termos de busca.' : 'Cadastre a primeira candidatura ou importe uma planilha da equipe.'}>{!query.deleted && <button onClick={() => setCreate(true)}><Icon name="plus" size={16}/>Adicionar candidatura</button>}</Empty>}
      </div><footer className="grid-footer"><span>{page.total ? `${(query.page - 1) * query.pageSize + 1}–${Math.min(query.page * query.pageSize, page.total)} de ${page.total}` : '0 candidaturas'} <span className="footer-hint">· Duplo clique para editar</span></span><div><select aria-label="Linhas por página" value={query.pageSize} onChange={e => setQuery(q => ({ ...q, pageSize: Number(e.target.value), page: 1 }))}>{[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} por página</option>)}</select><button aria-label="Página anterior" disabled={query.page === 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>‹</button><span>Página {query.page}</span><button aria-label="Próxima página" disabled={query.page * query.pageSize >= page.total} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>›</button></div></footer></section><p className="page-footnote"><Icon name="people" size={16}/>Cada linha é uma candidatura. Uma pessoa pode participar de várias vagas.</p>
    {create && <CreateDialog api={api} meta={meta} schemaVersion={page.schemaVersion} onClose={() => setCreate(false)} onDone={() => { setCreate(false); void refresh(true); }}/>} {filtering && <FilterDialog fields={definitions} members={meta.members} initial={query.filters} onClose={() => setFiltering(false)} onApply={filters => { setQuery(q => ({ ...q, filters, page: 1 })); setFiltering(false); }}/>} {selected && <RecordDialog api={api} row={selected} admin={organization.role === 'admin'} onClose={() => setSelected(null)} onDone={() => { setSelected(null); void refresh(true); }}/>} {pending && <Dialog title="A alteração ainda não foi salva" wide onClose={() => setPending(null)}><div className="dialog-body"><ErrorBox text={error}/><p>Seu rascunho foi preservado. Compare com os valores atuais antes de tentar novamente.</p><div className="comparison"><div><h3>Sua alteração</h3><pre>{JSON.stringify(pending.edits.map(e => ({ candidatura: e.id, candidato: e.candidate, campos: Object.fromEntries(Object.entries(e.values).map(([id, v]) => [definitions.find(f => f.id === id)?.label ?? id, v])) })), null, 2)}</pre></div><div><h3>Valores atuais</h3><pre>{JSON.stringify(currentConflict.map(r => ({ candidato: r.candidate, campos: Object.fromEntries(Object.entries(r.values).map(([id, v]) => [definitions.find(f => f.id === id)?.label ?? id, v])) })), null, 2)}</pre></div></div></div><footer className="dialog-footer"><button onClick={() => { setPending(null); void refresh(true); }}>Descartar rascunho</button><button className="primary" disabled={saving || currentConflict.length !== pending.edits.length} onClick={() => { const edits = pending.edits.map(e => { const current = currentConflict.find(r => r.id === e.id)!; return { ...e, version: current.version, candidateVersion: e.candidate ? current.candidate.version : undefined }; }); void save({ ...pending, operationId: operationId(), schemaVersion: meta.schemaVersion, edits }); }}>Revisei, reaplicar</button></footer></Dialog>}</>;
}

function CreateDialog({ api, meta, schemaVersion, onClose, onDone }: { api: Api; meta: Metadata; schemaVersion: number; onClose: () => void; onDone: () => void }) {
  const [existing, setExisting] = useState(false); const [candidates, setCandidates] = useState<Candidate[]>([]); const [search, setSearch] = useState(''); const [candidateId, setCandidateId] = useState('');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [jobId, setJobId] = useState(meta.jobs[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, Value>>(Object.fromEntries(meta.fields.filter(f => !f.archived).map(f => [f.id, f.defaultValue]))); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (existing) { const timer = setTimeout(() => { void api<Candidate[]>(`/candidates?search=${encodeURIComponent(search)}`).then(setCandidates).catch(e => setError(message(e))); }, 200); return () => clearTimeout(timer); } }, [existing, search, api]);
  return <Dialog title="Nova candidatura" onClose={onClose}><form onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void (async () => {
    const candidate = existing ? undefined : candidateSchema.parse({ name, email: email || null, phone: phone || null });
    for (const field of meta.fields.filter(f => !f.archived)) validateValue(field, values[field.id], meta.members.filter(m => m.active).map(m => m.id));
    await api('/applications', { candidateId: existing ? candidateId : undefined, candidate, jobId, values, schemaVersion, operationId: operationId() }); onDone();
  })().catch(e => setError(message(e))).finally(() => setBusy(false)); }}><div className="dialog-body"><ErrorBox text={error}/><label>Vaga<select required value={jobId} onChange={e => setJobId(e.target.value)}><option value="">Selecione uma vaga</option>{meta.jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label>{!meta.jobs.length && <p className="notice warning">Peça a um administrador para criar uma vaga em Configurações.</p>}<div className="segmented"><button type="button" className={!existing ? 'selected' : ''} onClick={() => setExisting(false)}>Novo candidato</button><button type="button" className={existing ? 'selected' : ''} onClick={() => setExisting(true)}>Candidato existente</button></div>{existing ? <><label>Buscar candidato<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome ou e-mail"/></label><label>Candidato<select required value={candidateId} onChange={e => setCandidateId(e.target.value)}><option value="">Selecione</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.name} {c.email ? `· ${c.email}` : ''}</option>)}</select></label></> : <><label>Nome completo<input required maxLength={200} value={name} onChange={e => setName(e.target.value)}/></label><div className="form-row"><label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label>Telefone<input type="tel" value={phone} onChange={e => setPhone(e.target.value)}/></label></div></>} {meta.fields.filter(f => !f.archived).map(field => <label key={field.id}>{field.label}{field.required ? ' *' : ''}<ValueInput field={field} value={values[field.id]} onChange={value => setValues(v => ({ ...v, [field.id]: value }))} members={meta.members}/></label>)}</div><footer className="dialog-footer"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !jobId}>{busy ? 'Salvando…' : 'Criar candidatura'}</button></footer></form></Dialog>;
}

function FilterDialog({ fields, members, initial, onClose, onApply }: { fields: Field[]; members: Member[]; initial: GridQuery['filters']; onClose: () => void; onApply: (filters: GridQuery['filters']) => void }) {
  const [filters, setFilters] = useState(initial);
  const options = [{ id: 'name', label: 'Candidato' }, { id: 'email', label: 'E-mail' }, { id: 'job', label: 'Vaga' }, ...fields];
  return <Dialog title="Filtrar candidaturas" wide onClose={onClose}><div className="dialog-body"><p>As condições abaixo são combinadas: todas devem ser atendidas.</p>{filters.map((filter, index) => { const field = fields.find(f => f.id === filter.field) ?? fixedFields.name!; return <div className="filter-row" key={index}><select aria-label="Campo do filtro" value={filter.field} onChange={e => setFilters(v => v.map((f, i) => i === index ? { field: e.target.value, operator: 'eq', value: null } : f))}>{options.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select><select aria-label="Operador" value={filter.operator} onChange={e => setFilters(v => v.map((f, i) => i === index ? { ...f, operator: e.target.value as GridQuery['filters'][number]['operator'] } : f))}>{(field.type === 'multiple' ? [['any', 'Contém qualquer'], ['empty', 'Está vazio']] : [['eq', 'Igual a'], ['empty', 'Está vazio'], ...(['number', 'date', 'datetime'].includes(field.type) ? [['gt', 'Maior que'], ['lt', 'Menor que'], ['gte', 'Maior ou igual'], ['lte', 'Menor ou igual']] : ['text', 'longText', 'email', 'phone', 'url'].includes(field.type) ? [['contains', 'Contém']] : [])]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{filter.operator !== 'empty' && <ValueInput field={field} value={filter.value} members={members} onChange={value => setFilters(v => v.map((f, i) => i === index ? { ...f, value } : f))}/>}<button className="icon-button" aria-label="Remover filtro" onClick={() => setFilters(v => v.filter((_, i) => i !== index))}><Icon name="close" size={16}/></button></div>; })}<button disabled={filters.length >= 20} onClick={() => setFilters(v => [...v, { field: 'name', operator: 'contains', value: '' }])}><Icon name="plus" size={16}/>Adicionar condição</button></div><footer className="dialog-footer"><button onClick={() => onApply([])}>Limpar filtros</button><button className="primary" onClick={() => onApply(filters)}>Aplicar filtros</button></footer></Dialog>;
}

function RecordDialog({ api, row, admin, onClose, onDone }: { api: Api; row: Application; admin: boolean; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<unknown>) { setBusy(true); try { await fn(); onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  return <Dialog title={row.candidate.name} onClose={onClose}><div className="dialog-body"><ErrorBox text={error}/><dl className="details"><dt>Vaga</dt><dd>{row.job_title}</dd><dt>E-mail</dt><dd>{row.candidate.email ?? '—'}</dd><dt>Telefone</dt><dd>{row.candidate.phone ?? '—'}</dd><dt>Candidatura</dt><dd><code>{row.id}</code></dd><dt>Candidato</dt><dd><code>{row.candidate_id}</code></dd><dt>Cadastro</dt><dd>{new Date(row.created_at).toLocaleString('pt-BR')}</dd></dl>{admin && <div className="privacy-actions"><h3>Privacidade</h3><p>A eliminação remove dados pessoais de todas as candidaturas desta pessoa, inclusive valores históricos e arquivos temporários da organização.</p><button disabled={busy} onClick={() => void api(`/candidates/${row.candidate_id}/export`, { operationId: operationId() }).then(data => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `dados-${row.candidate_id}.json`; a.click(); URL.revokeObjectURL(url); }).catch(e => setError(message(e)))}>Exportar dados do titular</button><button className="danger" disabled={busy} onClick={() => { if (window.prompt('Esta ação é irreversível. Digite ELIMINAR para confirmar a solicitação aprovada do titular.') === 'ELIMINAR') void action(() => api(`/candidates/${row.candidate_id}/erase`, { confirmation: 'ELIMINAR' })); }}>Eliminar dados pessoais</button></div>}</div><footer className="dialog-footer"><button onClick={onClose}>Fechar</button>{admin && <button className={row.deleted_at ? 'primary' : 'danger'} disabled={busy} onClick={() => { if (row.deleted_at || window.confirm('Excluir esta candidatura? O candidato e seu histórico serão preservados.')) void action(() => api(`/applications/${row.id}/lifecycle`, { version: row.version, restore: Boolean(row.deleted_at), operationId: operationId() })); }}>{row.deleted_at ? 'Restaurar candidatura' : 'Excluir candidatura'}</button>}</footer></Dialog>;
}
