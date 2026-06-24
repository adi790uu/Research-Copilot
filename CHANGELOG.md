# Changelog

All notable changes to Research Copilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is
pre-1.0 and not yet versioned, so changes accumulate under **Unreleased**.

## [Unreleased]

### Added
- **`messages.kind` discriminator** (`workflow` | `followup`) separating the
  phase-1 conversation (intro + clarification answers) from the post-report
  follow-up chat. Each surface now reads only its own turns. Migration
  `202606240100` adds the column and backfills existing rows.
- **Worker stage events.** The research worker writes `research_started` and
  `report_started` to `research_job_events`, giving the UI an accurate,
  reload-safe "researching → writing the report" signal.
- **Shared run-status derivation** (`frontend/src/lib/runStatus.ts`): one pure
  function turns polled job/tasks/researchers/events into a single status the
  chat bubble and the artifact panel both render, identical live or after a
  reload.
- **Per-angle research progress** in the artifact panel: a clearly labeled
  "Research angles" timeline with live status per investigation (running /
  done / failed), each expandable to its summary and sources.

### Changed
- **Phase 2 moved to a Trigger.dev worker.** The research graph (supervisor +
  parallel researchers + two-pass report) is now a standalone TypeScript
  Trigger.dev project that reads the brief from Postgres and writes progress
  and results back, replacing the previous in-process `asyncio` background
  task. Durability (retries, timeouts, run history) is now managed by the
  platform.
- **Plan approval is a human gate.** The interactive phase pauses with the plan
  and waits for explicit approval (`POST /briefs/{id}/plan/approve`) before the
  research worker is triggered, instead of auto-spawning phase 2.
- **`sessions` renamed to `briefs`** across the API, tables, and UI
  (`session_messages` → `messages`). Migration `202606220100`.
- The artifact panel was restructured into a clearer status timeline
  (angles → sources → writing report → report ready).
- Documentation (`docs/architecture.md`, `docs/engineering-decisions.md`,
  `docs/README.md`) rewritten to reflect the two-runtime architecture.

### Fixed
- **Duplicate messages after a run completed.** The follow-up chat loaded the
  entire `messages` table and re-rendered the phase-1 intro and clarification
  at the bottom of the feed; it now loads only `followup` turns. The same fix
  stops phase-1 turns from polluting the follow-up LLM's history.

### Known issues
- The worker's `safeSearch` swallows Tavily errors, so a dead or
  quota-exhausted key yields a "successful" run with zero sources rather than a
  visible failure (e.g. Tavily `HTTP 432` plan-limit). Tracked in
  `docs/engineering-decisions.md`.

## Earlier milestones

These predate the changelog and are summarized from the project history.

### Documentation & layout
- Added architecture, engineering-decisions, and product-improvements docs;
  moved the README under `docs/`.

### Research architecture
- Reworked the research workflow into a multi-agent LangGraph (supervisor with
  parallel researcher subgraphs and a two-pass report writer), added Alembic
  for migrations, introduced an (since-removed) OpenAI key rotator, and revised
  the UI flow.

### Initial version
- First end-to-end version: email/password auth with HS256 JWTs, the
  interactive phase-1 workflow streamed over SSE, the research phase, the
  eight-section report with grounded citations, follow-up chat, and PDF export.
