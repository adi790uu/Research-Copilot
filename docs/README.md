# Research Copilot

An AI research copilot that prepares a structured briefing for a sales or business meeting. Give it a company name, website, and research objective; it runs an interactive planning phase, then a multi-agent research phase, and produces an eight-section report you can chat with.

> "Your sellers run the conversation. We do everything else."

## What it does

1. Create a research brief (company, website, objective).
2. A short interactive phase clarifies the objective, writes a brief, and proposes a research plan — streamed live over SSE.
3. You review and **approve** the plan. Approval kicks off the research worker.
4. A background worker fans out parallel researchers, gathers cited sources, and writes the report. The UI polls live progress (per-angle status, sources, stage) until it is done.
5. The finished report covers: company overview, products and services, target customers, business signals, risks and challenges, suggested discovery questions, suggested outreach strategy, and unknowns — plus the sources behind them.
6. Ask follow-up questions; the assistant answers grounded only in the report and its sources.

See [`architecture.md`](architecture.md) for how it works, [`engineering-decisions.md`](engineering-decisions.md) for the major decisions and tradeoffs, and [`product-improvements.md`](product-improvements.md) for the product direction.

## Stack

- **Frontend** — React 18 + TypeScript + Vite + Tailwind + TanStack Query + React Router
- **Backend** — Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) + structlog. Owns auth, the interactive **phase-1** LangGraph (clarify → brief → plan), plan approval, follow-up chat, and all job reads.
- **Research worker** — a standalone **TypeScript Trigger.dev** project running the **phase-2** LangGraph (supervisor + parallel researchers + two-pass report). Triggered by the backend on plan approval; writes progress and results to the shared Postgres.
- **AI** — OpenAI for reasoning and writing, Tavily for search. Called directly on both sides (no mock fallback — real keys required).
- **Persistence** — one Postgres database holding the app tables (SQLAlchemy + Alembic) and the phase-1 LangGraph `AsyncPostgresSaver` checkpointer.
- **Auth** — email and password, with server-issued HS256 JWTs.
- **Transport** — REST for reads and actions; SSE for phase-1 progress and follow-up chat; polling for phase-2 progress.

## Quickstart

Docker Compose brings up Postgres, the backend, and the frontend:

```bash
export OPENAI_API_KEY=...
export TAVILY_API_KEY=...

docker compose up
```

- Backend: http://localhost:8000 (interactive docs at `/docs`)
- Frontend: http://localhost:5173

Compose does **not** run the research worker. Phase 1 (clarify → brief → plan) works without it, but the research run only fires once the worker is running and the backend has a `TRIGGER_SECRET_KEY` — see the worker section below. Without that key the backend still creates the job row but skips the dispatch, so the run stays `pending`.

## Local development

Run the pieces yourself. Postgres still needs to be reachable; the compose file exposes it on 5432 if you only want the database from compose.

```bash
# Postgres only via compose
docker compose up postgres -d

# Backend
cd backend
uv sync
cp .env.example .env           # then fill in the values (see Configuration)
uv run alembic upgrade head    # apply the schema (Alembic owns all DDL)
uv run uvicorn app.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev

# Research worker (separate terminal) — required for phase 2
cd worker
npm install
cp .env.example .env           # DATABASE_URL must point at the SAME Postgres
npm run trigger:dev            # runs the Trigger.dev task locally
```

When the worker runs via `trigger:dev`, set the backend's `TRIGGER_SECRET_KEY` (and `TRIGGER_TASK_ID`, default `deep-research`) so plan approval can dispatch it.

## Configuration

### Backend (`backend/.env`, read by `app/core/config.py`)

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | empty | Required for phase-1 LLM output |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any OpenAI chat model |
| `OPENAI_BASE_URL` | empty | Point at an OpenAI-compatible endpoint; blank uses api.openai.com |
| `DATABASE_URL` | local Postgres URL | psycopg form; SQLAlchemy adds the asyncpg driver internally |
| `JWT_SECRET` | `dev-only-change-me` | Must be a real secret outside dev |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `LOG_LEVEL` | `INFO` | structlog level |
| `TRIGGER_API_URL` | `https://api.trigger.dev` | Trigger.dev API base |
| `TRIGGER_SECRET_KEY` | empty | Required to dispatch the worker; empty = job created but not run |
| `TRIGGER_TASK_ID` | `deep-research` | The worker task to trigger |

### Worker (`worker/.env`)

| Variable | Notes |
|---|---|
| `DATABASE_URL` | **Same** Postgres the backend uses (shared tables) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | LLM for the research graph |
| `TAVILY_API_KEY` | Required for web/company search |
| `TAVILY_SEARCH_DEPTH` | `basic` or `advanced` (default `advanced`) |
| `TRIGGER_PROJECT_REF` | From the Trigger.dev dashboard |

Research caps (max concurrent researchers, iteration ceilings) live in `worker/src/config.ts`. The frontend reads `VITE_API_BASE_URL` (set to `http://localhost:8000` in compose).

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness and version |
| `POST` | `/auth/sign-up`, `/auth/sign-in` | Register or log in; returns a JWT |
| `POST` | `/briefs` | Create a research brief |
| `GET` | `/briefs` | List briefs (paginated) |
| `GET` | `/briefs/{id}` | Brief detail |
| `POST` | `/briefs/{id}/chat` | Phase-1 workflow, streamed as SSE (`kind`: `start` \| `answer` \| `subscribe`) |
| `POST` | `/briefs/{id}/plan/approve` | Approve (and optionally edit) the plan; creates + triggers the phase-2 job |
| `GET` | `/briefs/{id}/job` | Latest research job for the brief |
| `GET` | `/jobs/{id}` | Job status and result |
| `GET` | `/jobs/{id}/events`, `/researchers`, `/tasks` | Live phase-2 progress for polling |
| `GET` | `/jobs/{id}/report.pdf` | Export the brief as a PDF |
| `GET` / `POST` | `/briefs/{id}/messages` | Follow-up chat over the finished report. `GET` takes `?kind=workflow\|followup`; `POST` streams tokens as SSE |

## Database migrations

Alembic owns all DDL for the application tables; the runtime never creates or alters them.

```bash
cd backend
uv run alembic upgrade head                                  # apply pending migrations
uv run alembic revision --autogenerate -m "describe change"  # after editing app/persistence/models.py
uv run alembic history                                       # inspect
```

For a clean slate, drop the app tables and re-run `upgrade head`:

```bash
psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS research_tasks, research_job_researchers, research_job_events, research_jobs, messages, briefs, users, alembic_version CASCADE;"
uv run alembic upgrade head
```

The phase-1 LangGraph `checkpoints*` tables are managed by `AsyncPostgresSaver.setup()` and live outside the Alembic-tracked schema. Do not drop them unless you also want to discard in-flight phase-1 runs.

## PDF export — native dependencies

The "Export PDF" action renders the brief with [WeasyPrint](https://weasyprint.org/), which wraps Pango, Cairo, HarfBuzz, and fontconfig via ctypes. Those must be present at runtime.

- **macOS**: `brew install pango cairo libffi`. The backend patches `ctypes.util.find_library` to look in `/opt/homebrew/lib` (or `/usr/local/lib` on Intel Macs), so no `DYLD_*` variable is needed.
- **Linux (Debian / Ubuntu)**: `apt-get install libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8 fontconfig fonts-dejavu`. Standard paths plus `ldconfig` handle the lookup.
- **Docker**: add the apt line above to the backend image.

If the native libraries cannot be loaded the rest of the app still boots; the PDF endpoint returns `503 pdf_renderer_unavailable` with a clear hint.

## Project layout

```
backend/    FastAPI app, phase-1 LangGraph, persistence, follow-up chat
worker/     TypeScript Trigger.dev worker — phase-2 research graph
frontend/   React app
docs/       README, architecture, engineering-decisions, product-improvements
```

## Tests

```bash
cd backend
uv run pytest
```
