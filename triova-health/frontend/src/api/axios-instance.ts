import { useAuthStore } from '@/store/auth.store';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  status?: number;
  payload?: unknown;

  constructor(message: string, status?: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function authHeaders(contentType = 'application/json'): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function parseMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Request failed';
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.message === 'string') return obj.message;
  return 'Request failed';
}

async function request<T>(method: RequestMethod, path: string, body?: unknown): Promise<{ data: T }> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    throw new ApiError(parseMessage(json), res.status, json);
  }
  return { data: json as T };
}

async function upload<T>(path: string, formData: FormData): Promise<{ data: T }> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) throw new ApiError(parseMessage(json), res.status, json);
  return { data: json as T };
}

async function download(path: string, filename = 'download.pdf'): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method: 'GET', headers, credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};
    throw new ApiError(parseMessage(payload), res.status, payload);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, formData: FormData) => upload<T>(path, formData),
  download,
};
