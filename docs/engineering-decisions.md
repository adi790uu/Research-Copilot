# Engineering Decisions

This document records the engineering decisions that shaped the system the most, the alternatives weighed against each, and the tradeoffs accepted. It then lists the technical debt that exists today, the single biggest technical risk, and what two more weeks would buy.

## Decision 1: Split the run into a streamed phase and a worker-backed phase

A full research run takes minutes. The interactive part of the flow (clarify the objective, write a brief, propose a plan) is fast and benefits from live feedback. The research part (fan out, search, synthesize, write) is slow and benefits from running detached from the API process.

So the run is cut at a natural seam, and the heavy half is owned by a durable execution platform. Phase 1 (`clarify → brief → plan`) is a Python LangGraph driven inline and streamed to the browser over Server-Sent Events; it pauses at `interrupt_after=["create_research_plan"]` and the SSE stream closes with the plan. The user reviews and **approves** the plan. On approval the backend writes a `research_jobs` row and triggers a **Trigger.dev worker** that runs phase 2 to completion, writing progress and results straight to the shared Postgres. The browser switches to polling the job until it is `completed` or `failed`.

This shipped in stages: phase 2 began life as an in-process `asyncio` task resuming the same Python graph from its checkpoint, then moved to a standalone TypeScript worker on Trigger.dev. That move traded in-process fragility for managed durability — retries, timeouts, and run history — without standing up a broker or worker tier of our own.

**Alternatives considered**

| Option | Why not |
|---|---|
| One long-lived SSE or WebSocket for the whole run | A dropped connection loses the run, the server is tied to the socket for minutes, and reconnect/resume gets complicated |
| In-process `asyncio` background task (the previous design) | Zero infrastructure, but a crash or deploy strands the run and its job row stays `running` forever; no horizontal scale |
| A self-hosted task queue (Celery, RQ, Arq) | Real durability, but it adds a broker and a worker tier to operate |
| Temporal | The strongest durability story, but it means running a cluster (or paying for Cloud) and folding the graph into Activities — more weight than this stage needs |

**Tradeoffs accepted.** Trigger.dev gives managed durability and observability with no infrastructure to run, and the plan-approval seam is a clean trigger point. The costs are a **second language and runtime** (the research graph is reimplemented in TypeScript) and a **service boundary**: the backend and worker share only the database, so their data contracts (the report schema, the `--- SOURCE n ---` marker format, the table shapes) are kept in sync by hand. Phase 2 also runs **without a checkpointer**, so a retried run re-researches from scratch rather than resuming mid-flight.

## Decision 2: A multi-agent LangGraph, not a single agent or a linear chain

The research workflow is nested graphs with shared state. A supervisor subgraph dispatches research angles in parallel and decides when enough is enough, and a researcher subgraph (a small ReAct loop with search and reflection tools) is instantiated fresh per angle so parallel researchers never share state. The report is written in two passes: a structured draft of all eight sections, followed by a per-section review that tightens prose and re-checks citations. Phase 1 is a smaller conditional graph (`clarify → brief → plan`) where the clarify node can route back to the user.

**Alternatives considered**

| Option | Why not |
|---|---|
| A single ReAct agent with search tools | Simpler, but it serializes the work, has no natural place to bound breadth, and tends to lose the thread on a multi-part objective |
| A fixed linear pipeline (search, then summarize, then write) | Predictable and cheap, but it cannot adapt how much to dig per subtopic and has no conditional stop |
| Map-reduce with no supervisor | Parallel, but nothing decides coverage or when to stop, so it either under-researches or runs away |

**Tradeoffs accepted.** The supervisor pattern gives parallel breadth, a model-driven stop signal (`ResearchComplete`), and clear intermediate outputs (one row per angle, visible while the run is live). The cost is more LLM calls and real orchestration complexity, contained with hard caps: a maximum number of concurrent researchers per round, a researcher iteration ceiling, and a per-researcher tool-call limit. The complexity also makes this the hardest part of the system to test (see technical debt), and it now exists in two languages — the phase-1 graph in Python and the phase-2 graph in the worker — which is where the cross-language drift risk comes from.

## Decision 3: Two stores in one Postgres, with clear ownership

The phase-1 `AsyncPostgresSaver` checkpointer owns the running phase-1 graph (messages, intermediate state, pause point) in its own `checkpoints*` tables. The application owns the durable, user-facing data (users, briefs, the report, chat history, job progress) in normal SQLAlchemy tables under Alembic. Both live in the same Postgres database, but neither reaches into the other's tables. The phase-2 worker has no checkpointer at all — it writes application tables only.

**Alternatives considered**

| Option | Why not |
|---|---|
| One relational model, no checkpointer | We would lose LangGraph-native resume for the interactive phase and would have to hand-model evolving graph state as rows |
| Keep the durable products inside the checkpoint too | The checkpoint is opaque and shaped for graph execution, so listing a user's briefs or rendering a report becomes awkward and slow |
| Two separate databases | More to run and back up than this stage needs; one Postgres shared by the backend and the worker is enough |

**Tradeoffs accepted.** User-facing data gets clean queries, indexes, and migrations, while the interactive phase keeps native resumability. The cost is two mental models in one database, plus some duplication (a run's sources exist both as researcher rows and on the persisted job row). The ownership rule — each layer writes only its own tables, and job-lifecycle rows are written by the worker node that holds both the angle and its result — keeps that split from leaking. The recent `messages.kind` discriminator is the same idea applied within a table: the phase-1 and follow-up conversations share one table but are read strictly by kind.

## Top technical debt items

1. **Search failures are silent.** The worker's `safeSearch` catches every Tavily error and returns no results, so a dead or quota-exhausted key produces a "successful" run with zero sources and a hollow report instead of a visible failure. Auth/quota errors should be logged and escalated to a failed job. This is the highest-value fix and is the basis of the biggest risk below.
2. **Cross-language contract drift.** The phase-1 (Python) and phase-2 (TypeScript) graphs share the report schema, the eight section names, the `--- SOURCE n ---` marker format, and the table shapes — all kept in sync by hand. A change on one side that misses the other fails silently. There is no shared, generated contract.
3. **Phase-2 retries are not idempotent.** The worker run has no checkpointer, so a Trigger.dev retry re-researches from scratch, and partial `research_tasks` / `research_job_researchers` rows from a failed attempt can linger and double-count.
4. **Company-site extraction runs every call.** The supplemental map-and-extract in `company_site_search` has no "first call only" guard, so it runs on every researcher tool call, multiplying search-extract cost and latency.
5. **Thin coverage on the most complex code.** The backend tests cover health and briefs; the multi-agent worker (supervisor, researcher, report) has no automated tests, and there is no end-to-end test of a run. The riskiest code has the least coverage.
6. **Brittle source contract.** Sources are passed from tools to the compressor as formatted `--- SOURCE n ---` text parsed by regex, which couples two modules through a string format and drops the snippet.
7. **Stale environment example.** `backend/.env.example` still references Clerk keys and a `WORKFLOW_ALLOW_CLARIFICATION` flag, and omits the real `JWT_SECRET` and `TRIGGER_*` settings the app actually reads.

## Biggest technical risk

**Silent search failure undermines the one thing the product sells: a grounded, cited brief.** Because `safeSearch` swallows errors, the difference between "this company has little public footprint" and "our Tavily key is exhausted" is invisible — both end as a completed job with an empty, confident-looking report. A user could take a hollow brief into a meeting without any signal that the research never actually ran. The fix is small (log the error, and treat auth/quota/5xx as a hard job failure so the UI shows *failed*) but the trust cost of leaving it is large.

A secondary risk is the cross-language boundary: with the research graph reimplemented in TypeScript and the contract maintained by hand, a schema or source-format change can drift the two sides apart without a compile-time or test-time signal.

## What two more weeks would buy

The durable-execution work is done — phase 2 already runs on Trigger.dev. The next two weeks would harden correctness and the seams the move exposed:

- **Make failures honest.** Log Tavily errors and escalate auth/quota/5xx to a failed job; surface a clear failed state (and a retry) in the UI instead of a hollow report.
- **Lock the cross-language contract.** Generate the report schema and source format from one source of truth shared by the backend and worker, so drift is a build error rather than a silent mismatch.
- **Make phase-2 retries safe.** Give the worker run an idempotency key (the job ID) and clear or upsert partial rows on retry, so a Trigger.dev retry can't double-count angles.
- **Test the graph.** A deterministic end-to-end run (stubbed LLM + search) over the supervisor/researcher/report path, plus unit coverage on citation filtering and the `runStatus` derivation.
- **Refresh `.env.example`** to match the settings the app reads today.
