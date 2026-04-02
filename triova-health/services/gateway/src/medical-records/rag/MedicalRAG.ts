import OpenAI from 'openai';
import { getChatModel, getEmbeddingModel, getOpenAI, withOpenAIRetry } from '../../lib/openai.js';
import { logger } from '@triova/shared';
import { getQdrantHttp, qdrantSearch } from '../../lib/qdrant-http.js';

const COLLECTION = 'medical_documents';
const LOCAL_EMBEDDING_DIM = Number(process.env.LOCAL_EMBEDDING_DIM || 1536);

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

function localEmbedding(text: string, dim = LOCAL_EMBEDDING_DIM): number[] {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const source = tokens.length ? tokens : [text.slice(0, 2000).toLowerCase()];
  for (const token of source) {
    const idx = hashToken(token) % dim;
    vec[idx] += 1;
  }
  return normalize(vec);
}

export async function getQdrantAsync(): Promise<{ ok: true } | null> {
  return getQdrantHttp();
}

export async function embedChunks(openai: OpenAI, chunks: string[]): Promise<number[][]> {
  const model = getEmbeddingModel();
  if (!model) return chunks.map((chunk) => localEmbedding(chunk));
  try {
    const res = await withOpenAIRetry(() => openai.embeddings.create({ model, input: chunks }));
    return res.data.map((d) => d.embedding);
  } catch (e) {
    logger.warn('Embedding API failed; using local embedding fallback', e);
    return chunks.map((chunk) => localEmbedding(chunk));
  }
}

const NOT_FOUND =
  'This information is not available in the uploaded medical records. Please ensure the relevant document has been uploaded, or consult with your doctor.';

export async function ragAnswer(
  patientId: string,
  query: string,
  conversationHistory: { role: string; content: string }[]
): Promise<{
  answer: string;
  source_documents: string[];
  confidence_score: number;
  is_from_records: boolean;
}> {
  const openai = getOpenAI();
  const qdrantReady = await getQdrantHttp();
  if (!qdrantReady || !openai) {
    throw Object.assign(new Error('RAG service temporarily unavailable'), { status: 503 });
  }

  const model = getEmbeddingModel();
  let vector: number[];
  if (!model) {
    vector = localEmbedding(query);
  } else {
    try {
      const qEmb = await withOpenAIRetry(() => openai.embeddings.create({ model, input: query }));
      vector = qEmb.data[0].embedding;
    } catch (e) {
      logger.warn('Query embedding API failed; using local embedding fallback', e);
      vector = localEmbedding(query);
    }
  }

  let results: { id: string | number; score: number; payload: Record<string, unknown> }[] = [];
  try {
    results = await qdrantSearch(COLLECTION, {
      vector,
      limit: 8,
      with_payload: true,
      filter: {
        must: [{ key: 'patient_id', match: { value: patientId } }],
      },
    });
  } catch (e) {
    logger.error('Qdrant search failed', e);
    throw Object.assign(new Error('RAG service temporarily unavailable'), { status: 503 });
  }

  const top = results[0];
  if (!top || top.score < 0.4) {
    return {
      answer: NOT_FOUND,
      source_documents: [],
      confidence_score: 0,
      is_from_records: false,
    };
  }

  const chunks = results.filter((r) => r.score >= 0.35).map((r) => String(r.payload.chunk_text || ''));
  const context = chunks.join('\n---\n');
  const docIds = [
    ...new Set(results.map((r) => String(r.payload.document_id || '')).filter(Boolean)),
  ] as string[];

  const low = top.score < 0.6;
  const prefix = low
    ? '⚠️ The following is based on limited matching information and may not be fully accurate. Please verify with your doctor.\n\n'
    : '';

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are TRIOVA's medical records assistant. Answer ONLY from context. If not in context, say: "${NOT_FOUND}". No medical advice.`,
    },
    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${query}` },
  ];
  const hist = conversationHistory.slice(-10);
  for (const h of hist) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role as 'user' | 'assistant', content: h.content });
    }
  }

  const completion = await withOpenAIRetry(() =>
    openai.chat.completions.create({
      model: getChatModel(),
      messages,
      max_tokens: 800,
    })
  );
  const answer = prefix + (completion.choices[0]?.message?.content || NOT_FOUND);
  return {
    answer,
    source_documents: docIds,
    confidence_score: Math.round((top.score || 0) * 100),
    is_from_records: true,
  };
}
