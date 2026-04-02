import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Pill, Check, Edit2, Trash2, Bell, Calendar, X } from 'lucide-react';
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
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractedMeds, setExtractedMeds] = useState<ExtractedMedication[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const medicationsQuery = useQuery({
    queryKey: ['patient-medications', patientId],
    enabled: !!patientId,
    queryFn: async () => (await api.get<{ medications: Medication[]; reminders: Reminder[] }>(`/medications/patient/${patientId}`)).data,
  });

  const extractMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('patient_id', patientId!);
      form.append('document_type', 'prescription');
      const res = await api.upload<{ extracted_medications: ExtractedMedication[]; message: string }>('/medical-records/extract-medications', form);
      return res.data;
    },
    onSuccess: (data) => {
      setExtractedMeds(data.extracted_medications);
      if (data.extracted_medications.length > 0) {
        setMessage(`Found ${data.extracted_medications.length} medication(s). Please review and confirm.`);
      } else {
        setMessage('No medications found in the prescription.');
      }
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : 'Failed to extract medications');
    },
  });

  const addMedicationMutation = useMutation({
    mutationFn: async (med: ExtractedMedication) => {
      const times = getReminderTimes(med.frequency);
      await api.post('/medications', {
        patient_id: patientId,
        medication_name: med.medication_name,
        dosage: med.dosage,
        frequency: med.frequency,
        timing_instructions: med.timing,
        duration_days: med.duration_days,
        reminder_times: times,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-medications'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (medId: string) => {
      await api.delete(`/medications/${medId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-medications'] });
    },
  });

  function getReminderTimes(frequency: string): string[] {
    const freq = frequency.toLowerCase();
    if (freq.includes('once') || freq.includes('1 time')) return ['09:00:00'];
    if (freq.includes('twice') || freq.includes('2 times')) return ['09:00:00', '21:00:00'];
    if (freq.includes('three')) return ['09:00:00', '14:00:00', '21:00:00'];
    if (freq.includes('four')) return ['08:00:00', '12:00:00', '16:00:00', '21:00:00'];
    return ['09:00:00'];
  }

  async function handleUpload() {
    if (!uploadFile || !patientId) return;
    setExtracting(true);
    setMessage('');
    try {
      console.log('Starting upload:', uploadFile.name, uploadFile.type);
      await extractMutation.mutateAsync(uploadFile);
      console.log('Upload completed');
    } catch (err) {
      console.error('Upload failed:', err);
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setExtracting(false);
    }
  }

  function handleConfirmAll() {
    extractedMeds.forEach((med) => addMedicationMutation.mutate(med));
    setExtractedMeds([]);
    setUploadFile(null);
    setMessage('All medications added successfully!');
  }

  function handleConfirmOne(index: number) {
    const med = extractedMeds[index];
    addMedicationMutation.mutate(med);
    const newMeds = [...extractedMeds];
    newMeds.splice(index, 1);
    setExtractedMeds(newMeds);
    if (newMeds.length === 0) {
      setMessage('Medication added successfully!');
      setUploadFile(null);
    }
  }

  function handleEdit(index: number) {
    setEditingIndex(index);
    setShowEditModal(true);
  }

  function handleDeleteConfirm(medId: string) {
    if (confirm('Are you sure you want to delete this medication?')) {
      deleteMutation.mutate(medId);
    }
  }

  if (!patientId) {
    return <div className="p-4 text-red-500">Please login as a patient to view medication reminders.</div>;
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.includes('success') || message.includes('Found') ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-slate-50 border border-slate-200 text-slate-700'}`}>
          {message}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard 
          title="Upload Prescription" 
          subtitle="Upload a photo or scan of your prescription"
          right={<Upload size={18} className="text-triova-700" />}
        >
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 hover:border-triova-500">
              <Upload size={20} className="text-slate-400" />
              <span className="text-sm text-slate-600">
                {uploadFile ? uploadFile.name : 'Tap to select prescription image'}
              </span>
              <input 
                type="file" 
                accept="image/*,.pdf" 
                className="hidden" 
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)} 
              />
            </label>
            
            {uploadFile && (
              <button
                type="button"
                onClick={handleUpload}
                disabled={extracting}
                className="w-full rounded-xl bg-triova-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {extracting ? 'Analyzing Prescription...' : 'Analyze Prescription'}
              </button>
            )}

            {extractedMeds.length > 0 && (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">Extracted Medications:</p>
                {extractedMeds.map((med, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{med.medication_name}</p>
                        <p className="text-sm text-slate-600">{med.dosage} - {med.frequency}</p>
                        <p className="text-xs text-slate-500">{med.timing} • {med.duration_days} days</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(idx)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmOne(idx)}
                          className="rounded-lg bg-emerald-100 p-1.5 text-emerald-700 hover:bg-emerald-200"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleConfirmAll}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Confirm All Medications
                </button>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard 
          title="Active Medications" 
          subtitle="Your current medication schedule"
          right={<Pill size={18} className="text-triova-700" />}
        >
          <div className="space-y-3">
            {(medicationsQuery.data?.medications || []).map((med) => (
              <div key={med.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{med.medication_name}</p>
                    <p className="text-sm text-slate-600">{med.dosage}</p>
                    <p className="text-xs text-slate-500">{med.frequency} • {med.timing_instructions}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <Calendar size={12} />
                      {med.start_date?.split('T')[0]} - {med.end_date?.split('T')[0]}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteConfirm(med.id)}
                    className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {(medicationsQuery.data?.reminders || []).filter(r => r.medication_id === med.id).map((rem) => (
                  <div key={rem.id} className="mt-2 flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">
                    <Bell size={12} className="text-triova-600" />
                    {rem.reminder_time.slice(0, 5)}
                  </div>
                ))}
              </div>
            ))}
            {(!medicationsQuery.data?.medications || medicationsQuery.data.medications.length === 0) && (
              <p className="text-sm text-slate-500">No medications added yet. Upload a prescription to get started.</p>
            )}
          </div>
        </SectionCard>
      </div>

      {showEditModal && editingIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Edit Medication</h3>
              <button type="button" onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Medicine Name</label>
                <input
                  type="text"
                  value={extractedMeds[editingIndex].medication_name}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex].medication_name = e.target.value;
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Dosage</label>
                <input
                  type="text"
                  value={extractedMeds[editingIndex].dosage}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex].dosage = e.target.value;
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Frequency</label>
                <select
                  value={extractedMeds[editingIndex].frequency}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex].frequency = e.target.value;
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="once daily">Once daily</option>
                  <option value="twice daily">Twice daily</option>
                  <option value="three times a day">Three times a day</option>
                  <option value="four times a day">Four times a day</option>
                  <option value="once a week">Once a week</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Timing</label>
                <select
                  value={extractedMeds[editingIndex].timing}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex].timing = e.target.value;
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="before food">Before food</option>
                  <option value="after meals">After meals</option>
                  <option value="with food">With food</option>
                  <option value="at night">At night</option>
                  <option value="empty stomach">Empty stomach</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Duration (days)</label>
                <input
                  type="number"
                  value={extractedMeds[editingIndex].duration_days}
                  onChange={(e) => {
                    const newMeds = [...extractedMeds];
                    newMeds[editingIndex].duration_days = parseInt(e.target.value) || 7;
                    setExtractedMeds(newMeds);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleConfirmOne(editingIndex);
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