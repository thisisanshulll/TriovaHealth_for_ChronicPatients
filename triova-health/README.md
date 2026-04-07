# TRIOVA Health Platform

A comprehensive healthcare management platform for chronic patients, featuring AI-powered medical record analysis, appointment scheduling with Google Calendar integration, and smart medication reminders.

## Features

### 1. Patient Appointment Booking
- Book appointments with doctors with real-time slot availability
- Voice and manual booking with next-slot suggestions
- Google Calendar integration for doctors
- Appointment queue management with position tracking
- Urgency classification (emergency, urgent, routine, follow-up)

### 2. Medical Records RAG Chatbot
- Upload medical documents (PDF, images)
- AI-powered chat interface to query your medical records
- Uses Groq API (free tier) for intelligent responses
- Automatic text extraction from documents
- Fallback to direct database when vector store is unavailable

### 3. Medication Reminder System
- Upload prescriptions and let AI extract medication details
- Automatic medication scheduling based on frequency
- Smart reminder times (morning, afternoon, evening)
- Active medications dashboard
- Cron-based automatic alerts (when enabled)

### 4. Patient Triage System
- AI-powered dynamic question flow
- Urgency classification based on symptoms
- Preliminary health assessment

### 5. Health Analytics Dashboard
- 7-day vitals trend visualization
- Health score calculation
- Active alerts monitoring
- Heart rate, SpO2, blood pressure tracking
- Steps, sleep, and stress monitoring

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development
- **Tailwind CSS** for styling
- **Recharts** for data visualization
- **React Query** for data fetching
- **Zustand** for state management

### Backend
- **Express.js** with TypeScript
- **PostgreSQL** for data storage
- **Redis** for queues and caching
- **Qdrant** for vector embeddings (RAG)
- **Groq API** for AI processing
- **BullMQ** for background job processing
- **Socket.io** for real-time updates

### Infrastructure
- **Docker** for containerization
- **Node.js** runtime

## Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- PostgreSQL, Redis, Qdrant (via Docker)

### 1. Clone and Setup

```bash
git clone https://github.com/thisisanshulll/TriovaHealth_for_ChronicPatients.git
cd TriovaHealth_for_ChronicPatients
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/triova_health

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key

# Qdrant (Vector DB)
QDRANT_URL=http://localhost:6333

# Google Calendar (Optional)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# AI Provider (Groq recommended - free tier)
AI_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile

# Cron Jobs (for medication reminders)
ENABLE_CRON_JOBS=true
```

### 3. Start Infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL on port 5433
- Redis on port 6379
- Qdrant on port 6333

### 4. Database Setup

Apply the schema migrations:

```bash
# Apply initial schema
docker exec -i triova-health-postgres-1 psql -U postgres -d triova_health < services/shared/db/migrations/001_initial_schema.sql

# Apply indexes
docker exec -i triova-health-postgres-1 psql -U postgres -d triova_health < services/shared/db/migrations/002_indexes.sql

# Apply functions and triggers
docker exec -i triova-health-postgres-1 psql -U postgres -d triova_health < services/shared/db/migrations/003_functions_triggers.sql
```

### 5. Seed Demo Data

```bash
npm run seed
```

### 6. Start Backend

```bash
npm run dev -w @triova/gateway
```

### 7. Start Frontend

```bash
npm run dev -w triova-frontend
```

### 8. Access the Application

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000
- **API Docs**: http://localhost:3000/api/docs

## Default Login Accounts

### Doctor Account
- **Email**: dr.sharma@triova.health
- **Password**: Doctor@123

### Patient Account
- **Email**: raj.kumar@example.com
- **Password**: Patient@123

## Project Structure

```
triova-health/
├── frontend/                    # React frontend
│   ├── src/
│   │   ├── api/                # API client
│   │   ├── components/         # Shared components
│   │   ├── pages/              # Page components
│   │   │   ├── patient/        # Patient pages
│   │   │   ├── doctor/         # Doctor pages
│   │   │   └── auth/           # Authentication
│   │   ├── store/              # Zustand stores
│   │   └── lib/                # Utilities
│   └── package.json
├── services/
│   ├── gateway/                # Express API server
│   │   └── src/
│   │       ├── auth/           # Authentication
│   │       ├── appointments/   # Appointment booking
│   │       ├── calendar/       # Google Calendar
│   │       ├── medications/    # Medication management
│   │       ├── medical-records/ # RAG & document processing
│   │       ├── triage/         # Patient triage
│   │       ├── analytics/      # Health analytics
│   │       └── workers/        # Background workers
│   └── shared/                 # Shared utilities
│       ├── db/                 # Database
│       ├── middleware/        # Express middleware
│       └── queues/             # BullMQ queues
├── docker-compose.yml
└── package.json
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register/patient` - Patient registration
- `POST /api/auth/register/doctor` - Doctor registration

### Appointments
- `GET /api/appointments/patient/:id` - Get patient appointments
- `POST /api/appointments` - Create appointment
- `GET /api/appointments/doctor/:id` - Get doctor appointments
- `PATCH /api/appointments/:id` - Update appointment

### Medical Records
- `POST /api/medical-records/upload` - Upload document
- `GET /api/medical-records/patient/:id` - Get patient documents
- `POST /api/medical-records/chat` - RAG chat with documents
- `POST /api/medical-records/extract-medications` - Extract meds from prescription

### Medications
- `GET /api/medications/patient/:id` - Get patient medications
- `POST /api/medications` - Add medication (doctor)
- `PATCH /api/medications/:id` - Update medication
- `DELETE /api/medications/:id` - Deactivate medication
- `PATCH /api/medications/reminder/:id` - Update reminder

### Analytics
- `GET /api/analytics/patient/:id/dashboard` - Patient dashboard data

## Using Groq API (Free Tier)

The platform uses Groq API for AI functionality. To set up:

1. Get a free API key from https://console.groq.com/
2. Add to `.env`:
   ```
   AI_PROVIDER=groq
   GROQ_API_KEY=your-key-here
   GROQ_MODEL=llama-3.3-70b-versatile
   ```

Groq offers free tier with generous limits - no credit card required.

## Troubleshooting

### Port Conflicts
If you get `EADDRINUSE` errors:
```bash
# Check what's using the port
netstat -ano | findstr ":3000"

# Kill the process or change PORT in .env
```

### Database Issues
If you see authentication errors:
```bash
# Reset database volume
docker compose down -v
docker compose up -d
```

### Frontend Not Connecting
Ensure the backend proxy in `frontend/vite.config.ts` matches your PORT setting.

## License

This project is for educational and demonstration purposes.

## Support

For issues or questions, please open an issue on GitHub.
