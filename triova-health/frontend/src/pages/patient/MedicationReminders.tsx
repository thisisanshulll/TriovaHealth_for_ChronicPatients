import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Calendar, Check, Edit2, Pill, Trash2, Upload, X } from 'lucide-react';
import { ApiError, api } from '@/api/axios-instance';
import { SectionCard } from '@/components/ui/SectionCard';
import { useAuthStore } from '@/store/auth.store';

interface Medication {
  id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  timing_instructions: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  source: string;
}

interface Reminder {
  id: string;
  medication_id: string;
  reminder_time: string;
  is_active: boolean;
  medication_name: string;
}

interface ExtractedMedication {
  medication_name: string;
  dosage: string;
  frequency: string;
  timing: string;
  duration_days: number;
  instructions: string;
}

export default function MedicationReminders() {
  const patientId = useAuthStore((s) => s.patientId);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractedMeds, setExtractedMeds] = useState<ExtractedMedication[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error'>('info');

  const medicationsQuery = useQuery({
    queryKey: ['patient-medications', patientId],
    enabled: !!patientId,
    refetchInterval: 5000,
    queryFn: async () =>
      (
        await api.get<{ medications: Medication[]; reminders: Reminder[] }>(
          `/medications/patient/${patientId}`
        )
      ).data,
  });

  const activeMeds = (medicationsQuery.data?.medications || []).filter((m) => m.is_active);
  const reminders = medicationsQuery.data?.reminders || [];

  function showMsg(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    setMessage(msg);
    setMessageType(type);
  }

  // ── Extract medications from prescription image/PDF ──
  const extractMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('patient_id', patientId!);
      form.append('document_type', 'prescription');
      const res = await api.upload<{ extracted_medications: ExtractedMedication[]; message: string }>(
        '/medical-records/extract-medications',
        form
      );
      return res.data;
    },
    onSuccess: (data) => {
      setExtractedMeds(data.extracted_medications || []);
      if ((data.extracted_medications || []).length > 0) {
        showMsg(
          `✅ Found ${data.extracted_medications.length} medication(s). Review and confirm below.`,
          'success'
        );
      } else {
        showMsg(
          '⚠️ No medications detected in this image. Make sure the prescription text is clear and visible.',
          'error'
        );
      }
    },
    onError: (error) => {
      showMsg(
        `❌ ${error instanceof ApiError ? error.message : 'Failed to extract medications from prescription'}`,
        'error'
      );
    },
  });

  // ── Add a single confirmed medication for the patient ──
  const addMedicationMutation = useMutation({
    mutationFn: async (med: ExtractedMedication) => {
      const times = getReminderTimes(med.frequency);
      await api.post('/medications', {
        patient_id: patientId,
        medication_name: med.medication_name,
        dosage: med.dosage,
        frequency: med.frequency,
        timing_instructions: med.timing || med.instructions || '',
        duration_days: med.duration_days || 7,
        reminder_times: times,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-medications', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patient-reminders', patientId] });
    },
    onError: (error) => {
      showMsg(
        `❌ Failed to add medication: ${error instanceof ApiError ? error.message : 'Unknown error'}`,
        'error'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (medId: string) => {
      await api.delete(`/medications/${medId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-medications', patientId] });
    },
  });

  function getReminderTimes(frequency: string): string[] {
    const freq = (frequency || '').toLowerCase();
    if (freq.includes('four') || freq.includes('4 time') || freq.includes('qid')) return ['08:00:00', '12:00:00', '16:00:00', '21:00:00'];
    if (freq.includes('three') || freq.includes('3 time') || freq.includes('tds') || freq.includes('tid')) return ['09:00:00', '14:00:00', '21:00:00'];
    if (freq.includes('twice') || freq.includes('2 time') || freq.includes('bd') || freq.includes('bid') || freq.includes('1-0-1')) return ['09:00:00', '21:00:00'];
    if (freq.includes('once') || freq.includes('1 time') || freq.includes('od') || freq.includes('daily')) return ['09:00:00'];
    return ['09:00:00']; // default once daily
  }

  async function handleUpload() {
    if (!uploadFile || !patientId) return;
    setExtracting(true);
    showMsg('🔍 Analyzing prescription with AI...', 'info');
    try {
      await extractMutation.mutateAsync(uploadFile);
    } finally {
      setExtracting(false);
    }
  }

  async function handleConfirmAll() {
    showMsg('Adding all medications...', 'info');
    const medsToAdd = [...extractedMeds];
    setExtractedMeds([]);
    setUploadFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    for (const med of medsToAdd) {
      await addMedicationMutation.mutateAsync(med);
    }
    showMsg(`✅ ${medsToAdd.length} medication(s) added to your active list with reminders!`, 'success');
  }

  async function handleConfirmOne(index: number) {
    const med = extractedMeds[index];
    await addMedicationMutation.mutateAsync(med);
    const newMeds = [...extractedMeds];
    newMeds.splice(index, 1);
    setExtractedMeds(newMeds);
    if (newMeds.length === 0) {
      showMsg('✅ Medication added successfully with reminders!', 'success');
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } else {
      showMsg(`✅ Added. ${newMeds.length} remaining to confirm.`, 'success');
    }
  }

  function handleEdit(index: number) {
    setEditingIndex(index);
    setShowEditModal(true);
  }

  function handleRemoveExtracted(index: number) {
    const newMeds = [...extractedMeds];
    newMeds.splice(index, 1);
    setExtractedMeds(newMeds);
  }

  function handleDeleteMed(medId: string) {
    if (!confirm('Remove this medication from your active list?')) return;
    deleteMutation.mutate(medId);
  }

  if (!patientId) {
    return <div className="p-4 text-red-500">Please login as a patient to view medication reminders.</div>;
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

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ── Prescription Upload Panel ── */}
        <SectionCard
          title="Upload Prescription"
          subtitle="AI will extract your medications automatically"
          right={<Upload size={18} className="text-triova-700" />}
        >
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 transition hover:border-triova-500 hover:bg-slate-50">
              <Upload size={28} className="text-slate-300" />
              <span className="text-sm font-medium text-slate-600">
                {uploadFile ? uploadFile.name : 'Tap to select prescription'}
              </span>
              <span className="text-xs text-slate-400">Photo or PDF of doctor's prescription</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  setUploadFile(e.target.files?.[0] || null);
                  setExtractedMeds([]);
                  showMsg('', 'info');
                }}
              />
            </label>

            {uploadFile && (
              <div className="flex items-center justify-between rounded-xl bg-triova-50 border border-triova-200 px-3 py-2">
                <span className="text-xs font-medium text-triova-800 truncate">{uploadFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setUploadFile(null);
                    setExtractedMeds([]);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="ml-2 text-slate-400 hover:text-red-500"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {uploadFile && !extracting && extractedMeds.length === 0 && (
              <button
                type="button"
                onClick={handleUpload}
                className="w-full rounded-xl bg-triova-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-triova-900"
              >
                Analyze Prescription with AI
              </button>
            )}

            {extracting && (
              <div className="flex items-center justify-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-triova-700 border-t-transparent" />
                <span className="text-sm text-slate-600">AI is reading your prescription...</span>
              </div>
            )}

            {/* ── Extracted medications confirmation ── */}
            {extractedMeds.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">
                    AI Extracted {extractedMeds.length} Medication(s) — Review & Confirm:
                  </p>
                </div>

                {extractedMeds.map((med, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{med.medication_name}</p>
                        <p className="text-sm text-slate-600 mt-0.5">{med.dosage} · {med.frequency}</p>
                        {med.timing && <p className="text-xs text-slate-500 mt-0.5">{med.timing}</p>}
                        <p className="text-xs text-slate-400 mt-0.5">{med.duration_days} days course</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEdit(idx)}
                          title="Edit"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmOne(idx)}
                          title="Confirm & Add"
                          className="rounded-lg bg-emerald-100 p-1.5 text-emerald-700 hover:bg-emerald-200"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveExtracted(idx)}
                          title="Remove"
                          className="rounded-lg p-1.5 text-red-400 hover:bg-red-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleConfirmAll}
                    disabled={addMedicationMutation.isPending}
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {addMedicationMutation.isPending ? 'Adding...' : `✅ Confirm All ${extractedMeds.length} Medications`}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExtractedMeds([]); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Active Medications ── */}
        <SectionCard
          title="Active Medications"
          subtitle={activeMeds.length ? `${activeMeds.length} medication(s) on your schedule` : 'No active medications'}
          right={<Pill size={18} className="text-triova-700" />}
        >
          <div className="space-y-3">
            {activeMeds.map((med) => {
              const medReminders = reminders.filter((r) => r.medication_id === med.id && r.is_active);
              return (
                <div key={med.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{med.medication_name}</p>
                        {med.source === 'prescription_scan' && (
                          <span className="rounded-full bg-triova-100 px-2 py-0.5 text-xs font-medium text-triova-700">AI scanned</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-600">{med.dosage}</p>
                      <p className="text-xs text-slate-500">{med.frequency} {med.timing_instructions ? `· ${med.timing_instructions}` : ''}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <Calendar size={10} />
                        {med.start_date?.split('T')[0]} → {med.end_date?.split('T')[0]}
                      </div>
                      {medReminders.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {medReminders.map((rem) => (
                            <span key={rem.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              <Bell size={10} className="text-triova-600" />
                              {rem.reminder_time.slice(0, 5)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMed(med.id)}
                      className="ml-2 shrink-0 rounded-lg p-1.5 text-red-400 hover:bg-red-50"
                      title="Remove medication"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}

            {activeMeds.length === 0 && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-6 text-center">
                <Pill size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-500">No active medications.</p>
                <p className="text-xs text-slate-400 mt-1">Upload a prescription to get started.</p>
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* ── Medication Reminders Tab ── */}
      {reminders.length > 0 && (
        <SectionCard title="Today's Reminders" subtitle="All scheduled medication times for today">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reminders
              .filter((r) => r.is_active)
              .sort((a, b) => a.reminder_time.localeCompare(b.reminder_time))
              .map((rem) => (
                <div key={rem.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-triova-100">
                    <Bell size={16} className="text-triova-700" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{rem.medication_name}</p>
                    <p className="text-xs text-slate-500">{rem.reminder_time.slice(0, 5)}</p>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      )}

      {/* ── Edit Medication Modal ── */}
      {showEditModal && editingIndex !== null && extractedMeds[editingIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Edit Medication</h3>
              <button type="button" onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Medicine Name</label>
                <input
                  type="text"
                  value={extractedMeds[editingIndex].medication_name}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex] = { ...newMeds[editingIndex], medication_name: e.target.value };
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-triova-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dosage</label>
                <input
                  type="text"
                  value={extractedMeds[editingIndex].dosage}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex] = { ...newMeds[editingIndex], dosage: e.target.value };
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-triova-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
                <select
                  value={extractedMeds[editingIndex].frequency}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex] = { ...newMeds[editingIndex], frequency: e.target.value };
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-triova-500"
                >
                  <option value="once daily">Once daily</option>
                  <option value="twice daily">Twice daily</option>
                  <option value="three times a day">Three times a day</option>
                  <option value="four times a day">Four times a day</option>
                  <option value="once a week">Once a week</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Timing</label>
                <select
                  value={extractedMeds[editingIndex].timing}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex] = { ...newMeds[editingIndex], timing: e.target.value };
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-triova-500"
                >
                  <option value="after meals">After meals</option>
                  <option value="before food">Before food</option>
                  <option value="with food">With food</option>
                  <option value="at night">At night</option>
                  <option value="empty stomach">On empty stomach</option>
                  <option value="before bedtime">Before bedtime</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Duration (days)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={extractedMeds[editingIndex].duration_days}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex] = { ...newMeds[editingIndex], duration_days: parseInt(e.target.value) || 7 };
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-triova-500"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Done Editing
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleConfirmOne(editingIndex);
                  setShowEditModal(false);
                }}
                className="flex-1 rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900"
              >
                Save & Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}