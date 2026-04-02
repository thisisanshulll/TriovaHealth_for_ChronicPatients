import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSearch, FileUp, MessageSquareText, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/api/axios-instance';
import { SectionCard } from '@/components/ui/SectionCard';
import { formatDateTime } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';
import type { MedicalDocument } from '@/types/domain';

const documentTypes = ['lab_report', 'prescription', 'imaging', 'discharge_summary', 'other'] as const;

interface ChatHistoryResponse {
  chats: Array<{
    id: string;
    query: string;
    response: string;
    confidence_score?: number;
    created_at: string;
  }>;
}

export default function MedicalRecords() {
  const patientId = useAuthStore((s) => s.patientId);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [selectedDocumentText, setSelectedDocumentText] = useState('');
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [documentType, setDocumentType] = useState<(typeof documentTypes)[number]>('lab_report');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');

  const documentsQuery = useQuery({
    queryKey: ['patient-documents', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<{ documents: MedicalDocument[] }>(`/medical-records/patient/${patientId}`)).data,
  });

  const chatHistoryQuery = useQuery({
    queryKey: ['patient-doc-chat-history', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<ChatHistoryResponse>(`/medical-records/chat-history/${patientId}`)).data,
  });

  async function askRecords(): Promise<void> {
    if (!patientId || !query.trim()) return;
    try {
      setBusy('ask');
      setMessage('');
      const res = await api.post<{ answer: string }>('/medical-records/chat', { patient_id: patientId, query });
      setAnswer(res.data.answer || '');
      setQuery('');
      await chatHistoryQuery.refetch();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to ask records AI');
    } finally {
      setBusy('');
    }
  }

  async function uploadDocument(): Promise<void> {
    if (!patientId || !uploadFile) return;
    try {
      setBusy('upload');
      setMessage('');
      const form = new FormData();
      form.append('patient_id', patientId);
      form.append('document_type', documentType);
      form.append('file', uploadFile);
      await api.upload('/medical-records/upload', form);
      setUploadFile(null);
      setMessage('Document uploaded and queued for processing.');
      await documentsQuery.refetch();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to upload document');
    } finally {
      setBusy('');
    }
  }

  async function previewDocument(documentId: string, fileName: string): Promise<void> {
    try {
      setBusy(`preview-${documentId}`);
      const res = await api.get<{ extracted_text?: string }>(`/medical-records/document/${documentId}`);
      setSelectedDocumentName(fileName);
      setSelectedDocumentText(res.data.extracted_text || 'No extracted text available yet.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to fetch document');
    } finally {
      setBusy('');
    }
  }

  async function deleteDocument(documentId: string): Promise<void> {
    try {
      setBusy(`delete-${documentId}`);
      await api.delete(`/medical-records/document/${documentId}`);
      setMessage('Document deleted.');
      if (selectedDocumentName && documentsQuery.data?.documents.find((doc) => doc.id === documentId)) {
        setSelectedDocumentName('');
        setSelectedDocumentText('');
      }
      await documentsQuery.refetch();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to delete document');
    } finally {
      setBusy('');
    }
  }

  async function exportPdf(): Promise<void> {
    if (!patientId) return;
    try {
      await api.download(`/medical-records/export/${patientId}`, `TRIOVA_${patientId}_history.pdf`);
      setMessage('Medical history PDF downloaded.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Failed to export PDF');
    }
  }

  if (!patientId) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Patient session not found. Please login again.</div>;
  }

  return (
    <div className="space-y-6">
      {message && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div>}

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Upload records" subtitle="Add prescriptions, scans, and reports">
          <div className="space-y-3">
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as (typeof documentTypes)[number])} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none">
              {documentTypes.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <FileUp size={14} />
              {uploadFile ? uploadFile.name : 'Choose file'}
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
            </label>
            <button type="button" disabled={!uploadFile || busy === 'upload'} onClick={uploadDocument} className="w-full rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60">
              {busy === 'upload' ? 'Uploading...' : 'Upload document'}
            </button>
            <button type="button" onClick={exportPdf} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Download size={14} />
              Export full medical history
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Records assistant" subtitle="Ask questions from uploaded documents" right={<MessageSquareText size={16} className="text-triova-700" />}>
          <div className="space-y-3">
            <textarea rows={4} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-triova-500" placeholder="Ask about medications, tests, reports..." />
            <button type="button" disabled={!query.trim() || busy === 'ask'} onClick={askRecords} className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60">
              {busy === 'ask' ? 'Thinking...' : 'Ask records AI'}
            </button>
            {answer && <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{answer}</div>}
          </div>
        </SectionCard>

        <SectionCard title="Recent chat history" subtitle="Previous records conversations">
          <div className="space-y-3">
            {(chatHistoryQuery.data?.chats || []).slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Q: {item.query}</p>
                <p className="mt-1 text-sm text-slate-700">A: {item.response}</p>
              </div>
            ))}
            {!chatHistoryQuery.data?.chats.length && <p className="text-sm text-slate-500">No chat history yet.</p>}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Uploaded documents" subtitle="Processing status and quick actions">
          <div className="space-y-3">
            {(documentsQuery.data?.documents || []).map((document) => (
              <div key={document.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-sm font-semibold text-slate-900">{document.file_name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${document.is_processed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {document.is_processed ? 'processed' : 'queued'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{document.document_type.replace('_', ' ')} • {formatDateTime(document.created_at)}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy === `preview-${document.id}`} onClick={() => previewDocument(document.id, document.file_name)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <FileSearch size={12} />
                    Preview text
                  </button>
                  <button type="button" disabled={busy === `delete-${document.id}`} onClick={() => deleteDocument(document.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                    <Trash2 size={12} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!documentsQuery.data?.documents.length && <p className="text-sm text-slate-500">No records uploaded yet.</p>}
          </div>
        </SectionCard>

        <SectionCard title={selectedDocumentName || 'Document preview'} subtitle={selectedDocumentName ? 'Extracted OCR/PDF text' : 'Choose a document to preview text'}>
          <div className="max-h-[32rem] overflow-auto rounded-xl bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-700">
            {selectedDocumentText || 'No document selected.'}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
