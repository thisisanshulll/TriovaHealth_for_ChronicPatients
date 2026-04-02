import { pool } from '@triova/shared';
import { documentProcessingQueue } from '@triova/shared';
import { saveMedicalDocument } from '../../lib/storage.js';
import { chunkText } from '../rag/chunker.js';
import { embedChunks, getQdrantAsync } from '../rag/MedicalRAG.js';
import { qdrantUpsert } from '../../lib/qdrant-http.js';
import { getOpenAI } from '../../lib/openai.js';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { extractPdfText } from '../processors/pdf-processor.js';
import { ocrImageBuffer } from '../processors/image-processor.js';
import { extractMedicationsFromPrescription } from './medication-extractor.service.js';
import { ragAnswer } from '../rag/MedicalRAG.js';
import { emitToUser } from '../../socket-server.js';
import { logger } from '@triova/shared';

export async function queueDocumentProcessing(documentId: string, patientId: string, fileUrl: string, documentType: string, mimeType: string) {
  await documentProcessingQueue.add(
    'processDocument',
    { documentId, patientId, fileUrl, documentType, mimeType, retryCount: 0 },
    { attempts: 3, backoff: { type: 'exponential', delay: 60000 } }
  );
}

export async function createUpload(
  patientId: string,
  userId: string,
  document_type: string,
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  document_date?: string
) {
  const { fileUrl } = await saveMedicalDocument(patientId, document_type, originalName, buffer);
  const ins = await pool.query(
    `INSERT INTO medical_documents (patient_id, document_type, file_url, file_name, file_size_bytes, mime_type, uploaded_by, document_date, is_processed)
     VALUES ($1,$2::document_type,$3,$4,$5,$6,$7,$8::date,false) RETURNING *`,
    [
      patientId,
      document_type,
      fileUrl,
      originalName,
      buffer.length,
      mimeType,
      userId,
      document_date || null,
    ]
  );
  const doc = ins.rows[0];
  await queueDocumentProcessing(doc.id, patientId, fileUrl, document_type, mimeType);
  return { document_id: doc.id, processing_status: 'queued' as const };
}

export async function processDocumentJob(data: {
  documentId: string;
  patientId: string;
  fileUrl: string;
  documentType: string;
  mimeType: string;
}) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const localPath = data.fileUrl.startsWith('/files/')
    ? path.join(process.cwd(), 'uploads', data.fileUrl.replace('/files/', ''))
    : data.fileUrl;
  let text = '';
  try {
    const buf = await fs.readFile(localPath);
    if (data.mimeType === 'application/pdf') {
      text = await extractPdfText(buf);
    } else if (data.mimeType.startsWith('image/')) {
      text = await ocrImageBuffer(buf);
    } else {
      text = await ocrImageBuffer(buf);
    }
    await pool.query(`UPDATE medical_documents SET extracted_text = $2 WHERE id = $1`, [data.documentId, text]);

    if (data.documentType === 'prescription') {
      await extractMedicationsFromPrescription(data.patientId, text);
    }

    const chunks = await chunkText(text);
    const openai = getOpenAI();
    const qdrantReady = await getQdrantAsync();
    if (openai && qdrantReady && chunks.length) {
      const embeddings = await embedChunks(openai, chunks);
      const points = chunks.map((chunk_text, i) => ({
        id: randomUUID(),
        vector: embeddings[i],
        payload: {
          patient_id: data.patientId,
          document_id: data.documentId,
          document_type: data.documentType,
          chunk_text,
          chunk_index: i,
          file_name: data.fileUrl,
        },
      }));
      await qdrantUpsert(
        'medical_documents',
        points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload }))
      );
    }

    await pool.query(`UPDATE medical_documents SET is_processed = true, processing_error = NULL WHERE id = $1`, [
      data.documentId,
    ]);
    const u = await pool.query(`SELECT user_id FROM patients WHERE id = $1`, [data.patientId]);
    if (u.rows[0]) {
      emitToUser(u.rows[0].user_id, 'document_processed', { document_id: data.documentId, success: true });
    }
  } catch (e) {
    logger.error('Document processing failed', e);
    await pool.query(
      `UPDATE medical_documents SET retry_count = retry_count + 1, processing_error = $2 WHERE id = $1`,
      [data.documentId, String(e)]
    );
    const d = await pool.query(`SELECT retry_count FROM medical_documents WHERE id = $1`, [data.documentId]);
    if (d.rows[0]?.retry_count >= 3) {
      const pu = await pool.query(`SELECT user_id FROM patients WHERE id = $1`, [data.patientId]);
      if (pu.rows[0]) {
        await pool.query(
          `INSERT INTO notifications (user_id, notification_type, title, message, sent_at) VALUES ($1,'message',$2,$3,NOW())`,
          [
            pu.rows[0].user_id,
            'Document processing failed',
            'Document processing failed. Please re-upload or contact support.',
          ]
        );
      }
    }
    throw e;
  }
}

export async function listDocuments(patientId: string, q: Record<string, string>) {
  let sql = `SELECT * FROM medical_documents WHERE patient_id = $1`;
  const p: unknown[] = [patientId];
  let i = 2;
  if (q.document_type) {
    sql += ` AND document_type = $${i++}::document_type`;
    p.push(q.document_type);
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const r = await pool.query(sql, p);
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM medical_documents WHERE patient_id = $1`, [patientId]);
  return { documents: r.rows, total: c.rows[0].n };
}

export async function getDocument(documentId: string) {
  const r = await pool.query(`SELECT * FROM medical_documents WHERE id = $1`, [documentId]);
  if (!r.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const d = r.rows[0];
  return {
    document: d,
    signed_url: d.file_url,
    extracted_text: d.extracted_text,
  };
}

export async function deleteDocument(documentId: string, patientId: string | null, role: string) {
  if (role === 'admin') {
    await pool.query(`DELETE FROM medical_documents WHERE id = $1`, [documentId]);
  } else if (patientId) {
    await pool.query(`DELETE FROM medical_documents WHERE id = $1 AND patient_id = $2`, [documentId, patientId]);
  } else {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return { message: 'Deleted' };
}

export async function chatRecords(input: {
  patient_id: string;
  userId: string;
  role: string;
  query: string;
  conversation_history?: { role: string; content: string }[];
  session_key?: string;
}) {
  const r = await ragAnswer(input.patient_id, input.query, input.conversation_history || []);
  const srcIds = r.source_documents?.length ? r.source_documents : null;
  await pool.query(
    `INSERT INTO medical_record_chats (patient_id, queried_by, querier_role, query, response, source_document_ids, confidence_score, session_key)
     VALUES ($1,$2,$3::user_role,$4,$5,$6::uuid[],$7,$8)`,
    [
      input.patient_id,
      input.userId,
      input.role as 'patient' | 'doctor' | 'admin',
      input.query,
      r.answer,
      srcIds,
      r.confidence_score,
      input.session_key || null,
    ]
  );
  return {
    answer: r.answer,
    source_documents: r.source_documents,
    confidence_score: r.confidence_score,
    is_from_records: r.is_from_records,
  };
}

export async function chatHistory(patientId: string) {
  const r = await pool.query(
    `SELECT * FROM medical_record_chats WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [patientId]
  );
  return { chats: r.rows };
}

export async function exportPdf(patientId: string, res: Response) {
  const patient = await pool.query(`SELECT * FROM patients WHERE id = $1`, [patientId]);
  if (!patient.rows[0]) throw Object.assign(new Error('Not found'), { status: 404 });
  const p = patient.rows[0];
  const allergies = await pool.query(`SELECT * FROM patient_allergies WHERE patient_id = $1`, [patientId]);
  const conditions = await pool.query(`SELECT * FROM patient_chronic_conditions WHERE patient_id = $1`, [patientId]);
  const meds = await pool.query(`SELECT * FROM patient_medications WHERE patient_id = $1`, [patientId]);
  const triage = await pool.query(
    `SELECT * FROM triage_sessions WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [patientId]
  );
  const consults = await pool.query(
    `SELECT c.*, d.first_name AS df, d.last_name AS dl FROM consultations c JOIN doctors d ON d.id = c.doctor_id WHERE c.patient_id = $1 ORDER BY c.created_at DESC`,
    [patientId]
  );
  const wear = await pool.query(
    `SELECT * FROM wearable_data WHERE patient_id = $1 AND recorded_at > NOW() - INTERVAL '30 days' ORDER BY recorded_at`,
    [patientId]
  );
  const alerts = await pool.query(`SELECT * FROM health_alerts WHERE patient_id = $1 AND status = 'active'`, [patientId]);

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="TRIOVA_${p.last_name}_${Date.now()}.pdf"`
  );
  doc.pipe(res);
  doc.fontSize(20).text('TRIOVA Health — Medical History', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Patient: ${p.first_name} ${p.last_name}`);
  doc.text(`DOB: ${p.date_of_birth}`);
  doc.text(`Blood: ${p.blood_group || 'N/A'}`);
  doc.text(`Export: ${new Date().toISOString()}`);
  doc.moveDown();
  doc.fontSize(14).text('Chronic conditions');
  conditions.rows.forEach((c: { condition_name: string }) => doc.fontSize(10).text(`- ${c.condition_name}`));
  doc.moveDown();
  doc.fontSize(14).text('Allergies');
  allergies.rows.forEach((a: { allergen: string }) => doc.fontSize(10).text(`- ${a.allergen}`));
  doc.moveDown();
  doc.fontSize(14).text('Medications');
  meds.rows.forEach((m: { medication_name: string; dosage: string }) =>
    doc.fontSize(10).text(`${m.medication_name} ${m.dosage || ''}`)
  );
  doc.moveDown();
  doc.fontSize(14).text('Triage (last 5)');
  triage.rows.forEach((t: { chief_complaint: string; urgency_level: string; ai_summary: string }) =>
    doc.fontSize(10).text(`${t.chief_complaint} — ${t.urgency_level}\n${t.ai_summary || ''}`)
  );
  doc.moveDown();
  doc.fontSize(14).text('Consultations');
  consults.rows.forEach(
    (c: { diagnosis: string; df: string; dl: string; created_at: string }) =>
      doc.fontSize(10).text(`${c.df} ${c.dl}: ${c.diagnosis || 'N/A'}`)
  );
  doc.moveDown();
  doc.fontSize(14).text('Wearable summary (30d)');
  doc.fontSize(10).text(`Readings: ${wear.rows.length}`);
  doc.moveDown();
  doc.fontSize(14).text('Active alerts');
  alerts.rows.forEach((a: { alert_message: string }) => doc.fontSize(10).text(a.alert_message));
  doc.end();
}
