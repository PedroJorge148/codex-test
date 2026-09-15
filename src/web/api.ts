export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public correlationId?: string) { super(message); }
}
let csrf = '';
export function setCsrf(value: string): void { csrf = value; }
export async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data: unknown = await response.json();
  if (!response.ok) { const error = data as { code?: string; message?: string; details?: unknown; correlationId?: string }; throw new ApiError(response.status, error.code ?? 'ERROR', error.message ?? 'Não foi possível concluir.', error.details, error.correlationId); }
  return data as T;
}
export type Api = <T>(path: string, body?: unknown, method?: string) => Promise<T>;
export function scoped(organizationId: string): Api { return <T>(path: string, body?: unknown, method?: string) => request<T>(`/api/v1/organizations/${organizationId}${path}`, body, method); }
export function operationId(): string { return crypto.randomUUID(); }
export function message(error: unknown): string { return error instanceof Error ? error.message : 'Não foi possível concluir.'; }
