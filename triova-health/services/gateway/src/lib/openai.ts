import OpenAI from 'openai';

let client: OpenAI | null = null;

type AIProvider = 'openai' | 'groq';

function resolveProvider(): AIProvider | null {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === 'openai' || explicit === 'groq') return explicit;
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function resolveApiKey(provider: AIProvider): string {
  return provider === 'groq' ? String(process.env.GROQ_API_KEY || '') : String(process.env.OPENAI_API_KEY || '');
}

function resolveBaseUrl(provider: AIProvider): string | undefined {
  if (provider === 'groq') return process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
  return process.env.OPENAI_BASE_URL || undefined;
}

export function getAIProviderName(): AIProvider | null {
  return resolveProvider();
}

export function getChatModel(): string {
  const provider = resolveProvider();
  if (provider === 'groq') {
    return process.env.GROQ_MODEL || process.env.OPENAI_MODEL || 'llama-3.3-70b-versatile';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o';
}

export function getTranscriptionModel(): string {
  const provider = resolveProvider();
  if (provider === 'groq') {
    return process.env.GROQ_WHISPER_MODEL || process.env.OPENAI_WHISPER_MODEL || 'whisper-large-v3-turbo';
  }
  return process.env.OPENAI_WHISPER_MODEL || 'whisper-1';
}

export function getEmbeddingModel(): string | null {
  const provider = resolveProvider();
  if (provider === 'groq') {
    return process.env.GROQ_EMBEDDING_MODEL || null;
  }
  return process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
}

export function getOpenAI(): OpenAI | null {
  const provider = resolveProvider();
  if (!provider) return null;
  const key = resolveApiKey(provider);
  if (!key) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: key,
      baseURL: resolveBaseUrl(provider),
    });
  }
  return client;
}

export async function withOpenAIRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}
