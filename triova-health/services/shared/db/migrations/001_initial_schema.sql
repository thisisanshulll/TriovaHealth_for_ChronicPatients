-- TRIOVA 001_initial_schema (PostgreSQL 16)

CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE urgency_level AS ENUM ('emergency', 'urgent', 'routine');
CREATE TYPE triage_status AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE document_type AS ENUM ('prescription', 'lab_report', 'imaging', 'discharge_summary', 'other');
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');
CREATE TYPE notification_type AS ENUM ('appointment', 'medication', 'alert', 'message', 'reminder');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    refresh_token TEXT,
    email_verification_token TEXT,
    password_reset_token TEXT,
    password_reset_expires TIMESTAMP,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender gender_type NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(15),
    blood_group VARCHAR(5),
    height_cm DECIMAL(5,2),
    weight_kg DECIMAL(5,2),
    profile_picture_url TEXT,
    preferred_language VARCHAR(10) DEFAULT 'en',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE patient_allergies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    allergen VARCHAR(255) NOT NULL,
    severity VARCHAR(50) CHECK (severity IN ('mild', 'moderate', 'severe')),
    reaction_description TEXT,
    diagnosed_date DATE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE patient_chronic_conditions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    condition_name VARCHAR(255) NOT NULL,
    icd_code VARCHAR(20),
    diagnosed_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE patient_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    timing_instructions TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    prescribed_by VARCHAR(255),
    source VARCHAR(50) DEFAULT 'manual' CHECK (source IN ('manual', 'prescription_scan', 'consultation')),
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    specialization VARCHAR(100) NOT NULL,
    qualification TEXT,
    experience_years INT,
    license_number VARCHAR(50) UNIQUE NOT NULL,
    consultation_fee DECIMAL(10,2),
    profile_picture_url TEXT,
    bio TEXT,
    average_consultation_time_minutes INT DEFAULT 30,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE doctor_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INT DEFAULT 30,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE doctor_unavailability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    unavailable_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_full_day BOOLEAN DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE doctor_patient_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT NOW(),
    is_primary BOOLEAN DEFAULT FALSE,
    UNIQUE(doctor_id, patient_id)
);

CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    duration_minutes INT DEFAULT 30,
    status appointment_status DEFAULT 'scheduled',
    urgency urgency_level DEFAULT 'routine',
    chief_complaint TEXT,
    booking_method VARCHAR(20) DEFAULT 'manual' CHECK (booking_method IN ('manual', 'voice', 'system')),
    booking_notes TEXT,
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES users(id),
    cancelled_at TIMESTAMP,
    queue_position INT,
    estimated_wait_minutes INT,
    actual_start_time TIMESTAMP,
    actual_end_time TIMESTAMP,
    triage_session_id UUID,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(doctor_id, appointment_date, appointment_time)
);

CREATE TABLE triage_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id),
    status triage_status DEFAULT 'in_progress',
    language VARCHAR(10) DEFAULT 'en',
    chief_complaint TEXT,
    condition_category VARCHAR(50),
    urgency_level urgency_level,
    ai_summary TEXT,
    key_symptoms TEXT[],
    recommended_actions TEXT[],
    risk_flags TEXT[],
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE triage_question_bank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condition_category VARCHAR(50) NOT NULL,
    question_text_en TEXT NOT NULL,
    question_text_hi TEXT,
    question_key VARCHAR(100) NOT NULL,
    question_type VARCHAR(50) CHECK (question_type IN ('text', 'yes_no', 'scale', 'choice', 'duration')),
    choice_options JSONB,
    question_order INT NOT NULL,
    is_critical BOOLEAN DEFAULT FALSE,
    follow_up_trigger JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE triage_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triage_session_id UUID REFERENCES triage_sessions(id) ON DELETE CASCADE,
    question_key VARCHAR(100) NOT NULL,
    question_text TEXT NOT NULL,
    response_text TEXT,
    response_value JSONB,
    is_emergency_flag BOOLEAN DEFAULT FALSE,
    response_order INT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE triage_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triage_session_id UUID REFERENCES triage_sessions(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    ai_analysis TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE medical_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    file_url TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    uploaded_by UUID REFERENCES users(id),
    document_date DATE,
    extracted_text TEXT,
    is_processed BOOLEAN DEFAULT FALSE,
    processing_error TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE medical_record_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    queried_by UUID REFERENCES users(id),
    querier_role user_role NOT NULL,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    source_document_ids UUID[],
    confidence_score INT,
    session_key VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    triage_session_id UUID REFERENCES triage_sessions(id),
    diagnosis TEXT,
    symptoms TEXT[],
    prescription_text TEXT,
    tests_recommended TEXT[],
    follow_up_date DATE,
    consultation_notes TEXT,
    doctor_summary TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE prescribed_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    timing VARCHAR(100),
    duration_days INT,
    instructions TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE wearable_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    recorded_at TIMESTAMP NOT NULL,
    heart_rate INT,
    spo2 INT,
    blood_pressure_systolic INT,
    blood_pressure_diastolic INT,
    temperature_celsius DECIMAL(4,2),
    steps INT,
    sleep_hours DECIMAL(4,2),
    stress_level INT CHECK (stress_level BETWEEN 0 AND 100),
    data_source VARCHAR(20) DEFAULT 'mock' CHECK (data_source IN ('mock', 'device', 'manual')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(patient_id, recorded_at)
);

CREATE TABLE baseline_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    baseline_value DECIMAL(10,2) NOT NULL,
    baseline_std_dev DECIMAL(10,2) DEFAULT 1,
    sample_count INT,
    calculated_from_days INT DEFAULT 7,
    last_calculated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(patient_id, metric_name)
);

CREATE TABLE health_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    alert_message TEXT NOT NULL,
    severity alert_severity NOT NULL,
    status alert_status DEFAULT 'active',
    current_value DECIMAL(10,2),
    baseline_value DECIMAL(10,2),
    percentage_change DECIMAL(5,2),
    trend VARCHAR(20),
    detected_at TIMESTAMP DEFAULT NOW(),
    acknowledged_at TIMESTAMP,
    acknowledged_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    related_entity_id UUID,
    related_entity_type VARCHAR(50),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    scheduled_for TIMESTAMP,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE medication_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    medication_id UUID REFERENCES patient_medications(id) ON DELETE CASCADE,
    reminder_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
