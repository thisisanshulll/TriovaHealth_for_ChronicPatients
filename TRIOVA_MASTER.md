# TRIOVA HEALTH PLATFORM — MASTER SPECIFICATION DOCUMENT
### Version 1.0 | Full-Stack Technical Blueprint | Production-Ready

---

> **Purpose:** This document is the single source of truth for the end-to-end implementation of TRIOVA — an AI-powered healthcare platform. Every feature, API, schema, agent, edge case, file structure, environment variable, and deployment step is covered. The implementing team should not need to ask any clarifying questions.

---

## TABLE OF CONTENTS

1. [Product Overview & Vision](#1-product-overview--vision)
2. [Feature Specifications](#2-feature-specifications)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack (All Free/Open Source)](#4-technology-stack)
5. [Project Folder Structure](#5-project-folder-structure)
6. [Database Schema — PostgreSQL](#6-database-schema--postgresql)
7. [Vector Database — Qdrant](#7-vector-database--qdrant)
8. [API Architecture & All Endpoints](#8-api-architecture--all-endpoints)
9. [AI Agents & RAG System](#9-ai-agents--rag-system)
10. [Authentication & Security](#10-authentication--security)
11. [Real-Time Features — Socket.io](#11-real-time-features--socketio)
12. [File Storage & Document Processing](#12-file-storage--document-processing)
13. [Notification System](#13-notification-system)
14. [Wearable Data Integration (Mock)](#14-wearable-data-integration-mock)
15. [Frontend — Pages & Components](#15-frontend--pages--components)
16. [Background Jobs & Cron Schedules](#16-background-jobs--cron-schedules)
17. [PDF Export — Medical History](#17-pdf-export--medical-history)
18. [Edge Cases & Error Handling](#18-edge-cases--error-handling)
19. [Environment Variables — Complete List](#19-environment-variables--complete-list)
20. [Docker & Deployment](#20-docker--deployment)
21. [Seed Data & Testing Guide](#21-seed-data--testing-guide)
22. [Implementation Order / Sprint Plan](#22-implementation-order--sprint-plan)

---

## 1. PRODUCT OVERVIEW & VISION

**TRIOVA** is a full-stack AI-powered healthcare platform connecting patients and doctors through intelligent triage, real-time health monitoring, smart appointment booking, and a RAG-based medical records system.

### Core Problems Solved

| Problem | Solution |
|---|---|
| Patients unsure of urgency | AI triage with EMERGENCY / URGENT / ROUTINE classification |
| Doctors waste time on initial questioning | AI pre-triage report delivered before consultation |
| No context before consultation | Structured medical summary shared with doctor |
| Missed medications | Auto-extracted reminders from prescriptions |
| Scattered medical history | Unified RAG-searchable document store |
| Manual health monitoring | Mock wearable data with anomaly detection and trend alerts |
| Long appointment back-and-forth | Voice/text natural language booking |

### User Roles

- **Patient** — Books appointments, completes triage, uploads records, views reminders, downloads history
- **Doctor** — Views prioritized patient queue, reads AI summaries, monitors health trends, chats with RAG on patient records
- **Admin** — (Future scope, schema ready)

---

## 2. FEATURE SPECIFICATIONS

### Feature 1: Smart Appointment Booking

**Description:** Patients book appointments via voice or manual selection. System auto-suggests the next available slot. Emergency cases skip the queue.

**Behavior:**
- Patient says or types: "Book me next Tuesday at 10 AM" → NLP extracts date, time, and urgency
- If slot unavailable → system returns top 3 nearest alternatives
- Emergency urgency → system finds the absolute next open slot; if none, it pushes routine appointments by 15 minutes and notifies affected patients
- Queue position is assigned and shown in real-time via WebSocket
- Appointment confirmation sent via in-app notification + SMS + email

**Key Constraints:**
- No double booking (database-level unique constraint + row-level locking in transaction)
- Doctor availability respects `doctor_availability` (recurring schedule) and `doctor_unavailability` (overrides)
- Appointment slot granularity = 30 minutes (configurable per doctor)
- Patients may cancel up to 2 hours before appointment. After that, cancellation requires doctor acknowledgement.

---

### Feature 2: AI Voice Health Assistant — Triova Triage

**Description:** AI-powered pre-consultation triage. Patient answers structured questions before seeing a doctor. System generates a medical summary and urgency level.

**Flow:**
1. Patient initiates triage from dashboard
2. Patient states chief complaint (voice or text)
3. AI classifies complaint into condition category (heart, respiratory, digestive, neurological, general)
4. Category-specific question bank is activated — different questions for cardiac vs. asthma vs. general
5. Questions delivered one at a time; answers collected
6. Emergency keyword detection runs on every answer — if detected, triage stops immediately, urgency = EMERGENCY
7. Optionally, patient uploads a photo (rash, wound, swollen area) for visual analysis via GPT-4 Vision
8. After all questions, AI generates:
   - Structured medical summary (2–4 sentences)
   - Key symptoms list
   - Urgency level: EMERGENCY / URGENT / ROUTINE
   - Recommended actions
9. Report is stored and linked to patient profile
10. Doctor can access report at any time from patient card

**Language Support:** English and Hindi (auto-detect or patient-selected)

**Voice Input:** OpenAI Whisper API for speech-to-text. Web Speech API as fallback for real-time transcription.

**Question Categories (Minimum Sets):**

| Category | Trigger Keywords | Min Questions |
|---|---|---|
| heart | chest pain, palpitations, heart, shortness of breath | 6 |
| respiratory | breathing, cough, asthma, wheeze, COPD | 6 |
| digestive | stomach, nausea, vomiting, diarrhea, abdomen | 5 |
| neurological | headache, dizziness, seizure, numbness, vision | 5 |
| general | all others | 6 |

---

### Feature 3: Doctor Dashboard

**Description:** Single-screen command center for the doctor showing all patients sorted by urgency with health trends, alerts, and triage summaries.

**Sections:**
- **Priority Queue:** Patients sorted 🔴 Emergency → 🟠 Urgent → 🟢 Routine
- **Per Patient Card:**
  - Name, age, urgency badge
  - Chief complaint
  - AI-generated triage summary
  - Last 7-day health trend sparkline (heart rate, SpO2, etc.)
  - Active health alerts (with severity color coding)
  - Quick action: View full profile / Start consultation
- **Trend Alerts Panel:** Live list of abnormal readings across all patients (refreshed every 10 minutes via cron + WebSocket push)
- **Today's Appointments:** Timeline view of all scheduled appointments with queue management

**Health Trends Calculation:**
- Runs daily via cron job
- Baseline = rolling 7-day average per metric per patient
- Alert triggered if: latest value deviates > 2 standard deviations from baseline
- Even if value is "normal" by medical standards, if it's abnormal for that patient, alert fires
- Alert severity: low / medium / high / critical

---

### Feature 4: Patient Dashboard

**Description:** Simple, clean interface for patients to manage all health interactions.

**Sections:**
- Upcoming appointments (with countdown and queue position)
- Past consultations
- Triage history
- Quick-start triage button
- Health profile (allergies, medications, chronic conditions)
- Wearable vitals snapshot (latest reading + 7-day chart)
- Medication reminders today
- Recent notifications
- Upload medical document button

---

### Feature 5: Smart Medical Records + AI RAG Chat

**Description:** Patients upload medical documents (PDFs, images, scans). The system OCRs and indexes them in a vector store. Both doctor and patient can query records in natural language.

**Supported Formats:** PDF, JPG, PNG, HEIC

**Processing Pipeline:**
1. Upload → stored in Supabase Storage
2. Background job triggered (BullMQ)
3. Text extracted: PDF → pdf-parse; Images → Tesseract.js OCR
4. Text chunked (1000 chars, 200 overlap)
5. Chunks embedded via OpenAI text-embedding-3-small
6. Vectors stored in Qdrant with patient_id filter
7. Document marked as `is_processed = true` in PostgreSQL

**RAG Chat Behavior:**
- Search restricted to patient's own documents (mandatory patient_id filter)
- If no relevant chunks found → explicit message: "This information is not in your uploaded records."
- If confidence < 50% → answer prefixed with uncertainty disclaimer
- Conversation history maintained per session (last 10 turns sent to GPT)
- Doctor can chat about their patient's records from doctor dashboard

---

### Feature 6: Medication Reminders (Auto-Extracted)

**Description:** System reads uploaded prescriptions and automatically extracts medication schedules. Reminders fire at the right time daily.

**Flow:**
1. Prescription PDF uploaded → OCR + GPT extraction
2. GPT parses: medication name, dosage, frequency, timing, duration
3. Medication records created in `patient_medications`
4. Reminder times created in `medication_reminders`
5. Node-cron checks every hour for due reminders
6. Sends in-app notification + SMS

---

### Feature 7: Medical History Export (PDF)

**Description:** Patient can download complete medical history as a formatted PDF.

**Contents of Exported PDF:**
- Patient demographics
- Chronic conditions + allergies
- Current and past medications
- All triage session summaries
- Consultation history (diagnosis, prescriptions, recommended tests)
- Last 30 days of wearable data (key metrics: HR, SpO2, BP, temperature, sleep, steps, stress)
- Active health alerts

**Tech:** PDFKit (Node.js) for generation; streamed as file download.

---

## 3. SYSTEM ARCHITECTURE

### Pattern: Modular Monorepo with Service Separation

While technically structured as separate services (each in its own folder with its own Express app and port), for the initial build these services can be run as a single Node.js process using a router-based monolith. The architecture is designed to be extracted into true microservices later.

```
CLIENT (React + Vite)
        │
        ▼
  API GATEWAY (Port 3000)
  Express Gateway / Custom Router
        │
        ├── Auth Service         (Port 3001)
        ├── Appointment Service  (Port 3002)
        ├── Triage Service       (Port 3003)
        ├── Medical Records      (Port 3004)
        ├── Analytics Service    (Port 3005)
        ├── Notification Service (Port 3006)
        └── Wearable Service     (Port 3007)
        
INFRASTRUCTURE:
  PostgreSQL 16   ← Primary relational store
  Redis 7         ← Sessions, caching, BullMQ queues
  Qdrant          ← Vector store for RAG
  Supabase Storage← File storage (S3-compatible)
  Socket.io       ← Real-time WebSocket events
  BullMQ          ← Background job queues
  node-cron       ← Scheduled tasks
```

---

## 4. TECHNOLOGY STACK

### Backend
| Layer | Technology | Version | Reason |
|---|---|---|---|
| Runtime | Node.js | 20.x LTS | Stable, async-friendly |
| Framework | Express.js | 4.x | Lightweight, well-supported |
| Language | TypeScript | 5.x | Type safety across services |
| API Gateway | Custom Express Router | — | Free alternative to Express Gateway |
| Real-time | Socket.io | 4.x | WebSocket with fallback |
| Job Queue | BullMQ + Redis | Latest | Reliable background processing |
| Scheduling | node-cron | 3.x | Lightweight cron |
| Validation | Zod | 3.x | Runtime type validation |
| Auth | jsonwebtoken + bcryptjs | Latest | JWT + password hashing |
| Rate Limiting | express-rate-limit | Latest | API abuse prevention |
| Logging | Winston | 3.x | Structured logging |
| HTTP Client | Axios | 1.x | Internal service calls |

### Database
| Layer | Technology | Version | Reason |
|---|---|---|---|
| Primary DB | PostgreSQL | 16.x | ACID, relational, UUID support |
| ORM/Query | pg (node-postgres) | 8.x | Direct, performant SQL |
| Migrations | node-pg-migrate | Latest | Version-controlled schema |
| Vector DB | Qdrant | Latest | Free, self-hosted, fast ANN |
| Cache/Queue | Redis | 7.x | Sessions, BullMQ, rate limiting |

### AI/ML
| Component | Technology | Notes |
|---|---|---|
| LLM | OpenAI GPT-4o | Primary model for all AI tasks |
| Embeddings | OpenAI text-embedding-3-small | 1536 dims, cost-effective |
| Speech-to-Text | OpenAI Whisper API | Voice triage and booking |
| Text-to-Speech | Web Speech API (browser) | Free, no API cost |
| RAG Framework | LangChain.js | Chunking, retrieval pipeline |
| OCR | Tesseract.js | Free, runs on-server |
| PDF Parsing | pdf-parse | Text extraction from PDFs |
| Image Processing | sharp | Compression before storage |
| PDF Generation | PDFKit | Medical history export |

### Frontend
| Layer | Technology | Version |
|---|---|---|
| Framework | React | 18.x |
| Language | TypeScript | 5.x |
| Build Tool | Vite | 5.x |
| Styling | Tailwind CSS | 3.x |
| Components | shadcn/ui + Radix UI | Latest |
| State | Zustand | 4.x |
| Server State | TanStack Query (React Query) | 5.x |
| Charts | Recharts | 2.x |
| Voice | react-speech-recognition + Web Speech API | Latest |
| Real-time | socket.io-client | 4.x |
| Forms | React Hook Form + Zod | Latest |
| Routing | React Router | 6.x |
| HTTP | Axios | 1.x |
| Icons | Lucide React | Latest |
| PDF Viewer | react-pdf | Latest |

### DevOps
| Component | Technology |
|---|---|
| Containerization | Docker + Docker Compose |
| Frontend Hosting | Vercel (Free tier) |
| Backend Hosting | Railway.app (Free tier) or Render |
| DB Hosting | Supabase (PostgreSQL + Storage, Free tier) |
| Vector DB | Self-hosted on Railway / Render |
| Error Tracking | Sentry (Free tier) |
| CI/CD | GitHub Actions |
| Docs | Swagger / OpenAPI 3.0 (swagger-jsdoc + swagger-ui-express) |

---

## 5. PROJECT FOLDER STRUCTURE

```
triova-health/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── services/
│   ├── shared/
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── role.middleware.ts
│   │   │   ├── rate-limit.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   └── validate.middleware.ts
│   │   ├── utils/
│   │   │   ├── logger.ts
│   │   │   ├── pagination.ts
│   │   │   ├── date-helpers.ts
│   │   │   └── response.ts
│   │   ├── types/
│   │   │   ├── auth.types.ts
│   │   │   ├── patient.types.ts
│   │   │   ├── doctor.types.ts
│   │   │   ├── appointment.types.ts
│   │   │   ├── triage.types.ts
│   │   │   └── wearable.types.ts
│   │   ├── db/
│   │   │   ├── pool.ts
│   │   │   └── migrations/
│   │   │       ├── 001_initial_schema.sql
│   │   │       ├── 002_indexes.sql
│   │   │       └── 003_functions_triggers.sql
│   │   └── queues/
│   │       ├── redis-client.ts
│   │       └── queue-definitions.ts
│   │
│   ├── auth/
│   │   ├── src/
│   │   │   ├── routes/auth.routes.ts
│   │   │   ├── controllers/auth.controller.ts
│   │   │   ├── services/auth.service.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── appointments/
│   │   ├── src/
│   │   │   ├── routes/appointment.routes.ts
│   │   │   ├── controllers/appointment.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── appointment.service.ts
│   │   │   │   ├── availability.service.ts
│   │   │   │   └── queue.service.ts
│   │   │   ├── agents/
│   │   │   │   └── VoiceBookingAgent.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── triage/
│   │   ├── src/
│   │   │   ├── routes/triage.routes.ts
│   │   │   ├── controllers/triage.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── triage.service.ts
│   │   │   │   └── question-bank.service.ts
│   │   │   ├── agents/
│   │   │   │   ├── TriageAgent.ts
│   │   │   │   └── EmergencyDetector.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── medical-records/
│   │   ├── src/
│   │   │   ├── routes/records.routes.ts
│   │   │   ├── controllers/records.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── records.service.ts
│   │   │   │   ├── extraction.service.ts
│   │   │   │   └── medication-extractor.service.ts
│   │   │   ├── rag/
│   │   │   │   ├── MedicalRAG.ts
│   │   │   │   └── chunker.ts
│   │   │   ├── processors/
│   │   │   │   ├── pdf-processor.ts
│   │   │   │   └── image-processor.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── analytics/
│   │   ├── src/
│   │   │   ├── routes/analytics.routes.ts
│   │   │   ├── controllers/analytics.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── trends.service.ts
│   │   │   │   ├── alerts.service.ts
│   │   │   │   └── baseline.service.ts
│   │   │   ├── agents/
│   │   │   │   └── TrendsAnalysisAgent.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── notifications/
│   │   ├── src/
│   │   │   ├── routes/notifications.routes.ts
│   │   │   ├── controllers/notifications.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── notification.service.ts
│   │   │   │   ├── email.service.ts
│   │   │   │   └── sms.service.ts
│   │   │   ├── workers/
│   │   │   │   ├── email.worker.ts
│   │   │   │   └── sms.worker.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── wearables/
│   │   ├── src/
│   │   │   ├── routes/wearables.routes.ts
│   │   │   ├── controllers/wearables.controller.ts
│   │   │   ├── services/
│   │   │   │   └── mock-wearable.service.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── patients/
│   │   ├── src/
│   │   │   ├── routes/patients.routes.ts
│   │   │   ├── controllers/patients.controller.ts
│   │   │   ├── services/patients.service.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── doctors/
│   │   └── (same pattern as patients)
│   │
│   └── gateway/
│       ├── src/
│       │   ├── proxy.ts
│       │   ├── socket-server.ts
│       │   └── index.ts
│       ├── Dockerfile
│       └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── auth.api.ts
│   │   │   ├── appointments.api.ts
│   │   │   ├── triage.api.ts
│   │   │   ├── records.api.ts
│   │   │   ├── analytics.api.ts
│   │   │   ├── wearables.api.ts
│   │   │   └── axios-instance.ts
│   │   ├── components/
│   │   │   ├── ui/               ← shadcn/ui components
│   │   │   ├── layout/
│   │   │   │   ├── PatientLayout.tsx
│   │   │   │   ├── DoctorLayout.tsx
│   │   │   │   └── Sidebar.tsx
│   │   │   ├── patient/
│   │   │   │   ├── AppointmentCard.tsx
│   │   │   │   ├── VitalCard.tsx
│   │   │   │   ├── MedicationReminder.tsx
│   │   │   │   ├── TriageHistory.tsx
│   │   │   │   └── WearableChart.tsx
│   │   │   ├── doctor/
│   │   │   │   ├── PatientQueueCard.tsx
│   │   │   │   ├── AlertPanel.tsx
│   │   │   │   ├── TrendSparkline.tsx
│   │   │   │   └── TriageSummaryCard.tsx
│   │   │   ├── triage/
│   │   │   │   ├── QuestionCard.tsx
│   │   │   │   ├── VoiceInput.tsx
│   │   │   │   └── UrgencyBadge.tsx
│   │   │   └── shared/
│   │   │       ├── VoiceButton.tsx
│   │   │       ├── RAGChatBox.tsx
│   │   │       ├── FileUploader.tsx
│   │   │       └── NotificationBell.tsx
│   │   ├── pages/
│   │   │   ├── auth/
│   │   │   │   ├── Login.tsx
│   │   │   │   └── Register.tsx
│   │   │   ├── patient/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── BookAppointment.tsx
│   │   │   │   ├── Triage.tsx
│   │   │   │   ├── MedicalRecords.tsx
│   │   │   │   ├── Medications.tsx
│   │   │   │   └── Profile.tsx
│   │   │   └── doctor/
│   │   │       ├── Dashboard.tsx
│   │   │       ├── PatientQueue.tsx
│   │   │       ├── PatientDetail.tsx
│   │   │       └── AppointmentCalendar.tsx
│   │   ├── hooks/
│   │   │   ├── useSocket.ts
│   │   │   ├── useVoice.ts
│   │   │   ├── useAuth.ts
│   │   │   └── useWearableData.ts
│   │   ├── store/
│   │   │   ├── auth.store.ts
│   │   │   └── notification.store.ts
│   │   ├── types/
│   │   └── App.tsx
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── package.json
│
├── scripts/
│   ├── seed.ts
│   ├── generate-wearable-data.ts
│   └── setup-qdrant.ts
│
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## 6. DATABASE SCHEMA — POSTGRESQL

> Run migrations in numbered order. Use `node-pg-migrate` or execute SQL directly.

### 001_initial_schema.sql

```sql
-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE urgency_level AS ENUM ('emergency', 'urgent', 'routine');
CREATE TYPE triage_status AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE document_type AS ENUM ('prescription', 'lab_report', 'imaging', 'discharge_summary', 'other');
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');
CREATE TYPE notification_type AS ENUM ('appointment', 'medication', 'alert', 'message', 'reminder');

-- ============================================
-- USERS & AUTH
-- ============================================

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

-- ============================================
-- PATIENTS
-- ============================================

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

-- ============================================
-- DOCTORS
-- ============================================

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

-- ============================================
-- APPOINTMENTS
-- ============================================

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

-- ============================================
-- TRIAGE
-- ============================================

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

-- ============================================
-- MEDICAL RECORDS
-- ============================================

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

-- ============================================
-- CONSULTATIONS
-- ============================================

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

-- ============================================
-- WEARABLE DATA
-- ============================================

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

-- ============================================
-- HEALTH ALERTS
-- ============================================

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

-- ============================================
-- NOTIFICATIONS
-- ============================================

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
```

### 002_indexes.sql

```sql
-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Patients
CREATE INDEX idx_patients_user_id ON patients(user_id);
CREATE INDEX idx_patients_phone ON patients(phone);

-- Doctors
CREATE INDEX idx_doctors_user_id ON doctors(user_id);
CREATE INDEX idx_doctors_specialization ON doctors(specialization);

-- Appointments
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX idx_appointments_date_time ON appointments(appointment_date, appointment_time);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_urgency ON appointments(urgency);
CREATE INDEX idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);

-- Triage
CREATE INDEX idx_triage_sessions_patient ON triage_sessions(patient_id);
CREATE INDEX idx_triage_sessions_status ON triage_sessions(status);
CREATE INDEX idx_triage_responses_session ON triage_responses(triage_session_id);

-- Medical Documents
CREATE INDEX idx_medical_documents_patient ON medical_documents(patient_id);
CREATE INDEX idx_medical_documents_type ON medical_documents(document_type);
CREATE INDEX idx_medical_documents_processed ON medical_documents(is_processed);

-- Wearable Data
CREATE INDEX idx_wearable_data_patient_recorded ON wearable_data(patient_id, recorded_at DESC);
CREATE INDEX idx_wearable_data_patient_date ON wearable_data(patient_id, recorded_at);

-- Health Alerts
CREATE INDEX idx_health_alerts_patient ON health_alerts(patient_id);
CREATE INDEX idx_health_alerts_status ON health_alerts(status);
CREATE INDEX idx_health_alerts_severity ON health_alerts(severity);
CREATE INDEX idx_health_alerts_detected_at ON health_alerts(detected_at DESC);

-- Notifications
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_for);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
```

### 003_functions_triggers.sql

```sql
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_doctors_updated_at BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_consultations_updated_at BEFORE UPDATE ON consultations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patient_medications_updated_at BEFORE UPDATE ON patient_medications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_medical_documents_updated_at BEFORE UPDATE ON medical_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_baseline_metrics_updated_at BEFORE UPDATE ON baseline_metrics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get next available slot for a doctor
CREATE OR REPLACE FUNCTION get_next_available_slot(
    p_doctor_id UUID,
    p_from_datetime TIMESTAMP,
    p_urgency urgency_level
) RETURNS TABLE(slot_date DATE, slot_time TIME) AS $$
DECLARE
    check_date DATE;
    day_of_week INT;
    avail_record RECORD;
    current_time TIME;
    slot_start TIME;
BEGIN
    check_date := p_from_datetime::DATE;
    
    FOR i IN 0..30 LOOP
        day_of_week := EXTRACT(DOW FROM check_date);
        
        FOR avail_record IN 
            SELECT * FROM doctor_availability 
            WHERE doctor_id = p_doctor_id 
            AND day_of_week = day_of_week 
            AND is_active = TRUE
        LOOP
            slot_start := avail_record.start_time;
            
            WHILE slot_start < avail_record.end_time LOOP
                -- Check if slot is available
                IF NOT EXISTS (
                    SELECT 1 FROM appointments 
                    WHERE doctor_id = p_doctor_id 
                    AND appointment_date = check_date 
                    AND appointment_time = slot_start
                    AND status NOT IN ('cancelled', 'no_show')
                ) AND NOT EXISTS (
                    SELECT 1 FROM doctor_unavailability
                    WHERE doctor_id = p_doctor_id
                    AND unavailable_date = check_date
                    AND (is_full_day = TRUE OR (start_time <= slot_start AND end_time > slot_start))
                ) THEN
                    slot_date := check_date;
                    slot_time := slot_start;
                    RETURN NEXT;
                    RETURN;
                END IF;
                
                slot_start := slot_start + (avail_record.slot_duration_minutes || ' minutes')::INTERVAL;
            END LOOP;
        END LOOP;
        
        check_date := check_date + 1;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

---

## 7. VECTOR DATABASE — QDRANT

### Setup Script (scripts/setup-qdrant.ts)

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';

const client = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });

async function setupCollections() {
  // Medical documents collection
  await client.createCollection('medical_documents', {
    vectors: {
      size: 1536,  // text-embedding-3-small
      distance: 'Cosine'
    },
    optimizers_config: {
      indexing_threshold: 100
    }
  });

  console.log('Qdrant collections created successfully');
}

setupCollections().catch(console.error);
```

### Payload Schema per Point

```typescript
interface QdrantPayload {
  patient_id: string;
  document_id: string;
  document_type: string;
  chunk_text: string;
  chunk_index: number;
  document_date: string;
  file_name: string;
  metadata: Record<string, any>;
}
```

---

## 8. API ARCHITECTURE & ALL ENDPOINTS

### Gateway Configuration (services/gateway/src/proxy.ts)

```typescript
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authMiddleware } from '../shared/middleware/auth.middleware';
import cors from 'cors';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Public routes (no auth required)
app.use('/api/auth', createProxyMiddleware({ target: 'http://auth-service:3001', changeOrigin: true }));

// Protected routes
app.use('/api', authMiddleware);
app.use('/api/appointments', createProxyMiddleware({ target: 'http://appointment-service:3002', changeOrigin: true }));
app.use('/api/triage', createProxyMiddleware({ target: 'http://triage-service:3003', changeOrigin: true }));
app.use('/api/medical-records', createProxyMiddleware({ target: 'http://records-service:3004', changeOrigin: true }));
app.use('/api/analytics', createProxyMiddleware({ target: 'http://analytics-service:3005', changeOrigin: true }));
app.use('/api/notifications', createProxyMiddleware({ target: 'http://notification-service:3006', changeOrigin: true }));
app.use('/api/wearables', createProxyMiddleware({ target: 'http://wearable-service:3007', changeOrigin: true }));
app.use('/api/patients', createProxyMiddleware({ target: 'http://patient-service:3008', changeOrigin: true }));
app.use('/api/doctors', createProxyMiddleware({ target: 'http://doctor-service:3009', changeOrigin: true }));

app.listen(3000, () => console.log('Gateway running on port 3000'));
```

### Complete Endpoint Reference

#### AUTH SERVICE (Port 3001)

```
POST   /api/auth/register/patient
       Body: { email, password, first_name, last_name, date_of_birth, gender, phone, preferred_language }
       Returns: { user, patient, tokens }

POST   /api/auth/register/doctor
       Body: { email, password, first_name, last_name, phone, specialization, license_number, qualification, experience_years }
       Returns: { user, doctor, tokens }

POST   /api/auth/login
       Body: { email, password }
       Returns: { user, role, tokens, profile }
       Notes: role-aware; returns patient or doctor profile

POST   /api/auth/logout
       Auth: Required
       Body: { refreshToken }

POST   /api/auth/refresh-token
       Body: { refreshToken }
       Returns: { accessToken, refreshToken }

POST   /api/auth/forgot-password
       Body: { email }
       Returns: { message }

POST   /api/auth/reset-password
       Body: { token, new_password }

GET    /api/auth/verify-email/:token
       Returns: { message }

POST   /api/auth/resend-verification
       Body: { email }

GET    /api/auth/me
       Auth: Required
       Returns: { user, profile }
```

#### APPOINTMENT SERVICE (Port 3002)

```
POST   /api/appointments/voice-booking
       Auth: Patient
       Body: { audio_base64: string }
       Returns: { transcription, extracted_details, available_slots, suggested_appointment }
       Notes: Uses VoiceBookingAgent; returns top 3 alternatives if preferred slot unavailable

POST   /api/appointments/book
       Auth: Patient
       Body: { doctor_id, date, time, urgency, chief_complaint, booking_notes }
       Returns: { appointment, queue_position, estimated_wait }
       Notes: Transactional; prevents double booking; auto-prioritizes emergencies

GET    /api/appointments/available-slots
       Auth: Required
       Query: doctor_id, date, urgency?
       Returns: { slots: [{ time, is_available, remaining_count }] }

GET    /api/appointments/patient/:patient_id
       Auth: Patient (own) or Doctor
       Query: status?, from_date?, to_date?, limit?, offset?
       Returns: { upcoming: [...], past: [...], total }

GET    /api/appointments/doctor/:doctor_id
       Auth: Doctor (own) or Admin
       Query: date?, status?, urgency?, limit?, offset?
       Returns: { appointments: [...], counts: { emergency, urgent, routine, total } }

PATCH  /api/appointments/:id/status
       Auth: Doctor or Admin
       Body: { status, cancellation_reason? }
       Returns: { appointment }

PATCH  /api/appointments/:id/cancel
       Auth: Patient (own, >2h before) or Doctor
       Body: { reason }
       Returns: { appointment }

GET    /api/appointments/:id/queue-status
       Auth: Patient (own)
       Returns: { position, ahead_count, estimated_wait_minutes, status }

POST   /api/appointments/availability
       Auth: Doctor
       Body: { day_of_week, start_time, end_time, slot_duration_minutes }
       Returns: { availability }

PATCH  /api/appointments/availability/:id
       Auth: Doctor
       Body: { start_time?, end_time?, is_active?, slot_duration_minutes? }

POST   /api/appointments/unavailability
       Auth: Doctor
       Body: { date, start_time?, end_time?, is_full_day, reason }

GET    /api/appointments/slots/next-available
       Auth: Required
       Query: doctor_id, from_date?, urgency?
       Returns: { next_slot: { date, time } }
```

#### TRIAGE SERVICE (Port 3003)

```
POST   /api/triage/start
       Auth: Patient
       Body: { chief_complaint, language }
       Returns: { session_id, condition_category, first_question }

POST   /api/triage/answer
       Auth: Patient
       Body: { session_id, question_key, response_text, response_value? }
       Returns: { next_question | summary, is_complete, is_emergency }
       Notes: Runs emergency detection on every answer

POST   /api/triage/voice-answer
       Auth: Patient
       Body: { session_id, audio_base64 }
       Returns: { transcription, next_question | summary, is_complete, is_emergency }

POST   /api/triage/upload-image
       Auth: Patient
       Body: FormData { session_id, image }
       Returns: { image_id, ai_analysis, follow_up_question? }

GET    /api/triage/summary/:session_id
       Auth: Patient (own) or Doctor
       Returns: { urgency_level, ai_summary, key_symptoms, recommended_actions, responses, completed_at }

GET    /api/triage/history/:patient_id
       Auth: Patient (own) or Doctor
       Query: limit?, offset?
       Returns: { sessions: [...], total }

GET    /api/triage/questions
       Auth: Required
       Query: condition_category
       Returns: { questions: [...] }

POST   /api/triage/abandon/:session_id
       Auth: Patient
       Returns: { message }

GET    /api/triage/active/:patient_id
       Auth: Patient
       Returns: { session | null }  — returns in-progress session if exists
```

#### MEDICAL RECORDS SERVICE (Port 3004)

```
POST   /api/medical-records/upload
       Auth: Patient or Doctor
       Body: FormData { patient_id, document_type, file, document_date? }
       Returns: { document_id, processing_status: 'queued' }
       Notes: Saves to Supabase Storage; queues BullMQ processing job

GET    /api/medical-records/patient/:patient_id
       Auth: Patient (own) or Doctor
       Query: document_type?, from_date?, to_date?, is_processed?, limit?, offset?
       Returns: { documents: [...], total }

GET    /api/medical-records/document/:document_id
       Auth: Patient (own) or Doctor
       Returns: { document, signed_url, extracted_text? }

DELETE /api/medical-records/document/:document_id
       Auth: Patient (own) or Admin
       Returns: { message }

POST   /api/medical-records/chat
       Auth: Patient or Doctor
       Body: { patient_id, query, conversation_history?, session_key? }
       Returns: { answer, source_documents, confidence_score, is_from_records }
       Notes: Strict patient_id filter; "not found" message if no matching chunks

GET    /api/medical-records/chat-history/:patient_id
       Auth: Patient (own) or Doctor
       Query: limit?, offset?
       Returns: { chats: [...] }

GET    /api/medical-records/export/:patient_id
       Auth: Patient (own) or Doctor
       Returns: PDF stream (Content-Type: application/pdf)
       Notes: Comprehensive PDF including vitals, consultations, medications

POST   /api/medical-records/reprocess/:document_id
       Auth: Admin or System
       Returns: { status: 'queued' }
```

#### ANALYTICS SERVICE (Port 3005)

```
GET    /api/analytics/patient/:patient_id/dashboard
       Auth: Patient (own) or Doctor
       Returns: {
         health_score: number,
         latest_vitals: { heart_rate, spo2, bp, temperature, steps, sleep, stress },
         active_alerts: [...],
         trend_summaries: { metric, trend, change_percent }[],
         last_7_days: { date, avg_heart_rate, avg_spo2, ... }[]
       }

GET    /api/analytics/doctor/:doctor_id/dashboard
       Auth: Doctor (own)
       Query: date?
       Returns: {
         patients_by_urgency: { emergency: [...], urgent: [...], routine: [...] },
         todays_appointments: [...],
         pending_triage_reviews: [...],
         recent_alerts: [...],
         stats: { total_patients, appointments_today, active_alerts }
       }

GET    /api/analytics/patient/:patient_id/trends
       Auth: Patient (own) or Doctor
       Query: metric (heart_rate|spo2|bp_systolic|bp_diastolic|temperature|steps|sleep_hours|stress_level),
              days? (default 7), from_date?, to_date?
       Returns: {
         metric_name,
         data_points: [{ timestamp, value }],
         baseline,
         std_dev,
         trend: 'increasing' | 'decreasing' | 'stable',
         trend_insight: string
       }

GET    /api/analytics/patient/:patient_id/alerts
       Auth: Patient (own) or Doctor
       Query: status?, severity?, limit?
       Returns: { alerts: [...] }

PATCH  /api/analytics/alerts/:alert_id/acknowledge
       Auth: Doctor
       Returns: { alert }

PATCH  /api/analytics/alerts/:alert_id/resolve
       Auth: Doctor
       Returns: { alert }

GET    /api/analytics/patient/:patient_id/health-score
       Auth: Patient (own) or Doctor
       Returns: {
         score: number (0-100),
         grade: 'excellent' | 'good' | 'fair' | 'poor',
         breakdown: { metric, score, weight }[],
         risk_factors: string[],
         recommendations: string[]
       }

GET    /api/analytics/doctor/:doctor_id/performance
       Auth: Doctor (own) or Admin
       Query: from_date, to_date
       Returns: { patients_seen, avg_consultation_minutes, no_show_rate }
```

#### NOTIFICATIONS SERVICE (Port 3006)

```
GET    /api/notifications/user/:user_id
       Auth: Self
       Query: is_read?, type?, limit?, offset?
       Returns: { notifications: [...], unread_count, total }

PATCH  /api/notifications/:id/read
       Auth: Self
       Returns: { notification }

PATCH  /api/notifications/user/:user_id/read-all
       Auth: Self
       Returns: { updated_count }

DELETE /api/notifications/:id
       Auth: Self
       Returns: { message }

GET    /api/notifications/reminders/:patient_id
       Auth: Patient (own)
       Returns: { reminders: [{ medication, time, is_active }] }

PATCH  /api/notifications/reminders/:reminder_id
       Auth: Patient
       Body: { is_active?, reminder_time? }
       Returns: { reminder }

POST   /api/notifications/reminders
       Auth: Patient
       Body: { patient_id, medication_id, reminder_time }
       Returns: { reminder }
```

#### WEARABLES SERVICE (Port 3007)

```
POST   /api/wearables/sync/:patient_id
       Auth: Patient (own) or System
       Returns: { synced_at, data_point }  — generates one mock reading

GET    /api/wearables/patient/:patient_id/latest
       Auth: Patient (own) or Doctor
       Returns: { vitals: { heart_rate, spo2, bp_systolic, bp_diastolic, temperature, steps, sleep_hours, stress_level }, recorded_at }

GET    /api/wearables/patient/:patient_id/history
       Auth: Patient (own) or Doctor
       Query: metric?, from_date?, to_date?, interval? (hourly|daily)
       Returns: { data: [{ timestamp, value }], metric }

POST   /api/wearables/patient/:patient_id/reading
       Auth: Patient (own) or Admin
       Body: { heart_rate?, spo2?, bp_systolic?, bp_diastolic?, temperature?, steps?, sleep_hours?, stress_level? }
       Returns: { reading }

POST   /api/wearables/simulate-anomaly
       Auth: Admin
       Body: { patient_id, metric, severity: 'mild' | 'severe' }
       Returns: { reading }
```

#### PATIENT SERVICE (Port 3008)

```
GET    /api/patients/:id
       Auth: Patient (own) or Doctor
       Returns: { patient, allergies, chronic_conditions, active_medications }

PATCH  /api/patients/:id
       Auth: Patient (own)
       Body: { first_name?, last_name?, phone?, height_cm?, weight_kg?, preferred_language?, ... }
       Returns: { patient }

POST   /api/patients/:id/allergies
       Auth: Patient
       Body: { allergen, severity, reaction_description? }
       Returns: { allergy }

DELETE /api/patients/:id/allergies/:allergy_id
       Auth: Patient (own)

POST   /api/patients/:id/conditions
       Auth: Patient or Doctor
       Body: { condition_name, diagnosed_date?, notes? }
       Returns: { condition }

DELETE /api/patients/:id/conditions/:condition_id
       Auth: Doctor or Admin

POST   /api/patients/:id/medications
       Auth: Patient
       Body: { medication_name, dosage, frequency, timing_instructions?, start_date, end_date? }
       Returns: { medication }

PATCH  /api/patients/:id/medications/:medication_id
       Auth: Patient
       Body: { is_active?, end_date?, notes? }
       Returns: { medication }

GET    /api/patients/:id/full-history
       Auth: Patient (own) or Doctor
       Returns: Complete medical history object (used for PDF export)
```

#### DOCTOR SERVICE (Port 3009)

```
GET    /api/doctors/:id
       Auth: Required
       Returns: { doctor, availability_schedule }

GET    /api/doctors
       Auth: Required
       Query: specialization?, is_available?
       Returns: { doctors: [...] }

PATCH  /api/doctors/:id
       Auth: Doctor (own)
       Body: { bio?, consultation_fee?, is_available?, average_consultation_time_minutes? }
       Returns: { doctor }

GET    /api/doctors/:id/patients
       Auth: Doctor (own)
       Query: urgency?, limit?, offset?
       Returns: { patients: [...] }

POST   /api/consultations
       Auth: Doctor
       Body: { appointment_id, diagnosis, symptoms, prescription_text, tests_recommended, follow_up_date, consultation_notes }
       Returns: { consultation }

GET    /api/consultations/:id
       Auth: Doctor or Patient (own appointment)
       Returns: { consultation, prescribed_medications }

GET    /api/consultations/patient/:patient_id
       Auth: Doctor or Patient (own)
       Query: limit?, offset?
       Returns: { consultations: [...] }

POST   /api/consultations/:id/medications
       Auth: Doctor
       Body: { medications: [{ medication_name, dosage, frequency, timing, duration_days, instructions }] }
       Returns: { prescribed_medications }
```

---

## 9. AI AGENTS & RAG SYSTEM

### 9.1 VoiceBookingAgent

**File:** `services/appointments/src/agents/VoiceBookingAgent.ts`

**Responsibilities:**
1. Receive base64-encoded audio
2. Transcribe via OpenAI Whisper
3. Extract: date (relative → absolute), time, urgency, complaint using GPT-4o with JSON mode
4. Check slot availability
5. If unavailable → return 3 nearest slots
6. Return structured booking proposal

**Key Implementation Notes:**
- Use `new Date().toISOString()` as context so GPT can resolve "next Tuesday"
- Handle ambiguous times: "evening" → 6:00 PM, "morning" → 9:00 AM, "afternoon" → 2:00 PM
- If patient says "emergency" or "urgent" → set urgency accordingly; also check against AI classification of complaint
- Response always includes human-readable confirmation text

### 9.2 DynamicTriageAgent

**File:** `services/triage/src/agents/TriageAgent.ts`

**Question Bank (Minimum — expand to 10+ per category in production):**

```typescript
export const QUESTION_BANK: Record<string, TriageQuestion[]> = {
  heart: [
    { key: 'chest_pain', text_en: 'Are you experiencing chest pain or discomfort?', type: 'yes_no', is_critical: true },
    { key: 'pain_duration', text_en: 'How long have you had this chest pain?', type: 'duration' },
    { key: 'pain_radiation', text_en: 'Does the pain spread to your arm, jaw, neck, or back?', type: 'yes_no', is_critical: true },
    { key: 'shortness_of_breath', text_en: 'Are you short of breath?', type: 'yes_no', is_critical: true },
    { key: 'sweating_nausea', text_en: 'Are you sweating or feeling nauseous?', type: 'yes_no' },
    { key: 'heart_history', text_en: 'Do you have a history of heart disease or have you had a heart attack before?', type: 'yes_no' },
    { key: 'current_medications', text_en: 'Are you taking any heart medications? If yes, which ones?', type: 'text' },
  ],
  respiratory: [
    { key: 'breathing_difficulty', text_en: 'Are you having difficulty breathing right now?', type: 'yes_no', is_critical: true },
    { key: 'breathing_severity', text_en: 'On a scale of 1 to 10, how severe is your breathing difficulty?', type: 'scale' },
    { key: 'cough_type', text_en: 'Do you have a cough? Is it dry or bringing up mucus?', type: 'choice', choices: ['No cough', 'Dry cough', 'Wet/productive cough', 'Coughing blood'] },
    { key: 'onset_duration', text_en: 'When did your breathing problems start?', type: 'duration' },
    { key: 'fever', text_en: 'Do you have a fever?', type: 'yes_no' },
    { key: 'asthma_history', text_en: 'Do you have asthma, COPD, or any chronic lung condition?', type: 'yes_no' },
    { key: 'inhaler_use', text_en: 'Have you used an inhaler or nebulizer? Did it help?', type: 'text' },
  ],
  digestive: [
    { key: 'pain_location', text_en: 'Where exactly is your stomach pain? Can you point to the area?', type: 'text' },
    { key: 'pain_severity', text_en: 'Rate your pain from 1 to 10', type: 'scale' },
    { key: 'nausea_vomiting', text_en: 'Are you experiencing nausea or vomiting?', type: 'yes_no' },
    { key: 'blood_in_stool', text_en: 'Have you noticed any blood in your stool or vomit?', type: 'yes_no', is_critical: true },
    { key: 'last_meal', text_en: 'When did you last eat, and what did you have?', type: 'text' },
  ],
  neurological: [
    { key: 'headache_severity', text_en: 'Rate your headache from 1 to 10. Is this the worst headache of your life?', type: 'scale', is_critical: true },
    { key: 'sudden_onset', text_en: 'Did the headache come on suddenly like a thunderclap?', type: 'yes_no', is_critical: true },
    { key: 'vision_changes', text_en: 'Are you having any vision changes, double vision, or vision loss?', type: 'yes_no', is_critical: true },
    { key: 'weakness_numbness', text_en: 'Do you have any weakness or numbness in your face, arm, or leg?', type: 'yes_no', is_critical: true },
    { key: 'speech_difficulty', text_en: 'Are you having difficulty speaking or finding words?', type: 'yes_no', is_critical: true },
  ],
  general: [
    { key: 'main_complaint', text_en: 'Please describe your main problem in your own words', type: 'text' },
    { key: 'duration', text_en: 'How long have you been experiencing this?', type: 'duration' },
    { key: 'severity', text_en: 'On a scale of 1 to 10, how much is this affecting your daily life?', type: 'scale' },
    { key: 'getting_worse', text_en: 'Is it getting better, worse, or staying the same?', type: 'choice', choices: ['Getting better', 'Getting worse', 'Same', 'Comes and goes'] },
    { key: 'current_medications', text_en: 'Are you currently taking any medications? Please list them.', type: 'text' },
    { key: 'allergies', text_en: 'Do you have any known allergies to medications or foods?', type: 'text' },
    { key: 'similar_episodes', text_en: 'Have you experienced this before? If yes, how was it treated?', type: 'text' },
  ]
};
```

**Emergency Detection Keywords:**
```typescript
const EMERGENCY_KEYWORDS = [
  'chest pain', 'can\'t breathe', 'can not breathe', 'heart attack',
  'stroke', 'unconscious', 'passed out', 'bleeding heavily', 'blood',
  'suicide', 'kill myself', 'severe pain', 'worst pain', 'thunderclap',
  'can\'t speak', 'face drooping', 'arm weakness', 'severe allergic',
  'anaphylaxis', 'swallowed', 'poisoned', 'overdose'
];
```

**AI Summary Prompt (used after all questions answered):**

```
You are a medical triage assistant generating a structured pre-consultation report.

Patient Chief Complaint: {chief_complaint}
Condition Category: {category}

Triage Responses:
{numbered_q_and_a}

Generate a professional medical triage report in this EXACT JSON format:
{
  "summary": "2-4 sentence clinical summary in professional medical language",
  "key_symptoms": ["symptom 1", "symptom 2", ...],
  "relevant_history": "any relevant medical history from the responses",
  "recommended_actions": ["action 1", "action 2"],
  "urgency_level": "EMERGENCY | URGENT | ROUTINE",
  "urgency_reasoning": "1-2 sentences explaining the urgency classification"
}

Guidelines:
- EMERGENCY: Immediate life threat (active chest pain, stroke signs, severe breathing difficulty, active bleeding)
- URGENT: Needs care within 24 hours but not immediately life-threatening
- ROUTINE: Can safely wait for regular appointment
```

### 9.3 MedicalRecordsRAG

**File:** `services/medical-records/src/rag/MedicalRAG.ts`

**Chunking Strategy:**
- Chunk size: 1000 characters
- Overlap: 200 characters
- Use `RecursiveCharacterTextSplitter` from LangChain.js
- For prescriptions: try to keep medication lines together (split on `\n\n` first)

**System Prompt for RAG Chat:**
```
You are TRIOVA's medical records assistant. Your ONLY job is to answer questions based on the uploaded medical records provided below.

STRICT RULES:
1. Answer ONLY from the context provided. Never use general medical knowledge to fill gaps.
2. If the information is not in the records, respond with: "This information is not available in the uploaded medical records. Please ensure the relevant document has been uploaded, or consult with your doctor."
3. If you find partial information, share it and clearly note what is missing.
4. Quote specific values exactly as they appear (e.g., medication doses, test results).
5. Do NOT provide medical advice, diagnoses, or treatment suggestions.
6. When citing, mention the document type (e.g., "According to the lab report from [date]...").

Medical Records Context:
{retrieved_chunks}
```

**Confidence Calculation:**
- If top result score < 0.4 → no match, return "not found" message
- If top result score 0.4–0.6 → low confidence, prefix answer with disclaimer
- If top result score > 0.6 → normal answer

### 9.4 HealthTrendsAnalysisAgent

**File:** `services/analytics/src/agents/TrendsAnalysisAgent.ts`

**Metrics Monitored:**

| Metric | Column | Normal Range | Critical Threshold |
|---|---|---|---|
| Heart Rate | heart_rate | 60–100 BPM | <40 or >140 |
| SpO2 | spo2 | 95–100% | <90% |
| Systolic BP | blood_pressure_systolic | 90–130 mmHg | <80 or >180 |
| Diastolic BP | blood_pressure_diastolic | 60–85 mmHg | <50 or >110 |
| Temperature | temperature_celsius | 36.1–37.5°C | <35 or >39.5 |
| Sleep | sleep_hours | 6–9 hrs | <4 or >12 |
| Stress | stress_level | 0–40 | >80 |
| Steps | steps | — | Trend only, no threshold |

**Alert Logic:**
1. Calculate rolling 7-day mean and std dev per patient per metric
2. Get today's latest reading
3. If |z-score| > 2: flag as abnormal (personal baseline, not medical norm)
4. If current value crosses absolute critical threshold: flag as CRITICAL regardless of z-score
5. Deduplicate: if alert for same metric+patient already active and unresolved, don't create duplicate
6. Use Redis lock during alert generation to prevent race conditions

**Health Score Calculation (0–100):**
```typescript
const weights = {
  heart_rate: 0.20,
  spo2: 0.25,
  blood_pressure: 0.20,
  sleep: 0.15,
  stress: 0.10,
  steps: 0.10
};
// Score each metric based on distance from optimal range
// Deduct for active alerts (high = -10, critical = -20)
```

### 9.5 MedicationExtractorAgent

**File:** `services/medical-records/src/services/medication-extractor.service.ts`

**Triggered when:** a `prescription` document is uploaded and processed.

**GPT Prompt:**
```
Extract all medications from this prescription text. Return ONLY valid JSON array.

Prescription Text:
{extracted_text}

Return format:
[
  {
    "medication_name": "string",
    "dosage": "string (e.g., '500mg')",
    "frequency": "string (e.g., 'twice daily', '3 times a day')",
    "timing": "string (e.g., 'after meals', 'before bedtime', 'morning')",
    "duration_days": number or null,
    "instructions": "string or null"
  }
]

If no medications found, return empty array [].
```

---

## 10. AUTHENTICATION & SECURITY

### JWT Strategy
- Access token: 7-day expiry (short refresh cycle for MVP; tighten to 15 min in production)
- Refresh token: 30-day expiry, stored in `users.refresh_token` column
- Tokens signed with `HS256` using `JWT_SECRET`

### Role-Based Access Control

```typescript
// Role hierarchy
// admin > doctor > patient

// Usage in routes:
router.get('/patients/:id', authMiddleware, roleMiddleware('patient', 'doctor', 'admin'), handler);
router.get('/doctor/:id/patients', authMiddleware, roleMiddleware('doctor', 'admin'), handler);

// Self-access check (patient can only access own data):
const isSelf = req.user.patientId === req.params.patient_id;
const isDoctor = req.user.role === 'doctor';
if (!isSelf && !isDoctor) return res.status(403).json({ error: 'Forbidden' });
```

### Password Policy
- Minimum 8 characters
- At least one uppercase, one number
- Hashed with bcrypt, salt rounds = 10

### Security Headers (helmet.js)
```typescript
import helmet from 'helmet';
app.use(helmet());
// Adds: Content-Security-Policy, X-Frame-Options, X-XSS-Protection, etc.
```

### Rate Limiting
```typescript
// Login: 5 attempts per 15 minutes per IP
// API: 100 requests per minute per user
// File upload: 10 uploads per hour per user
// RAG chat: 30 queries per hour per user
```

### File Upload Security
- Validate MIME type server-side (not just extension)
- Max file size: 20MB per document
- Virus scan: integrate ClamAV (optional for MVP)
- Files stored in private Supabase bucket (no public access)
- All access via time-limited signed URLs (1-hour expiry)

---

## 11. REAL-TIME FEATURES — SOCKET.IO

### Socket Events Reference

**Server → Client Events:**

| Event | Payload | Description |
|---|---|---|
| `queue_update` | `{ appointment_id, position, estimated_wait_minutes }` | Patient's queue position changed |
| `appointment_confirmed` | `{ appointment }` | Doctor confirmed appointment |
| `appointment_called` | `{ appointment_id }` | Patient's turn — come in now |
| `health_alert` | `{ alert }` | New health alert for patient |
| `patient_alert` | `{ patient_id, patient_name, alert }` | Doctor notified of patient alert |
| `trend_insight` | `{ patient_id, insights: [...] }` | New trend analysis complete |
| `notification` | `{ type, title, message, severity }` | General notification |
| `triage_received` | `{ session_id, summary_preview }` | Doctor told patient submitted triage |
| `document_processed` | `{ document_id, success, error? }` | Document OCR/indexing complete |

**Client → Server Events:**

| Event | Payload | Description |
|---|---|---|
| `join_appointment_queue` | `{ appointment_id }` | Subscribe to queue updates |
| `leave_appointment_queue` | `{ appointment_id }` | Unsubscribe |
| `rejoin_rooms` | `{ user_id, role }` | Re-subscribe after reconnect |

### Rooms Strategy
```
user:{user_id}                — personal notification room
role:doctor                   — all doctor broadcast room
appointment:{appointment_id}  — queue status room
doctor_dashboard:{doctor_id}  — doctor's live dashboard updates
```

---

## 12. FILE STORAGE & DOCUMENT PROCESSING

### Storage Architecture (Supabase)

**Buckets:**
- `medical-documents` (private, authenticated access only)
- `profile-pictures` (public read)
- `triage-images` (private)

**File Path Structure:**
```
medical-documents/{patient_id}/{year}/{document_type}/{timestamp}_{filename}
profile-pictures/{user_id}/avatar.{ext}
triage-images/{session_id}/{timestamp}.jpg
```

### Document Processing BullMQ Job

**Queue:** `document-processing`

**Job Data:**
```typescript
interface DocumentJob {
  documentId: string;
  patientId: string;
  fileUrl: string;
  documentType: string;
  mimeType: string;
  retryCount: number;
}
```

**Worker Logic:**
```
1. Download file from Supabase Storage
2. Extract text:
   - PDF → pdf-parse
   - Images (jpg/png/heic) → sharp (preprocess) → Tesseract.js OCR
3. If document_type === 'prescription' → run MedicationExtractorAgent
   - Create patient_medications records
   - Create medication_reminders records
4. Store extracted_text in medical_documents table
5. Chunk text → generate embeddings → upsert to Qdrant
6. Set is_processed = true
7. Emit `document_processed` socket event to patient
8. On failure: increment retry_count, re-queue if < 3 retries
   On max retries: set processing_error, notify patient
```

---

## 13. NOTIFICATION SYSTEM

### Notification Types & Channels

| Event | In-App | SMS | Email |
|---|---|---|---|
| Appointment booked | ✅ | ✅ | ✅ |
| Appointment reminder (1 hour before) | ✅ | ✅ | — |
| Appointment cancelled | ✅ | ✅ | ✅ |
| Turn called in queue | ✅ | ✅ | — |
| Medication reminder | ✅ | ✅ | — |
| Health alert (patient) | ✅ | — | — |
| Health alert (doctor) | ✅ | — | — |
| Document processed | ✅ | — | — |
| Triage received (doctor) | ✅ | — | — |

### Email Service (Nodemailer + Gmail SMTP or SendGrid free tier)

**Templates needed:**
- `appointment-confirmation.html`
- `appointment-cancellation.html`
- `email-verification.html`
- `password-reset.html`
- `welcome-patient.html`
- `welcome-doctor.html`

### SMS Service (Twilio)

Keep messages short (< 160 chars):
```
TRIOVA: Appointment confirmed for Tue 15 Apr at 10:00 AM with Dr. Sharma. Reply CANCEL to cancel.
TRIOVA: Time to take Metformin 500mg with breakfast. Stay healthy!
TRIOVA: Your appointment with Dr. Sharma is in 1 hour. Please be ready.
```

### Medication Reminder Cron

```
Schedule: Every 30 minutes (*/30 * * * *)
Logic:
  1. Get all active reminders where reminder_time is within next 30 minutes
  2. Check patient medication is still active and not past end_date
  3. Check last_sent_at is not within last 23 hours (prevent duplicate sends)
  4. Send SMS + in-app notification
  5. Update last_sent_at
```

### Appointment Reminder Cron

```
Schedule: Every hour (0 * * * *)
Logic:
  1. Get all scheduled/confirmed appointments in the next 60-90 minutes
  2. Send SMS reminder to patient
  3. Create in-app notification
```

---

## 14. WEARABLE DATA INTEGRATION (MOCK)

### Metrics Generated (7 total)

1. **Heart Rate** — 60–100 BPM baseline; variance ±15
2. **SpO2** — 95–99% baseline; variance ±3
3. **Blood Pressure Systolic** — 110–130 mmHg; variance ±15
4. **Blood Pressure Diastolic** — 70–85 mmHg; variance ±10
5. **Temperature** — 36.5–37.2°C; variance ±0.5
6. **Steps** — 5000–10000/day baseline; variance ±2000
7. **Sleep Hours** — 6–8 hours; variance ±1.5
8. **Stress Level** — 20–50/100 baseline; variance ±20

### Generation Strategy

- **Per patient baseline:** Store in `baseline_metrics` table. First reading uses defaults. Subsequent readings use patient's personal baseline.
- **Cron schedule:** Generate one reading per active patient every hour (0 * * * *)
- **Realistic variation:** Use Box-Muller transform for Gaussian distribution
- **Day/night awareness:** Steps = 0 during sleep hours (11 PM–7 AM), heart rate slightly lower at night
- **Anomaly simulation endpoint** available for testing alert system

### Mock Data Seeding

On new patient registration:
1. Generate 7 days of historical hourly data (168 readings)
2. Calculate initial baselines from this data
3. Start hourly generation cron

---

## 15. FRONTEND — PAGES & COMPONENTS

### Routing Structure

```typescript
// App.tsx
<Routes>
  {/* Public */}
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />
  <Route path="/verify-email/:token" element={<VerifyEmail />} />

  {/* Patient Protected */}
  <Route element={<ProtectedRoute role="patient" />}>
    <Route path="/patient" element={<PatientLayout />}>
      <Route index element={<PatientDashboard />} />
      <Route path="book" element={<BookAppointment />} />
      <Route path="triage" element={<TriagePage />} />
      <Route path="triage/:sessionId" element={<TriageSession />} />
      <Route path="records" element={<MedicalRecords />} />
      <Route path="records/chat" element={<RecordsChat />} />
      <Route path="medications" element={<Medications />} />
      <Route path="profile" element={<PatientProfile />} />
      <Route path="appointments/:id" element={<AppointmentDetail />} />
    </Route>
  </Route>

  {/* Doctor Protected */}
  <Route element={<ProtectedRoute role="doctor" />}>
    <Route path="/doctor" element={<DoctorLayout />}>
      <Route index element={<DoctorDashboard />} />
      <Route path="patients" element={<PatientQueue />} />
      <Route path="patients/:patientId" element={<PatientDetail />} />
      <Route path="appointments" element={<AppointmentCalendar />} />
      <Route path="schedule" element={<AvailabilityManager />} />
    </Route>
  </Route>
</Routes>
```

### Key Page Specifications

**PatientDashboard.tsx:**
- Greeting with patient name
- Upcoming appointment card (next appointment, queue position if today)
- Quick actions: Book Appointment, Start Triage, Upload Record
- Latest vitals grid (HR, SpO2, BP, Temp, Sleep, Steps, Stress) — each as a card with mini trend sparkline
- Today's medication reminders
- Unread notifications bell with count

**BookAppointment.tsx:**
- Step 1: Voice or text input ("Tell us what brings you in...")
- Step 2: Date/time picker with available slots loaded dynamically
- Step 3: Urgency assessment (auto-filled from voice, editable)
- Step 4: Confirm booking — show details, estimated wait
- Voice button: hold to record; auto-transcribes; auto-fills form fields

**TriagePage / TriageSession.tsx:**
- Full-screen experience — one question at a time
- Progress indicator (Question 3 of 7)
- Voice answer button OR text input
- Image upload option (floating button)
- Emergency escalation banner if emergency detected
- Summary screen at end with urgency badge

**DoctorDashboard.tsx:**
- Sticky alert bar at top if any CRITICAL alerts
- Three-column layout: Emergency | Urgent | Routine patient cards
- Each card: patient photo, name, age, chief complaint, AI summary snippet, last vital reading, trend sparkline
- Click → opens PatientDetail slide-over panel
- Bottom section: Today's appointment timeline, Recent trend alerts

**PatientDetail.tsx (Doctor view):**
- Full patient profile header
- Tabs: Overview | Triage History | Medical Records | Vitals & Trends | Consultations
- Overview: AI triage summary, latest vitals, active alerts
- Vitals & Trends: Multi-metric chart with date range picker
- RAG Chat Box: "Ask about this patient's records" — doctor-side chat
- Start Consultation button → opens consultation form

**RecordsChat.tsx (Patient view):**
- Chat interface (message bubbles)
- Input: text + voice
- Source references shown below each AI answer
- Upload button to add more documents
- "No records uploaded yet" empty state with upload CTA

### Shared Components

**VoiceButton.tsx:**
```tsx
// Hold to record, release to submit
// Shows audio waveform animation while recording
// Timeout: auto-stop at 60 seconds
// Fallback: text input if Web Speech API unsupported
```

**RAGChatBox.tsx:**
```tsx
// Reused on patient records page AND doctor patient detail
// Props: patient_id, querier_role ('patient' | 'doctor')
// Displays: source document badges below each answer
// Confidence indicator: green/yellow/red
```

**WearableChart.tsx:**
```tsx
// Recharts LineChart
// Props: patient_id, metric, days (7|14|30)
// Shows: baseline reference line, alert threshold lines
// Anomaly points highlighted in red
// Responsive, mobile-friendly
```

**UrgencyBadge.tsx:**
```tsx
// emergency → red pulsing dot + "EMERGENCY" text
// urgent → orange dot + "URGENT"
// routine → green dot + "ROUTINE"
```

---

## 16. BACKGROUND JOBS & CRON SCHEDULES

### All Cron Jobs

| Job | Schedule | Service | Description |
|---|---|---|---|
| Generate wearable data | `0 * * * *` | Wearables | One reading per active patient |
| Analyze health trends | `0 8 * * *` | Analytics | Daily trend calc + alert generation |
| Recalculate baselines | `0 2 * * *` | Analytics | Rolling 7-day baseline update |
| Medication reminders | `*/30 * * * *` | Notifications | Check and send due reminders |
| Appointment reminders | `0 * * * *` | Notifications | 1-hour-before reminders |
| Clean up abandoned triage | `0 3 * * *` | Triage | Mark sessions > 24h as abandoned |
| Archive old notifications | `0 4 * * 0` | Notifications | Archive notifications > 90 days |

### BullMQ Queues

| Queue | Jobs | Concurrency | Retry Policy |
|---|---|---|---|
| `document-processing` | processDocument | 3 | 3 retries, exponential backoff |
| `email-notifications` | sendEmail | 5 | 3 retries, 30s delay |
| `sms-notifications` | sendSMS | 5 | 3 retries, 30s delay |
| `analytics-processing` | analyzeTrends, recalcBaseline | 2 | 2 retries |
| `medication-extraction` | extractMedications | 3 | 3 retries |

---

## 17. PDF EXPORT — MEDICAL HISTORY

### PDFKit Implementation

**File:** `services/medical-records/src/services/pdf-export.service.ts`

**Structure of Exported PDF:**

```
Page 1: Cover Page
  - TRIOVA logo + header
  - Patient name, DOB, blood group, phone
  - Export date
  - "Confidential Medical Record" watermark

Page 2: Medical Profile
  - Chronic Conditions table
  - Allergies table
  - Emergency Contact

Page 3: Current Medications
  - Table: Medication | Dosage | Frequency | Start Date | Status

Page 4: Triage History (last 5)
  - Per session: Date, Chief Complaint, Urgency, AI Summary

Page 5+: Consultation History
  - Per consultation: Date, Doctor, Diagnosis, Symptoms, Prescription, Follow-up

Final Page: Wearable Data Summary
  - Last 30 days average per metric
  - Table + sparkline charts (rendered as PNG, embedded)
  - Active alerts at time of export
```

**Code Pattern:**
```typescript
import PDFDocument from 'pdfkit';
import { Response } from 'express';

export async function exportMedicalHistory(patientId: string, res: Response) {
  const data = await fetchFullPatientHistory(patientId);
  
  const doc = new PDFDocument({ margins: { top: 50, bottom: 50, left: 60, right: 60 } });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="TRIOVA_${data.patient.last_name}_${Date.now()}.pdf"`);
  
  doc.pipe(res);
  
  // Build pages...
  
  doc.end();
}
```

---

## 18. EDGE CASES & ERROR HANDLING

### Complete Edge Case Register

**1. Double Booking Prevention**
- Use PostgreSQL transaction with `SELECT ... FOR UPDATE` before insert
- UNIQUE constraint on `(doctor_id, appointment_date, appointment_time)` as final safety net
- Return HTTP 409 Conflict with nearest 3 alternative slots

**2. Emergency Appointment When No Slots Available**
- Find first routine appointment on the same day
- Push it 15 minutes (check if that creates another conflict)
- Notify affected patient via in-app + SMS: "Your appointment has been rescheduled by 15 minutes due to an emergency."
- If no same-day appointments exist, create slot at start of next available day

**3. Triage Session Recovery**
- On `/triage/start`, check for existing `in_progress` session for patient
- If found and started < 24 hours ago, return existing session ID and last unanswered question
- Frontend prompts: "You have an unfinished triage. Continue or start new?"

**4. RAG Query With No Results**
- If Qdrant returns 0 results or max score < 0.4 → return standardized "not found" message
- Do NOT call GPT (saves cost)
- Log the query for review (may indicate missing documents)

**5. RAG Query With Low Confidence (score 0.4–0.6)**
- Call GPT but prefix response with: ⚠️ "The following is based on limited matching information and may not be fully accurate. Please verify with your doctor."

**6. Document Processing Failure**
- Worker catches error, logs it
- Increments `retry_count` in DB
- If `retry_count < 3`: re-queue job with exponential delay (1min, 5min, 15min)
- If `retry_count >= 3`: set `processing_error` text, set `is_processed = false` permanently
- Send in-app notification: "Document processing failed. Please re-upload or contact support."

**7. Voice Input Poor Audio Quality**
- Whisper transcription returns short/garbled text (< 3 words or confidence indicators)
- Return: `{ success: false, error: 'audio_quality', fallback: 'text_input' }`
- Frontend shows: "Couldn't understand audio clearly. Please try again in a quiet space or type your response."

**8. Medication Reminder for Expired Medication**
- Before sending any reminder, check `patient_medications.is_active` and `end_date`
- If expired: auto-deactivate reminder (`is_active = false`), skip send
- Log deactivation

**9. Concurrent Alert Generation (Race Condition)**
- Before generating alerts for a patient, acquire Redis lock: `SET alert:lock:{patient_id} 1 EX 120 NX`
- If lock acquisition fails → skip (another process is running)
- Release lock in `finally` block

**10. Patient Cancels Past 2-Hour Window**
- Return HTTP 400 with message: "Appointments can only be cancelled up to 2 hours before the scheduled time. Please contact your doctor's office directly."
- Frontend shows doctor contact info

**11. WebSocket Disconnection**
- Client-side: Implement exponential backoff reconnect (1s, 2s, 4s, 8s, max 30s)
- On reconnect, emit `rejoin_rooms` to re-subscribe to all rooms
- Server-side: If message sent to disconnected socket, store in `notifications` table (in-app bell catches it on next load)

**12. Wearable Data Anomaly Coinciding with Normal Baseline Period**
- If patient has < 3 days of data, do NOT run anomaly detection (insufficient baseline)
- Use absolute medical thresholds instead until sufficient data collected
- Show notice on dashboard: "Personalizing your health baseline... (3 days remaining)"

**13. GPT API Rate Limit / Timeout**
- Wrap all OpenAI calls with retry logic: 3 retries, 2-second delay
- On persistent failure: return HTTP 503 with `{ error: 'ai_service_unavailable', can_retry: true }`
- Triage: allow patient to continue and manually review later
- RAG: return error to user without losing chat history

**14. Incorrect Role Access Attempt**
- Log the attempt (userId, attempted endpoint, actual role)
- Return HTTP 403 Forbidden
- After 5 such attempts in 10 minutes: flag account for review, notify admin

**15. PDF Export for Patient with No Data**
- Generate PDF with placeholder sections: "No consultations on record", "No medications recorded"
- Do NOT throw error — return a valid but sparse PDF

**16. Hindi Triage Questions Translation**
- Store pre-translated versions in `triage_question_bank.question_text_hi`
- Fall back to GPT translation only if `question_text_hi` is null
- Cache GPT translations in Redis (TTL: 7 days)

**17. Appointment Voice Booking — Ambiguous Date**
- If GPT cannot confidently resolve the date, return: `{ needs_clarification: true, clarification_prompt: "Did you mean [best guess date]?" }`
- Frontend shows options: "Yes, [date]" or "Pick a different date"

**18. Qdrant Vector DB Unavailable**
- Catch connection errors
- Return HTTP 503 with message indicating RAG chat is temporarily unavailable
- Do not crash the medical-records service
- Alert via logging/Sentry

---

## 19. ENVIRONMENT VARIABLES — COMPLETE LIST

Create `.env` in project root and each service:

```bash
# ============================================
# APPLICATION
# ============================================
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=info

# ============================================
# DATABASE
# ============================================
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/triova_health
POSTGRES_DB=triova_health
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_strong_password

# ============================================
# REDIS
# ============================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=redis://localhost:6379

# ============================================
# QDRANT
# ============================================
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                    # Optional, for cloud-hosted Qdrant

# ============================================
# JWT
# ============================================
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long-change-this
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d

# ============================================
# OPENAI
# ============================================
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_WHISPER_MODEL=whisper-1

# ============================================
# SUPABASE (File Storage + PostgreSQL)
# ============================================
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_BUCKET_MEDICAL_DOCS=medical-documents
SUPABASE_BUCKET_PROFILES=profile-pictures
SUPABASE_BUCKET_TRIAGE_IMAGES=triage-images

# ============================================
# TWILIO (SMS)
# ============================================
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1234567890

# ============================================
# EMAIL (SMTP)
# ============================================
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-gmail-app-password
EMAIL_FROM_NAME=TRIOVA Health
EMAIL_FROM_ADDRESS=no-reply@triova.health

# ============================================
# SENTRY (Error Tracking)
# ============================================
SENTRY_DSN=https://...@sentry.io/...

# ============================================
# BCRYPT
# ============================================
BCRYPT_SALT_ROUNDS=10

# ============================================
# RATE LIMITING
# ============================================
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_LOGIN_WINDOW_MS=900000
RATE_LIMIT_API_MAX=100
RATE_LIMIT_API_WINDOW_MS=60000
RATE_LIMIT_UPLOAD_MAX=10
RATE_LIMIT_UPLOAD_WINDOW_MS=3600000

# ============================================
# FILE UPLOAD
# ============================================
MAX_FILE_SIZE_BYTES=20971520     # 20MB
ALLOWED_MIME_TYPES=application/pdf,image/jpeg,image/png,image/heic

# ============================================
# CRON SETTINGS
# ============================================
ENABLE_CRON_JOBS=true
WEARABLE_DATA_CRON=0 * * * *
HEALTH_TRENDS_CRON=0 8 * * *
MEDICATION_REMINDER_CRON=*/30 * * * *
APPOINTMENT_REMINDER_CRON=0 * * * *
```

---

## 20. DOCKER & DEPLOYMENT

### docker-compose.yml (Production)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  qdrant:
    image: qdrant/qdrant:latest
    restart: always
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  gateway:
    build:
      context: ./services/gateway
      dockerfile: Dockerfile
    restart: always
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  auth-service:
    build:
      context: .
      dockerfile: services/auth/Dockerfile
    restart: always
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  appointment-service:
    build:
      context: .
      dockerfile: services/appointments/Dockerfile
    restart: always
    ports:
      - "3002:3002"
    env_file: .env
    depends_on:
      - postgres
      - redis

  triage-service:
    build:
      context: .
      dockerfile: services/triage/Dockerfile
    restart: always
    ports:
      - "3003:3003"
    env_file: .env
    depends_on:
      - postgres
      - redis

  medical-records-service:
    build:
      context: .
      dockerfile: services/medical-records/Dockerfile
    restart: always
    ports:
      - "3004:3004"
    env_file: .env
    depends_on:
      - postgres
      - redis
      - qdrant

  analytics-service:
    build:
      context: .
      dockerfile: services/analytics/Dockerfile
    restart: always
    ports:
      - "3005:3005"
    env_file: .env
    depends_on:
      - postgres
      - redis

  notification-service:
    build:
      context: .
      dockerfile: services/notifications/Dockerfile
    restart: always
    ports:
      - "3006:3006"
    env_file: .env
    depends_on:
      - postgres
      - redis

  wearable-service:
    build:
      context: .
      dockerfile: services/wearables/Dockerfile
    restart: always
    ports:
      - "3007:3007"
    env_file: .env
    depends_on:
      - postgres
      - redis

  patient-service:
    build:
      context: .
      dockerfile: services/patients/Dockerfile
    restart: always
    ports:
      - "3008:3008"
    env_file: .env
    depends_on:
      - postgres

  doctor-service:
    build:
      context: .
      dockerfile: services/doctors/Dockerfile
    restart: always
    ports:
      - "3009:3009"
    env_file: .env
    depends_on:
      - postgres

volumes:
  postgres_data:
  redis_data:
  qdrant_data:
```

### Dockerfile Template (All Services)

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npm run build

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "dist/index.js"]
```

### Health Check Endpoint (Every Service)

```typescript
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'auth-service',
    timestamp: new Date().toISOString()
  });
});
```

### GitHub Actions CI/CD (.github/workflows/ci.yml)

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: triova_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run type-check
      - run: npm run lint
      - run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:testpassword@localhost:5432/triova_test
          JWT_SECRET: test-secret-key-minimum-32-chars
          NODE_ENV: test
```

---

## 21. SEED DATA & TESTING GUIDE

### Seed Script (scripts/seed.ts)

Creates:
- 1 Doctor account
- 3 Patient accounts  
- Pre-loaded triage question bank (all 5 categories)
- Doctor availability schedule (Mon–Fri, 9 AM–5 PM)
- Sample appointments
- 7 days of wearable data per patient
- Sample medical documents (text-based, no real files needed for seed)

```typescript
// Usage:
// npx ts-node scripts/seed.ts

const DOCTOR = {
  email: 'dr.sharma@triova.health',
  password: 'Doctor@123',
  first_name: 'Priya',
  last_name: 'Sharma',
  specialization: 'General Medicine',
  license_number: 'MH-2024-001'
};

const PATIENTS = [
  {
    email: 'raj.kumar@example.com',
    password: 'Patient@123',
    first_name: 'Raj',
    last_name: 'Kumar',
    date_of_birth: '1985-03-15',
    gender: 'male',
    phone: '+919876543210',
    blood_group: 'B+',
    chronic_conditions: ['Type 2 Diabetes', 'Hypertension'],
    allergies: [{ allergen: 'Penicillin', severity: 'severe' }]
  },
  // ... 2 more patients
];
```

### API Testing Flow

**Full Happy Path Test:**

1. Register patient → login → get tokens
2. Register doctor → login → set availability (Mon 9AM-5PM)
3. Patient: POST `/api/appointments/book` with date/time
4. Verify appointment appears in doctor's dashboard
5. Patient: POST `/api/triage/start` → answer 5 questions → get summary
6. Verify triage linked to patient record
7. POST `/api/medical-records/upload` with a text PDF
8. Wait for processing → GET `/api/medical-records/document/:id` to verify
9. POST `/api/medical-records/chat` with a question → verify answer
10. GET `/api/analytics/patient/:id/dashboard` → verify vitals
11. GET `/api/medical-records/export/:id` → verify PDF download

---

## 22. IMPLEMENTATION ORDER / SPRINT PLAN

### Sprint 1 — Foundation (Week 1–2)

**Priority: Get core infrastructure running**

1. Initialize monorepo structure
2. Set up Docker Compose (Postgres, Redis, Qdrant)
3. Run SQL migrations (all 3 files)
4. Run Qdrant setup script
5. Implement Auth Service (register, login, JWT, refresh)
6. Implement Patient + Doctor profile services (basic CRUD)
7. Set up API Gateway with proxy routing
8. Frontend: Login + Register pages + routing skeleton

**Deliverable:** Working auth flow with role-based redirect

---

### Sprint 2 — Appointments (Week 3)

1. Doctor Availability management
2. Slot calculation logic
3. Standard appointment booking (manual)
4. VoiceBookingAgent (Whisper + GPT)
5. Emergency prioritization logic
6. Queue management
7. Frontend: BookAppointment page, Doctor calendar view
8. Socket.io setup + queue position events

**Deliverable:** End-to-end appointment booking (voice + manual)

---

### Sprint 3 — Triage AI (Week 4)

1. Seed triage question bank (all categories)
2. DynamicTriageAgent implementation
3. Emergency detector
4. Hindi translation support
5. Triage image upload + GPT-4 Vision analysis
6. Triage summary generation
7. Frontend: Triage flow (voice + text), urgency display
8. Doctor dashboard triage summary cards

**Deliverable:** Complete AI triage with urgency classification

---

### Sprint 4 — Medical Records + RAG (Week 5)

1. Supabase Storage setup + upload endpoint
2. BullMQ document processing queue
3. pdf-parse + Tesseract OCR workers
4. MedicalRAG: chunking, embedding, Qdrant indexing
5. RAG chat endpoint
6. MedicationExtractorAgent (auto-create reminders)
7. Frontend: Upload UI, chat interface, document list
8. PDF export endpoint (PDFKit)

**Deliverable:** Working RAG chat over patient documents

---

### Sprint 5 — Analytics + Wearables (Week 6)

1. Mock wearable data generation service
2. Hourly cron for data generation
3. Baseline calculation service
4. TrendsAnalysisAgent (anomaly detection)
5. Health alerts creation + deduplication
6. Doctor dashboard trend view
7. Patient vitals charts (Recharts)
8. Health score calculation

**Deliverable:** Real-time health monitoring with alerts

---

### Sprint 6 — Notifications + Polish (Week 7)

1. Nodemailer email setup + templates
2. Twilio SMS integration
3. Medication reminder cron
4. Appointment reminder cron
5. In-app notification bell
6. Socket.io health alert push
7. Patient dashboard complete
8. Medical history PDF export (full)

**Deliverable:** All notifications working; complete patient dashboard

---

### Sprint 7 — Testing, Edge Cases, Deployment (Week 8)

1. Implement all edge cases (sections 18)
2. Error middleware (global handler)
3. Rate limiting on all sensitive endpoints
4. API documentation (Swagger)
5. Seed script complete
6. Docker Compose production config finalized
7. Deploy: Railway (backend) + Vercel (frontend) + Supabase (DB + Storage)
8. GitHub Actions CI/CD pipeline
9. Sentry error tracking integration
10. End-to-end manual test of all features

**Deliverable:** Production-ready deployed application

---

## APPENDIX A — SAMPLE GPT RESPONSES

### Triage Summary Example

```json
{
  "summary": "55-year-old male presenting with sudden-onset severe chest pain radiating to the left arm, accompanied by diaphoresis and dyspnea for the past 45 minutes. Patient has a known history of hypertension and is on Amlodipine. No prior myocardial infarction reported.",
  "key_symptoms": ["chest pain", "left arm radiation", "sweating", "shortness of breath"],
  "relevant_history": "Hypertension, current medication: Amlodipine",
  "recommended_actions": ["Immediate ECG", "Cardiac enzyme panel", "Aspirin if not contraindicated", "IV access"],
  "urgency_level": "EMERGENCY",
  "urgency_reasoning": "Classic presentation of acute coronary syndrome with chest pain, arm radiation, diaphoresis, and dyspnea requires immediate evaluation."
}
```

### RAG Chat Response Example

```json
{
  "answer": "According to the lab report dated 12 March 2025, your HbA1c was 7.8%, indicating suboptimal glycemic control. Your fasting blood glucose was 142 mg/dL. The report also noted elevated LDL cholesterol at 148 mg/dL.",
  "source_documents": ["doc-uuid-123", "doc-uuid-456"],
  "confidence_score": 84,
  "is_from_records": true
}
```

---

## APPENDIX B — GLOSSARY

| Term | Meaning |
|---|---|
| Triage | Pre-consultation patient assessment |
| RAG | Retrieval-Augmented Generation — AI answers from own documents |
| BullMQ | Redis-backed background job queue |
| Qdrant | Open-source vector database |
| Whisper | OpenAI's speech-to-text model |
| SpO2 | Blood oxygen saturation |
| Baseline | Patient's personal rolling average for a health metric |
| Z-score | Statistical measure of deviation from baseline |
| Queue Position | Patient's place in doctor's daily appointment queue |
| Chunk | A section of text extracted from a document for RAG indexing |

---

*Document Version: 1.0 | Platform: TRIOVA Health | Prepared for Full-Stack Implementation*
*All technology choices are free/open-source unless otherwise noted. OpenAI API is the only paid dependency.*
