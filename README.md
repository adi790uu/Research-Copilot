# Research Copilot

AI Research Copilot that prepares sales/business meeting briefings using a LangGraph workflow.

> "Your sellers run the conversation. We do everything else."

## Stack

- **Frontend** — React + TypeScript + Vite + Tailwind + TanStack Query
- **Backend** — Python 3.11 + FastAPI + SQLAlchemy 2.0 (async) + structlog
- **AI Workflow** — LangGraph (OpenAI for synthesis, Tavily for search)
- **Persistence** — Postgres for app tables and the LangGraph `AsyncPostgresSaver` checkpointer (single database)
- **Streaming** — Server-Sent Events from `/sessions/{id}/stream`

## Quickstart

The simplest path is Docker Compose — it brings up Postgres, the backend, and the frontend together:

```bash
docker compose up
```

Or run each piece locally (Postgres still needs to be reachable; the compose file's `postgres` service exposes 5432 if you only want the database from compose):

```bash
# Postgres only via compose
docker compose up postgres -d

# Backend
cd backend
uv sync
cp .env.example .env   # fill in OPENAI_API_KEY, TAVILY_API_KEY

# Apply database schema (Alembic owns DDL — startup no longer touches it)
uv run alembic upgrade head

uv run uvicorn app.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

- Backend: http://localhost:8000 (docs at `/docs`)
- Frontend: http://localhost:5173

## Project layout

```
backend/    FastAPI + LangGraph workflow + persistence
frontend/   React app
docs/       architecture.md, engineering-decisions.md, product-improvements.md
```

## Database migrations

Schema is managed exclusively by Alembic — the runtime never runs DDL.

```bash
cd backend

# Apply pending migrations
uv run alembic upgrade head

# Create a new migration after changing app/persistence/models.py
uv run alembic revision --autogenerate -m "describe the change"

# Inspect history / current revision
uv run alembic history
uv run alembic current
```

Need a clean slate (e.g. after upgrading from a pre-Alembic build)? Drop the
app tables and re-run `upgrade head`:

```bash
psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS messages, chats, reports, sessions, users, alembic_version CASCADE;"
uv run alembic upgrade head
```

LangGraph's `checkpoints*` tables are managed by `AsyncPostgresSaver.setup()`
and live outside the Alembic-tracked schema — don't drop them unless you also
want to wipe in-flight runs.

## PDF export — native dependencies

The "Export PDF" action renders the brief with [WeasyPrint](https://weasyprint.org/),
which wraps Pango / Cairo / HarfBuzz / fontconfig via ctypes. Those need to be
present at runtime.

- **macOS**: `brew install pango cairo libffi`. The backend automatically
  patches `ctypes.util.find_library` to look in `/opt/homebrew/lib` (or
  `/usr/local/lib` on Intel Macs), so no `DYLD_*` env var is needed.
- **Linux (Debian / Ubuntu)**: `apt-get install libpango-1.0-0 libpangoft2-1.0-0
  libharfbuzz0b libffi8 fontconfig fonts-dejavu`. Once installed in standard
  paths, `ldconfig` handles the lookup — no special config required.
- **Docker**: add the apt line above to the backend image. Example:
  ```dockerfile
  RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8 \
      fontconfig fonts-dejavu \
      && rm -rf /var/lib/apt/lists/*
  ```

If the native libs can't be loaded the rest of the app still boots; the PDF
endpoint just returns a `503 pdf_renderer_unavailable` with a clear hint.

## Status

Phase 0 — foundation scaffolding.
