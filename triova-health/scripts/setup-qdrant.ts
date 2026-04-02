import 'dotenv/config';

const base = (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.QDRANT_API_KEY) h['api-key'] = process.env.QDRANT_API_KEY;
  return h;
}

async function setupCollections() {
  const r = await fetch(`${base}/collections/medical_documents`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      vectors: { size: 1536, distance: 'Cosine' },
      optimizers_config: { indexing_threshold: 100 },
    }),
  });

  if (r.ok) {
    console.log('Qdrant collection medical_documents created');
    return;
  }

  const text = await r.text();
  if (r.status === 409 || text.toLowerCase().includes('already') || text.includes('Conflict')) {
    console.log('Collection already exists (OK)');
    return;
  }
  throw new Error(`Qdrant error ${r.status}: ${text}`);
}

setupCollections().catch((e) => {
  console.error(e);
  process.exit(1);
});
