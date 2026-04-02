import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const LOCAL_ROOT = process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), 'uploads');

export async function ensureLocalDir(sub: string) {
  const dir = path.join(LOCAL_ROOT, sub);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Save buffer and return public URL path served by Express /files */
export async function saveMedicalDocument(
  patientId: string,
  documentType: string,
  originalName: string,
  buffer: Buffer
): Promise<{ fileUrl: string; filePath: string }> {
  const year = new Date().getFullYear();
  const ts = Date.now();
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const rel = `medical-documents/${patientId}/${year}/${documentType}/${ts}_${safe}`;
  const dir = await ensureLocalDir(path.dirname(rel));
  const filePath = path.join(LOCAL_ROOT, rel);
  await fs.writeFile(filePath, buffer);
  const fileUrl = `/files/${rel}`;
  return { fileUrl, filePath };
}

export async function saveTriageImage(sessionId: string, buffer: Buffer, ext: string) {
  const rel = `triage-images/${sessionId}/${Date.now()}.${ext}`;
  const dir = await ensureLocalDir(path.dirname(rel));
  const filePath = path.join(LOCAL_ROOT, rel);
  await fs.writeFile(filePath, buffer);
  return { fileUrl: `/files/${rel}`, filePath };
}

export function isSupabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
