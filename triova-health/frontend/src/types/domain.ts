export type UrgencyLevel = 'emergency' | 'urgent' | 'routine';

export interface Appointment {
  id: string;
  doctor_id: string;
  patient_id: string;
  appointment_date: string;
  appointment_time: string;
  urgency: UrgencyLevel;
  status: string;
  queue_position?: number;
  estimated_wait_minutes?: number;
  chief_complaint?: string;
  doctor_first_name?: string;
  doctor_last_name?: string;
  specialization?: string;
}

export interface Doctor {
  id: string;
  first_name: string;
  last_name: string;
  specialization: string;
  is_available: boolean;
}

export interface Alert {
  id: string;
  patient_id: string;
  metric_name: string;
  alert_message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'acknowledged' | 'resolved';
  detected_at: string;
  first_name?: string;
  last_name?: string;
}

export interface NotificationItem {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface WearablePoint {
  timestamp: string;
  value: number;
}

export interface MedicalDocument {
  id: string;
  file_name: string;
  file_url: string;
  document_type: string;
  is_processed: boolean;
  created_at: string;
}

export interface Consultation {
  id: string;
  diagnosis?: string;
  prescription_text?: string;
  consultation_notes?: string;
  created_at: string;
  doc_first?: string;
  doc_last?: string;
}
