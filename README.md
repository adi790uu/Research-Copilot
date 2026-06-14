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

## Status

Phase 0 — foundation scaffolding.
