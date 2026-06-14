# Research Copilot

AI Research Copilot that prepares sales/business meeting briefings using a LangGraph workflow.

> "Your sellers run the conversation. We do everything else."

## Stack

- **Frontend** — React + TypeScript + Vite + Tailwind + TanStack Query
- **Backend** — Python 3.11 + FastAPI + SQLAlchemy + structlog
- **AI Workflow** — LangGraph (OpenAI for synthesis, Tavily for search)
- **Persistence** — SQLite for dev (Postgres-swap-ready), LangGraph `SqliteSaver` for checkpoints
- **Streaming** — Server-Sent Events from `/sessions/{id}/stream`

## Quickstart

```bash
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

Or run both via Docker:

```bash
docker compose up
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
