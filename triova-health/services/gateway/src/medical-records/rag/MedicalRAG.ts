import { logger } from '@triova/shared';
import { getQdrantHttp, qdrantSearch } from '../../lib/qdrant-http.js';
import { pool } from '@triova/shared';
import { getOpenAI, getChatModel, withOpenAIRetry } from '../../lib/openai.js';
import OpenAI from 'openai';

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
  const qdrantReady = await getQdrantHttp();
  const hasAIKeyConfigured = !!process.env.GROQ_API_KEY;
  if (!qdrantReady && !hasAIKeyConfigured) {
    throw Object.assign(new Error('AI service not configured. Please set GROQ_API_KEY in .env'), { status: 503 });
  }

  const vector = localEmbedding(query);

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
  }

  let context = '';
  let docIds: string[] = [];
  let confidenceScore = 0;

  if (results.length > 0 && results[0].score >= 0.3) {
    const chunks = results.filter((r) => r.score >= 0.1).map((r) => String(r.payload.chunk_text || ''));
    context = chunks.join('\n\n=== NEXT DOCUMENT ===\n\n');
    docIds = [
      ...new Set(results.map((r) => String(r.payload.document_id || '')).filter(Boolean)),
    ] as string[];
    confidenceScore = Math.round((results[0].score || 0) * 100);
  } else {
    logger.info('No Qdrant results, fetching ALL documents from database');
    const docs = await pool.query(
      `SELECT id, document_type, file_name, extracted_text, created_at FROM medical_documents 
       WHERE patient_id = $1 AND extracted_text IS NOT NULL AND LENGTH(extracted_text) > 10
       ORDER BY created_at DESC`,
      [patientId]
    );
    
    logger.info('Found documents count:', docs.rows.length);
    
    if (docs.rows.length > 0) {
      context = docs.rows.map((doc: { document_type: string; file_name: string; extracted_text: string; created_at: string }) => 
        `--- DOCUMENT: ${doc.file_name} (${doc.document_type}) ---\nDate: ${doc.created_at}\n\n${doc.extracted_text}`
      ).join('\n\n=== NEXT DOCUMENT ===\n\n');
      docIds = docs.rows.map((doc: { id: string }) => doc.id);
      confidenceScore = 80;
    }
  }

  if (!context) {
    if (!hasAIKeyConfigured) {
      return {
        answer: 'RAG service not configured. Please set GROQ_API_KEY in environment.',
        source_documents: [],
        confidence_score: 0,
        is_from_records: false,
      };
    }
    return {
      answer: NOT_FOUND,
      source_documents: [],
      confidence_score: 0,
      is_from_records: false,
    };
  }

  if (!hasAIKeyConfigured) {
    return {
      answer: `Found relevant documents (${docIds.length} sources) but GROQ_API_KEY not configured.`,
      source_documents: docIds,
      confidence_score: confidenceScore,
      is_from_records: true,
    };
  }

  const openai = getOpenAI();
  if (!openai) {
    return {
      answer: `Found ${docIds.length} document(s) but AI service not available. Please configure GROQ_API_KEY.`,
      source_documents: docIds,
      confidence_score: confidenceScore,
      is_from_records: true,
    };
  }

  const model = getChatModel();
  logger.info('Using Groq API to answer question with context length:', context.length);

  const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
    role: 'system',
    content: `You are TRIOVA's medical records assistant. Your role is to help doctors analyze patient medical reports and answer queries about them. 

Guidelines:
1. Answer ONLY from the provided context (patient's medical documents)
2. If the answer is not in the context, say: "${NOT_FOUND}"
3. Do not provide medical advice - direct patients to consult their doctor
4. Be clear and concise when summarizing medical information from reports
5. When referencing documents, mention what type of document it is (prescription, lab report, etc.)
6. Analyze all documents in the context to provide comprehensive answers`
  };

  const userMessage: OpenAI.Chat.ChatCompletionMessageParam = {
    role: 'user',
    content: `Context from medical documents:\n${context}\n\nQuestion: ${query}`
  };

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [systemMessage, userMessage];

  const hist = conversationHistory.slice(-10);
  for (const h of hist) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role as 'user' | 'assistant', content: h.content });
    }
  }

  try {
    const completion = await withOpenAIRetry(() =>
      openai.chat.completions.create({
        model,
        messages,
        max_tokens: 800,
        temperature: 0.3,
      })
    );
    const answer = completion.choices[0]?.message?.content || NOT_FOUND;
    return {
      answer,
      source_documents: docIds,
      confidence_score: confidenceScore,
      is_from_records: true,
    };
  } catch (e) {
    logger.error('Groq API failed', e);
    return {
      answer: `Found ${docIds.length} document(s) but AI service temporarily unavailable. Context preview: ${context.slice(0, 500)}...`,
      source_documents: docIds,
      confidence_score: confidenceScore,
      is_from_records: true,
    };
  }
}
