import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSearch, FileUp, MessageSquareText, RefreshCw, Trash2 } from 'lucide-react';
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
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');
  const [selectedDocumentText, setSelectedDocumentText] = useState('');
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [documentType, setDocumentType] = useState<(typeof documentTypes)[number]>('lab_report');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');

  const documentsQuery = useQuery({
    queryKey: ['patient-documents', patientId],
    enabled: !!patientId,
    refetchInterval: 10000, // Poll every 10s to catch processing completion
    queryFn: async () => (await api.get<{ documents: MedicalDocument[] }>(`/medical-records/patient/${patientId}`)).data,
  });

  const chatHistoryQuery = useQuery({
    queryKey: ['patient-doc-chat-history', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<ChatHistoryResponse>(`/medical-records/chat-history/${patientId}`)).data,
  });

  function showMessage(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    setMessage(msg);
    setMessageType(type);
  }

  async function askRecords(): Promise<void> {
    if (!patientId || !query.trim()) return;
    try {
      setBusy('ask');
      setAnswer('');
      showMessage('', 'info');
      const res = await api.post<{ answer: string; is_from_records: boolean }>('/medical-records/chat', {
        patient_id: patientId,
        query,
      });
      setAnswer(res.data.answer || '');
      setQuery('');
      await chatHistoryQuery.refetch();
    } catch (error) {
      showMessage(error instanceof ApiError ? error.message : 'Failed to ask records AI', 'error');
    } finally {
      setBusy('');
    }
  }

  async function uploadDocument(): Promise<void> {
    if (!patientId || !uploadFile) return;
    try {
      setBusy('upload');
      showMessage('Uploading...', 'info');
      const form = new FormData();
      form.append('patient_id', patientId);
      form.append('document_type', documentType);
      form.append('file', uploadFile);
      form.append('document_date', new Date().toISOString().slice(0, 10));

      await api.upload('/medical-records/upload', form);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showMessage('✅ Document uploaded and queued for processing. It will appear below shortly.', 'success');
      // Refetch after a small delay to see the new document
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] }), 1000);
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : 'Failed to upload document';
      showMessage(`❌ Upload failed: ${msg}`, 'error');
    } finally {
      setBusy('');
    }
  }

  async function previewDocument(documentId: string, fileName: string): Promise<void> {
    try {
      setBusy(`preview-${documentId}`);
      const res = await api.get<{ extracted_text?: string }>(`/medical-records/document/${documentId}`);
      setSelectedDocumentName(fileName);
      setSelectedDocumentText(res.data.extracted_text || 'No extracted text available yet. The document may still be processing.');
    } catch (error) {
      showMessage(error instanceof ApiError ? error.message : 'Failed to fetch document', 'error');
    } finally {
      setBusy('');
    }
  }

  async function deleteDocument(documentId: string): Promise<void> {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      setBusy(`delete-${documentId}`);
      await api.delete(`/medical-records/document/${documentId}`);
      showMessage('Document deleted.', 'success');
      if (selectedDocumentName && documentsQuery.data?.documents.find((doc) => doc.id === documentId)) {
        setSelectedDocumentName('');
        setSelectedDocumentText('');
      }
      await documentsQuery.refetch();
    } catch (error) {
      showMessage(error instanceof ApiError ? error.message : 'Failed to delete document', 'error');
    } finally {
      setBusy('');
    }
  }

  async function exportPdf(): Promise<void> {
    if (!patientId) return;
    try {
      await api.download(`/medical-records/export/${patientId}`, `TRIOVA_${patientId}_history.pdf`);
      showMessage('✅ Medical history PDF downloaded.', 'success');
    } catch (error) {
      showMessage(error instanceof ApiError ? error.message : 'Failed to export PDF', 'error');
    }
  }

  if (!patientId) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Patient session not found. Please login again.</div>;
  }

  const msgClasses = {
    info: 'bg-slate-50 border border-slate-200 text-slate-700',
    success: 'bg-emerald-50 border border-emerald-200 text-emerald-800',
    error: 'bg-red-50 border border-red-200 text-red-800',
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${msgClasses[messageType]}`}>{message}</div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Upload Panel */}
        <SectionCard title="Upload records" subtitle="Add prescriptions, scans, and reports">
          <div className="space-y-3">
            <select
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value as (typeof documentTypes)[number])}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none"
            >
              {documentTypes.map((type) => (
                <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
              ))}
            </select>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 transition hover:border-triova-500 hover:bg-slate-50">
              <FileUp size={24} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-600">
                {uploadFile ? uploadFile.name : 'Click to choose file (PDF or image)'}
              </span>
              <span className="text-xs text-slate-400">Supported: PDF, JPG, PNG, WebP</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
            </label>

            {uploadFile && (
              <div className="flex items-center justify-between rounded-xl bg-triova-50 border border-triova-200 px-3 py-2">
                <span className="text-xs font-medium text-triova-800 truncate">{uploadFile.name}</span>
                <button type="button" onClick={() => { setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-slate-400 hover:text-red-500 ml-2">
                  ×
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={!uploadFile || busy === 'upload'}
              onClick={uploadDocument}
              className="w-full rounded-xl bg-triova-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'upload' ? 'Uploading...' : 'Upload document'}
            </button>

            <button type="button" onClick={exportPdf} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Download size={14} />
              Export full medical history
            </button>
          </div>
        </SectionCard>

        {/* RAG Chat */}
        <SectionCard title="Records assistant" subtitle="Ask questions from your uploaded documents" right={<MessageSquareText size={16} className="text-triova-700" />}>
          <div className="space-y-3">
            <textarea
              rows={4}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askRecords(); }}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-triova-500"
              placeholder="Ask about medications, test results, diagnoses... (Ctrl+Enter to send)"
            />
            <button
              type="button"
              disabled={!query.trim() || busy === 'ask'}
              onClick={askRecords}
              className="rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'ask' ? 'Thinking...' : 'Ask records AI'}
            </button>
            {answer && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 whitespace-pre-wrap max-h-64 overflow-auto">
                <p className="text-xs font-semibold text-slate-400 mb-1">AI Answer</p>
                {answer}
              </div>
            )}
          </div>
        </SectionCard>

        {/* Chat History */}
        <SectionCard title="Recent chat history" subtitle="Previous records conversations">
          <div className="space-y-3 max-h-96 overflow-auto">
            {(chatHistoryQuery.data?.chats || []).slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">Q: {item.query}</p>
                <p className="mt-1 text-sm text-slate-700 line-clamp-3">A: {item.response}</p>
              </div>
            ))}
            {!chatHistoryQuery.data?.chats.length && <p className="text-sm text-slate-500">No chat history yet.</p>}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Uploaded documents"
          subtitle="Processing status and quick actions"
          right={
            <button type="button" onClick={() => documentsQuery.refetch()} className="text-slate-500 hover:text-slate-700">
              <RefreshCw size={14} />
            </button>
          }
        >
          <div className="space-y-3">
            {(documentsQuery.data?.documents || []).map((document) => (
              <div key={document.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-sm font-semibold text-slate-900">{document.file_name}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${document.is_processed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {document.is_processed ? '✓ processed' : '⏳ processing'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{document.document_type.replace(/_/g, ' ')} • {formatDateTime(document.created_at)}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === `preview-${document.id}`}
                    onClick={() => previewDocument(document.id, document.file_name)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileSearch size={12} />
                    Preview text
                  </button>
                  <button
                    type="button"
                    disabled={busy === `delete-${document.id}`}
                    onClick={() => deleteDocument(document.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!documentsQuery.data?.documents.length && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
                <FileUp size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-500">No records uploaded yet.</p>
                <p className="text-xs text-slate-400 mt-1">Upload a document above to get started.</p>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={selectedDocumentName || 'Document preview'}
          subtitle={selectedDocumentName ? 'Extracted OCR/PDF text' : 'Click "Preview text" on a document'}
        >
          <div className="max-h-[32rem] overflow-auto rounded-xl bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-700 font-mono leading-relaxed">
            {selectedDocumentText || 'Select a document to preview its extracted text.'}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
