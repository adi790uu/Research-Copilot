# Research Copilot

An AI Research Copilot that prepares a structured briefing for a sales or business meeting. Give it a company name, website, and research objective; it runs a LangGraph workflow to research the company and produces an eight-section report, then lets you chat with that report.

> "Your sellers run the conversation. We do everything else."

## What it does

1. Create a research session (company, website, objective).
2. A short interactive phase clarifies the objective, writes a brief, and proposes a research plan, streamed live over SSE.
3. A background phase fans out parallel researchers, gathers sources, and writes the report. The UI polls progress until it is done.
4. The finished report covers: company overview, products and services, target customers, business signals, risks and challenges, suggested discovery questions, suggested outreach strategy, unknowns, and sources.
5. Ask follow-up questions; the assistant answers grounded only in the report and its sources.

See [`docs/architecture.md`](docs/architecture.md) for how it works, [`docs/engineering-decisions.md`](docs/engineering-decisions.md) for the major decisions and tradeoffs, and [`docs/product-improvements.md`](docs/product-improvements.md) for the product direction.

## Stack

- **Frontend** — React 18 + TypeScript + Vite + Tailwind + TanStack Query + React Router
- **Backend** — Python 3.11 + FastAPI + SQLAlchemy 2.0 (async) + structlog
- **AI workflow** — LangGraph (multi-agent: supervisor plus parallel researchers), OpenAI for reasoning and writing, Tavily for search
- **Persistence** — one Postgres database holding both the app tables (SQLAlchemy + Alembic) and the LangGraph `AsyncPostgresSaver` checkpointer
- **Auth** — email and password, with server-issued HS256 JWTs
- **Transport** — REST for reads and actions; Server-Sent Events for workflow progress and follow-up chat

## Quickstart

The simplest path is Docker Compose, which brings up Postgres, the backend, and the frontend together:

```bash
# Optionally export real keys first; without them the app runs on mock
# providers (see "Running without API keys" below).
export OPENAI_API_KEY=...   # optional
export TAVILY_API_KEY=...   # optional

docker compose up
```

- Backend: http://localhost:8000 (interactive docs at `/docs`)
- Frontend: http://localhost:5173

## Local development

Run the pieces yourself. Postgres still needs to be reachable; the compose file exposes it on 5432 if you only want the database from compose.

```bash
# Postgres only via compose
docker compose up postgres -d

# Backend
cd backend
uv sync
cp .env.example .env          # then fill in the values (see Configuration)
uv run alembic upgrade head   # apply the schema (Alembic owns all DDL)
uv run uvicorn app.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Running without API keys

If `OPENAI_API_KEY` and `TAVILY_API_KEY` are not both set, the backend falls back to mock LLM and search providers that return believable canned data. The entire workflow runs end to end, which is useful for local development, demos, and CI without external accounts or spend. Set both keys to use the real providers.

## Configuration

Backend settings are read from the environment (see `backend/.env.example`). The most relevant:

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | empty | Required for real LLM output; empty falls back to the mock provider |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any OpenAI chat model |
| `OPENAI_BASE_URL` | empty | Point at an OpenAI-compatible endpoint; blank uses api.openai.com |
| `TAVILY_API_KEY` | empty | Required for real search; empty falls back to the mock provider |
| `DATABASE_URL` | local Postgres URL | psycopg form; SQLAlchemy adds the asyncpg driver internally |
| `JWT_SECRET` | `dev-only-change-me` | Must be set to a real secret outside dev |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `LOG_LEVEL` | `INFO` | structlog level |
| `WORKFLOW_MAX_CONCURRENT_RESEARCH_UNITS` | `5` | Max researchers dispatched per supervisor round |
| `WORKFLOW_MAX_RESEARCHER_ITERATIONS` | `4` | Supervisor loop ceiling |
| `WORKFLOW_MAX_REACT_TOOL_CALLS` | `8` | Per-researcher tool-call ceiling |
| `WORKFLOW_SEARCH_RESULTS_PER_QUERY` | `5` | Results requested per search query |

The frontend reads `VITE_API_BASE_URL` (set to `http://localhost:8000` in compose).

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness and version |
| `POST` | `/auth/sign-up`, `/auth/sign-in` | Register or log in; returns a JWT |
| `POST` | `/sessions` | Create a research session |
| `GET` | `/sessions` | List sessions (paginated) |
| `GET` | `/sessions/{id}` | Session detail |
| `POST` | `/sessions/{id}/chat` | Phase 1 workflow, streamed as SSE (`kind`: `start` \| `answer` \| `subscribe`) |
| `GET` | `/sessions/{id}/job` | Latest research job for the session |
| `GET` | `/jobs/{id}` | Job status and result |
| `GET` | `/jobs/{id}/events`, `/researchers`, `/tasks` | Live progress detail for polling |
| `GET` | `/jobs/{id}/report.pdf` | Export the brief as a PDF |
| `GET` / `POST` | `/sessions/{id}/messages` | Follow-up chat over the finished report (POST streams tokens as SSE) |

## Database migrations

Alembic owns all DDL for the application tables; the runtime never creates or alters tables.

```bash
cd backend
uv run alembic upgrade head                                  # apply pending migrations
uv run alembic revision --autogenerate -m "describe change"  # after editing app/persistence/models.py
uv run alembic history                                       # inspect
```

For a clean slate, drop the app tables and re-run `upgrade head`:

```bash
psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS research_tasks, research_job_researchers, research_job_events, research_jobs, session_messages, sessions, users, alembic_version CASCADE;"
uv run alembic upgrade head
```

The LangGraph `checkpoints*` tables are managed by `AsyncPostgresSaver.setup()` and live outside the Alembic-tracked schema. Do not drop them unless you also want to discard in-flight runs.

## PDF export — native dependencies

The "Export PDF" action renders the brief with [WeasyPrint](https://weasyprint.org/), which wraps Pango, Cairo, HarfBuzz, and fontconfig via ctypes. Those must be present at runtime.

- **macOS**: `brew install pango cairo libffi`. The backend patches `ctypes.util.find_library` to look in `/opt/homebrew/lib` (or `/usr/local/lib` on Intel Macs), so no `DYLD_*` variable is needed.
- **Linux (Debian / Ubuntu)**: `apt-get install libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8 fontconfig fonts-dejavu`. Standard paths plus `ldconfig` handle the lookup.
- **Docker**: add the apt line above to the backend image.

If the native libraries cannot be loaded the rest of the app still boots; the PDF endpoint returns `503 pdf_renderer_unavailable` with a clear hint.

## Project layout

```
backend/    FastAPI app, LangGraph workflow, persistence
frontend/   React app
docs/       architecture.md, engineering-decisions.md, product-improvements.md
```

## Tests

```bash
cd backend
uv run pytest
```
