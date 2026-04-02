/**
 * Qdrant REST client via fetch — avoids @qdrant/js-client-rest / undici issues on some Node + Windows setups.
 */
import { logger } from '@triova/shared';

function baseUrl(): string {
  return (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.QDRANT_API_KEY;
  if (key) h['api-key'] = key;
  return h;
}

async function qFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: { ...headers(), ...(init?.headers as Record<string, string>) } });
}

export async function qdrantHealthOk(): Promise<boolean> {
  try {
    const r = await qFetch('/collections');
    return r.ok;
  } catch {
    return false;
  }
}

export async function qdrantCreateCollectionIfNeeded(name: string): Promise<void> {
  const r = await qFetch(`/collections/${name}`, {
    method: 'PUT',
    body: JSON.stringify({
      vectors: { size: 1536, distance: 'Cosine' },
      optimizers_config: { indexing_threshold: 100 },
    }),
  });
  if (r.ok) return;
  const text = await r.text();
  if (r.status === 409 || text.includes('already exists')) return;
  throw new Error(`Qdrant create collection failed: ${r.status} ${text}`);
}

export interface QdrantSearchHit {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export async function qdrantSearch(
  collection: string,
  body: {
    vector: number[];
    limit: number;
    with_payload: boolean;
    filter?: { must: Array<{ key: string; match: { value: string } }> };
  }
): Promise<QdrantSearchHit[]> {
  const r = await qFetch(`/collections/${collection}/points/search`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Qdrant search failed: ${r.status} ${t}`);
  }
  const data = (await r.json()) as {
    result?: Array<{ id: string | number; score?: number; payload?: Record<string, unknown> }>;
  };
  return (
    data.result?.map((x) => ({
      id: x.id,
      score: x.score ?? 0,
      payload: (x.payload || {}) as Record<string, unknown>,
    })) ?? []
  );
}

export async function qdrantUpsert(
  collection: string,
  points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
): Promise<void> {
  const r = await qFetch(`/collections/${collection}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    logger.error('Qdrant upsert failed', { status: r.status, t });
    throw new Error(`Qdrant upsert failed: ${r.status} ${t}`);
  }
}

/** Returns null if Qdrant is not reachable */
export async function getQdrantHttp(): Promise<{ ok: true } | null> {
  const ok = await qdrantHealthOk();
  if (!ok) {
    logger.warn('Qdrant not reachable at ' + baseUrl());
    return null;
  }
  return { ok: true };
}
