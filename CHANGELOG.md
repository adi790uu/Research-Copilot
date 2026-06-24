# Changelog

All notable changes to Research Copilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). New work accumulates
under **Unreleased** and moves into a dated, numbered release when cut.

## [Unreleased]

## [0.1.0] - 2026-06-25

First versioned release: the full two-runtime Research Copilot — an interactive
planning phase, a multi-agent research worker, an eight-section cited report,
and a grounded follow-up chat.

### Added
- **Auth** — email/password with server-issued HS256 JWTs.
- **Phase-1 workflow** — interactive `clarify → brief → plan`, streamed over SSE
  and checkpointed in Postgres so a reload restores in-flight state.
- **Plan-approval gate** — research only starts after the user approves the plan
  (`POST /briefs/{id}/plan/approve`).
- **Research worker** — a standalone TypeScript Trigger.dev project running the
  phase-2 LangGraph (supervisor + parallel researchers + two-pass report
  writer), writing progress and results to the shared Postgres.
- **Eight-section report** with grounded inline citations, plus PDF export.
- **Follow-up chat** grounded only in the finished report and its sources.
- **`messages.kind` discriminator** (`workflow` | `followup`) so the phase-1 and
  follow-up conversations share one table but are read separately. Migration
  `202606240100`.
- **Worker stage events** (`research_started`, `report_started` in
  `research_job_events`) for accurate, reload-safe status.
- **Shared run-status derivation** (`frontend/src/lib/runStatus.ts`) — one pure
  function feeding both the chat thinking-bubble and the artifact panel.
- **Per-angle research progress** in the artifact panel — a labeled "Research
  angles" timeline with live running/done/failed status per investigation.

### Changed
- **Two-runtime architecture.** Phase 2 (research) runs in a Trigger.dev worker
  instead of an in-process `asyncio` task; the FastAPI backend keeps phase 1,
  plan approval, follow-up chat, and all reads. Durability (retries, timeouts,
  run history) is managed by the platform.
- **`sessions` renamed to `briefs`** across API, tables, and UI
  (`session_messages` → `messages`). Migration `202606220100`.
- **Artifact panel** restructured into a clear status timeline
  (angles → sources → writing report → report ready).
- **Report-generation quality** — the compressor no longer emits a conversational
  preamble; the report writer is barred from process/corpus language ("compiled
  findings", "initial extraction", etc.); the review pass is fed real findings
  instead of the first 6k chars; factual sections that make claims but cite
  nothing are re-grounded once; and a degenerate "instruction-echo" polish is
  rejected in favor of the draft.
- **Documentation** (`docs/architecture.md`, `docs/engineering-decisions.md`,
  `docs/README.md`) rewritten for the two-runtime architecture; README moved
  under `docs/`.

### Fixed
- **Duplicate messages after a run completed.** The follow-up chat loaded the
  entire `messages` table and re-rendered the phase-1 intro and clarification at
  the bottom of the feed; it now loads only `followup` turns, which also stops
  phase-1 turns from polluting the follow-up LLM's history.
- **Report read like a research log** instead of a synthesized briefing — fixed
  by the report-generation changes above.
- **Checkpointer stale-connection failure** (`consuming input failed: SSL
  connection has been closed unexpectedly`). The LangGraph checkpointer ran on a
  single long-lived psycopg connection that broke every phase-1 run once the
  server dropped it; it now uses an `AsyncConnectionPool` with a liveness check
  and idle/lifetime recycling.

### Known issues
- The worker's `safeSearch` swallows Tavily errors, so a dead or
  quota-exhausted key yields a "successful" run with zero sources rather than a
  visible failure (e.g. Tavily `HTTP 432` plan-limit). Tracked in
  `docs/engineering-decisions.md`.
