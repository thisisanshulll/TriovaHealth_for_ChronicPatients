import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Check, Mic, MicOff, RefreshCw, Sparkles } from 'lucide-react';
import { ApiError, api } from '@/api/axios-instance';
import { SectionCard } from '@/components/ui/SectionCard';
import { UrgencyBadge } from '@/components/ui/UrgencyBadge';
import { formatDate, formatTime } from '@/lib/format';
import type { Appointment, Doctor, UrgencyLevel } from '@/types/domain';

interface VoiceBookingResponse {
  transcription: string;
  extracted_details: {
    date?: string;
    time?: string;
    urgency?: string;
    chief_complaint?: string;
  };
  available_slots: Array<{ time: string; is_available: boolean }>;
  suggested_appointment?: { doctor_id: string; date: string; time: string; urgency: string };
  alternatives?: Array<{ date: string; time: string }>;
  confirmation_text?: string;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Returns next weekday (Mon-Fri) from today */
function nextWeekday(): string {
  const d = new Date();
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() + 1); // Sunday → Monday
  if (day === 6) d.setDate(d.getDate() + 2); // Saturday → Monday
  return d.toISOString().slice(0, 10);
}

export default function BookAppointment() {
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(nextWeekday());
  const [time, setTime] = useState('10:00:00');
  const [urgency, setUrgency] = useState<UrgencyLevel>('routine');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceBookingResponse | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const doctorsQuery = useQuery({
    queryKey: ['book-doctors'],
    queryFn: async () => {
      const res = await api.get<{ doctors: Doctor[] }>('/doctors');
      return res.data.doctors;
    },
  });

  // Auto-select the first available doctor
  useEffect(() => {
    if (doctorsQuery.data && doctorsQuery.data.length > 0 && !doctorId) {
      setDoctorId(doctorsQuery.data[0].id);
    }
  }, [doctorsQuery.data, doctorId]);

  const slotsQuery = useQuery({
    queryKey: ['available-slots', doctorId, date],
    enabled: !!doctorId && !!date,
    queryFn: async () => {
      const res = await api.get<{ slots: Array<{ time: string; is_available: boolean }> }>(
        `/appointments/available-slots?doctor_id=${doctorId}&date=${date}`
      );
      return res.data.slots;
    },
  });

  const appointmentsQuery = useQuery({
    queryKey: ['recent-bookings'],
    queryFn: async () => {
      const me = await api.get<{ user: { role: string }; profile?: { id?: string } }>('/auth/me');
      const patientId = me.data.profile?.id;
      if (!patientId) return [];
      const appts = await api.get<{ upcoming: Appointment[] }>(`/appointments/patient/${patientId}`);
      return appts.data.upcoming.slice(0, 5);
    },
  });

  const selectedDoctor = useMemo(
    () => doctorsQuery.data?.find((doctor) => doctor.id === doctorId),
    [doctorsQuery.data, doctorId]
  );

  // Auto-select first available slot when slots load
  useEffect(() => {
    if (slotsQuery.data && slotsQuery.data.length > 0) {
      const firstFree = slotsQuery.data.find((s) => s.is_available);
      if (firstFree) setTime(firstFree.time);
    }
  }, [slotsQuery.data]);

  async function handleBook(): Promise<void> {
    if (!doctorId) {
      setBookingMessage('Please select a doctor first.');
      setBookingSuccess(false);
      return;
    }
    setBookingMessage('');
    setBookingSuccess(false);
    setIsSubmitting(true);
    try {
      const payload = {
        doctor_id: doctorId,
        date,
        time,
        urgency,
        chief_complaint: chiefComplaint || 'General consultation',
        booking_method: 'manual',
      };
      await api.post('/appointments/book', payload);
      setBookingSuccess(true);
      setBookingMessage(`✅ Appointment confirmed for ${formatDate(date)} at ${formatTime(time)} with Dr. ${selectedDoctor?.last_name || ''}.`);
      setChiefComplaint('');
      await appointmentsQuery.refetch();
    } catch (error) {
      setBookingSuccess(false);
      const msg = error instanceof ApiError ? error.message : 'Failed to book appointment';
      setBookingMessage(`❌ ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFindNextSlot(): Promise<void> {
    if (!doctorId) return;
    try {
      const res = await api.get<{ next_slot: { date: string; time: string } | null }>(
        `/appointments/slots/next-available?doctor_id=${doctorId}&from_date=${date}&urgency=${urgency}`
      );
      if (!res.data.next_slot) {
        setBookingMessage('No next slot available for this doctor.');
        return;
      }
      setDate(res.data.next_slot.date);
      setTime(res.data.next_slot.time);
      setBookingMessage('✅ Next available slot applied.');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Unable to fetch next slot';
      setBookingMessage(`❌ ${message}`);
    }
  }

  async function startVoiceBooking(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const base64 = await toBase64(blob);
        const res = await api.post<VoiceBookingResponse>('/appointments/voice-booking', {
          audio_base64: base64,
        });
        setVoiceResult(res.data);
        const extracted = res.data.extracted_details;
        if (extracted.date) setDate(extracted.date);
        if (extracted.time) setTime(extracted.time);
        if (extracted.urgency && ['routine', 'urgent', 'emergency'].includes(extracted.urgency)) {
          setUrgency(extracted.urgency as UrgencyLevel);
        }
        if (extracted.chief_complaint) setChiefComplaint(extracted.chief_complaint);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setBookingMessage('❌ Microphone permission denied or unavailable.');
    }
  }

  function stopVoiceBooking(): void {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  const availableSlots = (slotsQuery.data || []).filter((s) => s.is_available);
  const takenSlots = (slotsQuery.data || []).filter((s) => !s.is_available);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <SectionCard title="Book appointment" subtitle="Manual booking with live slot availability">
          {doctorsQuery.isLoading && (
            <p className="text-sm text-slate-500">Loading doctors...</p>
          )}
          {doctorsQuery.isError && (
            <p className="text-sm text-red-500">Failed to load doctors. Please refresh the page.</p>
          )}
          
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Doctor</span>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
                value={doctorId}
                onChange={(event) => setDoctorId(event.target.value)}
              >
                <option value="">Select doctor</option>
                {(doctorsQuery.data || []).map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    Dr. {doctor.first_name} {doctor.last_name} ({doctor.specialization})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Urgency</span>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
                value={urgency}
                onChange={(event) => setUrgency(event.target.value as UrgencyLevel)}
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Date</span>
              <input
                type="date"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Time</span>
              <input
                type="time"
                step="1"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
          <label className="mt-4 block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Chief complaint</span>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none transition focus:border-triova-500"
              value={chiefComplaint}
              placeholder="Describe your issue briefly (e.g. headache, fever, follow-up)"
              onChange={(event) => setChiefComplaint(event.target.value)}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!doctorId}
              onClick={handleFindNextSlot}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} />
              Find next available
            </button>
            <button
              type="button"
              disabled={!doctorId || isSubmitting}
              onClick={handleBook}
              className="inline-flex items-center gap-2 rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-triova-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CalendarCheck size={14} />
              {isSubmitting ? 'Booking...' : 'Confirm booking'}
            </button>
            {selectedDoctor && <UrgencyBadge value={urgency} />}
          </div>
          {bookingMessage && (
            <div className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${bookingSuccess ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {bookingMessage}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Voice booking assistant"
          subtitle="Record your request, we will suggest date/time/urgency"
          right={<Sparkles size={16} className="text-triova-700" />}
        >
          <div className="flex flex-wrap items-center gap-3">
            {!isRecording ? (
              <button
                type="button"
                onClick={startVoiceBooking}
                className="inline-flex items-center gap-2 rounded-xl bg-triova-700 px-4 py-2 text-sm font-semibold text-white hover:bg-triova-900"
              >
                <Mic size={15} />
                Start recording
              </button>
            ) : (
              <button
                type="button"
                onClick={stopVoiceBooking}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                <MicOff size={15} />
                Stop recording
              </button>
            )}
            <p className="text-xs text-slate-500">Speak naturally, for example: "Book me next Tuesday morning."</p>
          </div>
          {voiceResult && (
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-700">
                <span className="font-semibold">Transcription:</span> {voiceResult.transcription || '-'}
              </p>
              <p className="text-sm text-slate-700">
                <span className="font-semibold">Suggestion:</span> {voiceResult.confirmation_text || 'No suggestion'}
              </p>
              {(voiceResult.alternatives || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {voiceResult.alternatives!.slice(0, 3).map((alternative) => (
                    <button
                      key={`${alternative.date}-${alternative.time}`}
                      type="button"
                      onClick={() => {
                        setDate(alternative.date);
                        setTime(alternative.time);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {formatDate(alternative.date)} {formatTime(alternative.time)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="space-y-6">
        <SectionCard title="Available slots" subtitle={selectedDoctor ? `Dr. ${selectedDoctor.first_name} ${selectedDoctor.last_name} · ${formatDate(date)}` : 'Select a doctor and date'}>
          {slotsQuery.isLoading && <p className="text-sm text-slate-500">Loading slots...</p>}
          {!slotsQuery.isLoading && availableSlots.length === 0 && doctorId && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
              No slots available on this date. Doctor works Mon–Fri. Try another weekday or click "Find next available".
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {availableSlots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                onClick={() => setTime(slot.time)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                  time === slot.time
                    ? 'bg-triova-700 text-white ring-2 ring-triova-700 ring-offset-1'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {formatTime(slot.time)}
                {time === slot.time && <Check size={10} className="ml-1 inline" />}
              </button>
            ))}
          </div>
          {takenSlots.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-400 mb-1">Taken slots</p>
              <div className="flex flex-wrap gap-2">
                {takenSlots.slice(0, 6).map((slot) => (
                  <span key={slot.time} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-400 line-through">
                    {formatTime(slot.time)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Upcoming visits" subtitle="Your next scheduled appointments">
          <div className="space-y-3">
            {(appointmentsQuery.data || []).map((appointment) => (
              <div key={appointment.id} className="rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {formatDate(appointment.appointment_date)} · {formatTime(appointment.appointment_time)}
                </p>
                <p className="text-xs text-slate-600">
                  Dr. {appointment.doctor_first_name} {appointment.doctor_last_name}
                </p>
                {appointment.chief_complaint && (
                  <p className="mt-1 text-xs text-slate-500 line-clamp-1">{appointment.chief_complaint}</p>
                )}
                <div className="mt-2">
                  <UrgencyBadge value={appointment.urgency} />
                </div>
              </div>
            ))}
            {!appointmentsQuery.data?.length && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                <p className="text-sm text-slate-500">No upcoming visits.</p>
                <p className="text-xs text-slate-400 mt-1">Book your first appointment above.</p>
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
