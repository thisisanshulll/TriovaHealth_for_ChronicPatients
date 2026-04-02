# TRIOVA Health Platform

Full-stack implementation aligned with `TRIOVA_MASTER.md` (see repository root).

## Quick start

1. Copy `.env.example` to `.env` and set `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, and AI credentials (`GROQ_API_KEY` preferred, or `OPENAI_API_KEY`).

2. Start infrastructure:

```bash
docker compose up -d
```

3. Apply DB schema (first-time Postgres volume; or run SQL manually):

- `services/shared/db/migrations/001_initial_schema.sql`
- `services/shared/db/migrations/002_indexes.sql`
- `services/shared/db/migrations/003_functions_triggers.sql`

4. Qdrant collection (optional for RAG):

```bash
npm run setup-qdrant
```

5. Seed demo users:

```bash
npm run seed
```

6. API + worker (gateway includes REST, Socket.io, BullMQ document worker, crons):

```bash
npm run dev -w @triova/gateway
```

7. Frontend:

```bash
npm run dev -w triova-frontend
```

- API: `http://localhost:3000` (`/health`, `/api/docs`)
- App: `http://localhost:5173`

If **`npx tsx scripts/setup-qdrant.ts`** failed with `undici` / `Cannot find module './lib/dispatcher/client'`, the project now uses **native `fetch`** for Qdrant (no JS SDK). Ensure Qdrant is running on `QDRANT_URL` (default `http://localhost:6333`).

If **`npm install` leaves broken packages** (missing `pdfkit.js` or `zod/.../parseUtil.js`, often on OneDrive folders), delete `node_modules` and run `npm install` again. The frontend pins **Vite 5** for a stable toolchain.

If the gateway exits with **`EADDRINUSE :::3000`**, another process is using port 3000 - stop it or set `PORT=3001` in `.env`.

## Troubleshooting

### `password authentication failed for user "postgres"`

This usually happens when the Postgres Docker volume was created with a different password in an earlier run. Changing `POSTGRES_PASSWORD` later does **not** update the password inside an existing volume.

Also check for host-port conflicts. If a local Postgres service is already using `5432`, point Docker Postgres to `5433` and use `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/triova_health` (this repo now defaults to that in `.env.example`).

Option A (keep the volume; reset the password to match `.env`):

```bash
docker compose exec -T postgres psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"
```

Option B (wipe the Postgres volume; you will lose local data):

```bash
docker compose down -v
docker compose up -d
```

### Frontend `Login failed` while API is running

If you changed `PORT` in the repo root `.env` (for example to `3001`), make sure the frontend dev proxy points to the same port. The proxy target is configured in `frontend/vite.config.ts` (it now auto-reads the root `.env`).

### Using Groq instead of OpenAI

Set these in `.env`:

```bash
AI_PROVIDER=groq
GROQ_API_KEY=your-groq-key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_WHISPER_MODEL=whisper-large-v3-turbo
```

`OPENAI_API_KEY` remains optional fallback. For RAG embeddings on Groq, set `GROQ_EMBEDDING_MODEL` if available; otherwise the app uses a local hash-based embedding fallback.

## Workspaces

- `services/shared` - DB pool, auth, middleware, Redis, BullMQ queue definitions
- `services/gateway` - all `/api/*` routes (modular monolith), workers, crons
- `frontend` - React 18 + Vite + Tailwind

## Default seed accounts

- Doctor: `dr.sharma@triova.health` / `Doctor@123`
- Patient: `raj.kumar@example.com` / `Patient@123`
