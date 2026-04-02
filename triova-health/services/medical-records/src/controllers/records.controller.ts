import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { patient_id, document_type, document_date } = req.body;
    const file = req.file;

    if (!file) {
      return err(res, 'No file uploaded', 400);
    }

    const result = await pool.query(
      `INSERT INTO medical_documents (patient_id, document_type, file_url, file_name, file_size_bytes, mime_type, uploaded_by, document_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [patient_id, document_type, `/uploads/${file.filename}`, file.originalname, file.size, file.mimetype, user.id, document_date]
    );

    logger.info('Document uploaded', { documentId: result.rows[0].id, patientId: patient_id });

    return ok(res, { document_id: result.rows[0].id, processing_status: 'queued' }, 201);
  } catch (error) {
    logger.error('Upload failed', { error });
    return err(res, 'Failed to upload document', 500);
  }
};

export const getPatientDocuments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { patient_id } = req.params;
    const { document_type, from_date, to_date, is_processed, limit = 20, offset = 0 } = req.query;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    let query = `SELECT * FROM medical_documents WHERE patient_id = $1`;
    const params: any[] = [patient_id];

    if (document_type) {
      query += ` AND document_type = $${params.length + 1}`;
      params.push(document_type);
    }
    if (from_date) {
      query += ` AND document_date >= $${params.length + 1}`;
      params.push(from_date);
    }
    if (to_date) {
      query += ` AND document_date <= $${params.length + 1}`;
      params.push(to_date);
    }
    if (is_processed !== undefined) {
      query += ` AND is_processed = $${params.length + 1}`;
      params.push(is_processed === 'true');
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return ok(res, { documents: result.rows, total: result.rows.length });
  } catch (error) {
    logger.error('Get documents failed', { error });
    return err(res, 'Failed to get documents', 500);
  }
};

export const getDocument = async (req: Request, res: Response) => {
  try {
    const { document_id } = req.params;

    const result = await pool.query('SELECT * FROM medical_documents WHERE id = $1', [document_id]);

    if (result.rows.length === 0) {
      return err(res, 'Document not found', 404);
    }

    return ok(res, { document: result.rows[0] });
  } catch (error) {
    logger.error('Get document failed', { error });
    return err(res, 'Failed to get document', 500);
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { document_id } = req.params;

    await pool.query('DELETE FROM medical_documents WHERE id = $1', [document_id]);

    return ok(res, { message: 'Document deleted' });
  } catch (error) {
    logger.error('Delete document failed', { error });
    return err(res, 'Failed to delete document', 500);
  }
};

export const ragChat = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { patient_id, query, conversation_history, session_key } = req.body;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const docsResult = await pool.query(
      `SELECT id, file_name, extracted_text, document_type FROM medical_documents 
       WHERE patient_id = $1 AND is_processed = true`,
      [patient_id]
    );

    if (docsResult.rows.length === 0) {
      return ok(res, {
        answer: "This information is not available in the uploaded medical records. Please ensure the relevant document has been uploaded, or consult with your doctor.",
        source_documents: [],
        confidence_score: 0,
        is_from_records: false
      });
    }

    const queryLower = query.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const doc of docsResult.rows) {
      if (doc.extracted_text) {
        const text = doc.extracted_text.toLowerCase();
        const matches = queryLower.split(' ').filter(w => w.length > 3).filter(w => text.includes(w));
        const score = matches.length / queryLower.split(' ').filter(w => w.length > 3).length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = doc;
        }
      }
    }

    let answer = '';
    let confidence_score = 0;
    let is_from_records = false;

    if (bestMatch && bestScore > 0.4) {
      is_from_records = true;
      confidence_score = Math.round(bestScore * 100);
      
      if (bestScore < 0.6) {
        answer = `⚠️ The following is based on limited matching information and may not be fully accurate. `;
      }
      
      answer += `Based on the ${bestMatch.document_type} (${bestMatch.file_name}): ${bestMatch.extracted_text?.slice(0, 500) || 'No text available'}`;
    } else {
      answer = "This information is not available in the uploaded medical records. Please ensure the relevant document has been uploaded, or consult with your doctor.";
    }

    await pool.query(
      `INSERT INTO medical_record_chats (patient_id, queried_by, querier_role, query, response, source_document_ids, confidence_score, session_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [patient_id, user.id, user.role, query, answer, bestMatch ? [bestMatch.id] : [], confidence_score, session_key]
    );

    return ok(res, {
      answer,
      source_documents: bestMatch ? [bestMatch.id] : [],
      confidence_score,
      is_from_records
    });
  } catch (error) {
    logger.error('RAG chat failed', { error });
    return err(res, 'Failed to process query', 500);
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { patient_id } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const result = await pool.query(
      `SELECT * FROM medical_record_chats WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [patient_id, limit, offset]
    );

    return ok(res, { chats: result.rows });
  } catch (error) {
    logger.error('Get chat history failed', { error });
    return err(res, 'Failed to get chat history', 500);
  }
};

export const processDocument = async (documentId: string) => {
  try {
    const docResult = await pool.query('SELECT * FROM medical_documents WHERE id = $1', [documentId]);
    if (docResult.rows.length === 0) return;

    await pool.query(
      `UPDATE medical_documents SET is_processed = true, extracted_text = 'Sample extracted text for document processing' WHERE id = $1`,
      [documentId]
    );

    logger.info('Document processed', { documentId });
  } catch (error) {
    logger.error('Document processing failed', { error });
  }
};
