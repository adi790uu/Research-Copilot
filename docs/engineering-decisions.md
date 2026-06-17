# Engineering Decisions

This document records the three engineering decisions that shaped the system the most, the alternatives weighed against each, and the tradeoffs accepted. It then lists the technical debt that exists today, the single biggest technical risk, and what two more weeks would buy.

## Decision 1: Split the run into a streamed phase and a background phase

A full research run takes minutes. The interactive part of the flow (clarify the objective, write a brief, propose a plan) is fast and benefits from live feedback. The research part (fan out, search, synthesize, write) is slow and benefits from running detached.

So the run is cut at a natural seam. Phase 1 (`clarify → brief → plan`) is driven inline and streamed to the browser over Server-Sent Events. The graph pauses at `interrupt_after=["create_research_plan"]`, the service writes a job row and spawns an in-process `asyncio` task that resumes the graph from its checkpoint, and the browser switches to polling the job until it is `completed` or `failed`. The LangGraph checkpointer makes the resume possible: the run's state survives the boundary, keyed by the session ID.

**Alternatives considered**

| Option | Why not |
|---|---|
| One long-lived SSE or WebSocket for the whole run | A dropped connection loses the run, the server is tied to the socket for minutes, and reconnect/resume gets complicated |
| A dedicated task queue and worker (Celery, RQ, Arq) from day one | Real durability, but it adds a broker, a worker tier, and serialization work for a three-day build where the value is the workflow itself |
| A synchronous request that blocks until the report is done | Long requests, timeouts, no progress visibility, no recovery |

**Tradeoffs accepted.** The in-process task plus checkpoint gives state recovery and progress visibility with zero extra infrastructure, which is the right call for the current stage. The cost is durability and horizontal scale: a background task lives and dies with the process, and the set of in-flight jobs is tracked in memory, so a crash or deploy strands a run. The two-phase shape is deliberately the one a durable workflow engine slots into later (see "Biggest technical risk" and "Two more weeks").

## Decision 2: A multi-agent LangGraph, not a single agent or a linear chain

The workflow is three nested graphs. A top graph (`clarify → brief → plan → supervisor → final report`), a supervisor subgraph that dispatches research tasks in parallel and decides when enough is enough, and a researcher subgraph (a small ReAct loop with search and reflection tools) that is instantiated fresh per task so parallel researchers never share state. The report is then written in two passes: a structured draft of all eight sections, followed by a per-section review that tightens prose and re-checks citations.

**Alternatives considered**

| Option | Why not |
|---|---|
| A single ReAct agent with search tools | Simpler, but it serializes the work, has no natural place to bound breadth, and tends to lose the thread on a multi-part objective |
| A fixed linear pipeline (search, then summarize, then write) | Predictable and cheap, but it cannot adapt how much to dig per subtopic and has no conditional stop |
| Map-reduce with no supervisor | Parallel, but nothing decides coverage or when to stop, so it either under-researches or runs away |

**Tradeoffs accepted.** The supervisor pattern gives parallel breadth, a model-driven stop signal (`ResearchComplete`), and clear intermediate outputs, and it maps directly onto what the workflow needs (multiple meaningful nodes, shared state, conditional routing, recoverability). The cost is more LLM calls and real orchestration complexity, which is contained with hard caps: a maximum number of concurrent researchers per round, a researcher iteration ceiling, and a per-researcher tool-call limit. The complexity also makes this the hardest part of the system to test (see technical debt).

A smaller related choice lives under this decision: the model and search vendors sit behind small provider interfaces, with mock providers that let the whole workflow run end to end with no API keys. That keeps local development and CI cheap and makes a vendor swap a provider change rather than a workflow rewrite. (There is also an optional API-key rotation layer in the model wrapper. It was an experiment to stay within GitHub Models' free-tier rate limits when fanning out many concurrent calls, not the intended production path, which is a single proper key. It is mentioned again under technical debt.)

## Decision 3: Two stores in one Postgres, with clear ownership

The LangGraph `AsyncPostgresSaver` checkpointer owns the running graph: messages, intermediate state, and pause points, in its own `checkpoints*` tables. The application owns the durable, user-facing data (users, sessions, the report, chat history, job status) in normal SQLAlchemy tables under Alembic. Both live in the same Postgres database, but neither reaches into the other's tables.

**Alternatives considered**

| Option | Why not |
|---|---|
| One relational model, no checkpointer | We would lose LangGraph-native resume and would have to hand-model evolving graph state as rows |
| Keep the durable products inside the checkpoint too | The checkpoint is opaque and shaped for graph execution, so listing a user's sessions or rendering a report becomes awkward and slow |
| Two separate databases | More to run and back up than this stage needs; one Postgres is enough |

**Tradeoffs accepted.** User-facing data gets clean queries, indexes, and migrations, while the graph keeps native resumability. The cost is two mental models and two connection pools in one database (psycopg for the saver, asyncpg for SQLAlchemy), plus some duplication: a run's sources exist both in checkpoint state and on the persisted job row. The ownership rule (each layer writes only its own tables, and job-lifecycle rows are written by the node that holds both the task and its result) keeps that split from leaking.

## Top technical debt items

1. **In-process background jobs are not durable.** A crash or deploy strands an in-flight run, and its job row stays `running` forever because the only timeout lives inside the task that just died. This is the most important item and is covered as the biggest risk below.
2. **Hand-rolled model wrapper.** `_RotatingModel` re-implements a slice of the LangChain Runnable API (recording and replaying `bind_tools` / `with_structured_output`, dropping `with_retry`, proxying only a few methods, and not rotating mid-stream) to support the optional key pool. It works, but it is brittle against LangChain changes and exists mainly for the GitHub Models free-tier experiment. With a single normal key it can be removed in favor of a plain `ChatOpenAI`.
3. **Company-site extraction runs every call.** The supplemental map-and-extract in `company_site_search` is guarded by a `_company_site_mapped` flag that is never set, so the "first call only" dump actually runs on every call, multiplying search-extract cost and latency.
4. **Thin coverage on the most complex code.** The test suite covers health, sessions, key rotation, and the search tools, but the supervisor, researcher, and final-report nodes have no direct unit or integration tests, and the integration test directory is empty. The riskiest code has the least coverage.
5. **Dead but retained code.** `approve_plan` and `save_plan_edits` in the workflow service are no longer wired to any route since phase 2 became auto-spawned. They should be removed or re-wired.
6. **One job per session, and a brittle source contract.** Re-running research on a session is not modeled (the lookup returns a single job), and sources are passed from tools to the extractor as formatted `--- SOURCE n ---` text parsed by regex, which drops the snippet and couples two modules through a string format.
7. **Stale README.** It references a `/stream` route (the real one is `/chat`) and still says "Phase 0 — foundation scaffolding."

## Biggest technical risk

**The deep-research phase is coupled to a single process and is not durable.** Phase 2 runs as an `asyncio` task tracked in an in-memory dict, with recovery resting entirely on the LangGraph checkpoint. Two failure modes follow. First, a restart or deploy during a run leaves the work abandoned while the job row still reads `running`, with nothing to resume it. Second, the design cannot scale horizontally as-is: a second backend process would not know about the first's in-flight jobs, and the in-memory job map and rotator singleton are per-process state. The checkpoint means the state is safe; what is missing is something durable that owns the lifecycle of a run and will re-drive it.

(For completeness: the optional GitHub Models key-rotation path carries its own rate-limit and availability risk, but it is an experiment rather than the production path, so it is not the primary risk.)

## What two more weeks would buy: durable execution

The fix for the biggest risk is to keep LangGraph as the in-run state machine but hand the *lifecycle of a run* (enqueue, retry, timeout, recover, observe) to a durable execution layer. The checkpoint already makes a run idempotently resumable, so this is an evolution of the two-phase design, not a rewrite. Two routes were considered.

**Option A — Temporal (Python SDK).** The research run becomes a Temporal Workflow and each phase or node an Activity with its own retry policy. It survives process restarts and deploys natively, supports long timers and signals, and stays in one language with the existing backend. The cost is operational weight: running a Temporal cluster or paying for Temporal Cloud, plus a learning curve. This is the right destination if research orchestration becomes the core engine and needs fine-grained, per-step durability.

**Option B — a minimal TypeScript service on Trigger.dev.** A small Trigger.dev task is triggered when the plan is ready and owns the run's lifecycle: it calls a "resume job from checkpoint" endpoint on the Python service and gets retries, timeouts, and run history from a managed platform with no infrastructure to operate. The cost is a second language and a service boundary (a network hop, and the Python run must stay idempotently resumable, which the checkpoint already provides). This buys managed durability fastest, with the least new infrastructure.

**Recommendation.** Start with Option B. The two-phase boundary is already the right insertion point, so wrapping the existing Python run in a Trigger.dev task gets durable, observable, retry-backed execution quickly without standing up new infrastructure or rewriting the graph. Move to Temporal later only if durable orchestration becomes central enough to justify owning the cluster and folding the workflow into Temporal Activities for per-node guarantees.

Beyond durability, the same two weeks would close the highest-value debt: real test coverage on the multi-agent graph (including a deterministic run against the mock providers), fixing the company-site extraction flag, removing the dead plan-approval code and the key-rotation wrapper, and refreshing the README.
