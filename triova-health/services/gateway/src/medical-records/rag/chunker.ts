/** Chunk size 1000, overlap 200 — mirrors RecursiveCharacterTextSplitter behavior */
export async function chunkText(text: string): Promise<string[]> {
  const size = 1000;
  const overlap = 200;
  const chunks: string[] = [];
  if (!text?.trim()) return [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return chunks.filter((c) => c.trim().length > 0);
}
