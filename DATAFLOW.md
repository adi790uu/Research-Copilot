# Data Flow & Schema Map

How each component reads/writes the database, traced along the user flow.
Two DB clients hit the **same Postgres**:

- **Backend** (FastAPI + SQLAlchemy, `backend/app/persistence`) — auth, briefs, phase-1 chat, job creation, follow-up chat, reads for the UI.
- **Worker** (Trigger.dev + Drizzle, `worker/src/db`) — phase-2 research execution; writes job results/progress, reads the brief.

> ⚠️ **Copilot** (chat threads / edit proposals) is **not persisted** — it lives in `localStorage` (`frontend/src/lib/copilotStore.ts`). No table yet.

---

## 1. Entity map (who writes ✎ / reads 👁 each field)

```mermaid
erDiagram
    users              ||--o{ briefs                   : owns
    users              ||--o{ research_jobs            : owns
    briefs             ||--o{ messages                 : has
    briefs             ||--o{ research_jobs            : spawns
    research_jobs      ||--o{ research_job_events      : logs
    research_jobs      ||--o{ research_job_researchers : subtopics
    research_jobs      ||--o{ research_tasks           : progress
    hubspot_deal_syncs }o--o| briefs                   : "loose FK"
    hubspot_deal_syncs }o--o| research_jobs            : "loose FK"

    users {
        str  id PK
        str  email UK
        str  password_hash
        dt   last_seen_at
    }
    briefs {
        str  id PK
        str  user_id FK
        str  company_name
        str  website
        text objective
        str  title
        str  status "pending→running→awaiting_*→completed/failed"
        json clarification_question "{answered, questions[]}"
        str  contact_name
        str  contact_email
        json contact_resolution "PDL lookup result"
    }
    messages {
        str  id PK
        str  brief_id FK
        str  role "user|assistant"
        str  kind "workflow|followup"
        text content
    }
    research_jobs {
        str  id PK
        str  brief_id FK
        str  user_id FK
        str  status "pending→running→completed/failed"
        text research_plan "JSON of ResearchPlan"
        text final_report "JSON of ReportContent"
        json sources "Source[]"
        str  report_pdf_key "unused"
    }
    research_job_events {
        int  id PK
        str  job_id FK
        str  event_type
        json data
    }
    research_job_researchers {
        int  id PK
        str  job_id FK
        text topic
        text summary
        json sources "Source[]"
    }
    research_tasks {
        str  id PK
        str  job_id FK
        str  title
        text description
        str  status "running→completed/failed"
    }
    hubspot_deal_syncs {
        str  id PK
        str  deal_id UK
        str  brief_id "nullable"
        str  job_id "nullable"
        str  status "pending→researching→completed/failed"
        text error
    }
```

---

## 2. User flow → what touches the DB

Legend: **✎ write**, **👁 read**. Steps run top to bottom; DB effects are shown
_inside_ each node so the arrows stay clean.

```mermaid
flowchart TD
    A["<b>1. Sign up / Sign in</b><br/>SignInPage · auth.tsx<br/>✎ users"]
    B["<b>2. New Research modal</b><br/>NewResearchModal.tsx<br/>POST /briefs"]
    C["<b>3. BriefService.create</b><br/>+ resolve_contact (PDL)<br/>✎ briefs<br/>✎ briefs.contact_resolution"]
    D["<b>4. Phase-1 chat (SSE)</b><br/>POST /briefs/:id/chat<br/>✎ messages (workflow)<br/>✎ briefs.status<br/>✎ briefs.clarification_question"]
    E{"clarify<br/>needed?"}
    F["<b>5. Approve plan</b><br/>POST /briefs/:id/plan/approve<br/>✎ research_jobs (pending, plan)<br/>→ trigger worker"]
    G["<b>6. WORKER deep-research</b><br/>worker/src/trigger<br/>👁 briefs<br/>✎ research_jobs (running→completed)<br/>✎ events · researchers · tasks"]
    H["<b>7. Report + progress views</b><br/>poll /jobs/:id · /events<br/>/researchers · /tasks<br/>👁 research_jobs & children"]
    I["<b>8. Follow-up chat</b><br/>POST /briefs/:id/messages<br/>✎ messages (followup)<br/>👁 final_report as context"]
    PDF["<b>PDF export</b><br/>GET /jobs/:id/report.pdf<br/>👁 final_report + brief"]

    A --> B --> C --> D --> E
    E -->|"yes → awaiting_clarification"| D
    E -->|"no → awaiting_plan_approval"| F
    F --> G --> H
    H --> I
    I -->|"loops"| I
    H --> PDF

    subgraph CRM["HubSpot auto-sync (no user)"]
      Z["run_sync_cycle (periodic)<br/>✎ hubspot_deal_syncs"]
    end
    Z -.->|"same 3→5 path"| C

    subgraph COPILOT["Copilot chat (NOT in DB)"]
      Y["Copilot.tsx · copilotStore.ts"]
      Y2["conversations · messages<br/>edit proposals<br/>(localStorage only)"]
      Y --> Y2
    end

    classDef write fill:#1e3a2f,stroke:#3fb950,color:#e6edf3;
    classDef read fill:#1c2b3a,stroke:#58a6ff,color:#e6edf3;
    classDef gate fill:#3a2f1e,stroke:#d29922,color:#e6edf3;
    classDef ext fill:#2a2a33,stroke:#8b949e,color:#e6edf3;

    class A,B,C,D,F write;
    class G write;
    class H,PDF read;
    class I write;
    class E gate;
    class Z,Y,Y2 ext;
```

---

## 3. Per-surface field usage

### Auth — `users`
- **Write**: `auth_service` on signup (`email`, `password_hash`), `touch_last_seen` on each request.
- **Read**: `get_current_user` (JWT→id), `/me/activity` → `counts()` + `recent_briefs()`.

### Brief creation — `briefs`
- **Manual**: `NewResearchModal` → `POST /briefs` → `BriefService.create`.
- Core fields set at create: `company_name`, `website`, `objective`, `title`, `contact_name/email`.
- `contact_resolution` filled **async right after create** via `resolve_contact` (People Data Labs). Shape = `ContactResolution` (`status: resolved|unresolved|skipped`, `likelihood`, `linkedin_url`, …).
- **HubSpot intake** builds the same brief from deal→company→contact properties.

### Phase-1 chat — `messages` + `briefs`
- `POST /briefs/:id/chat` (SSE). `WorkflowService.run_phase1`:
  - ✎ `messages` (`role=user`, `kind=workflow`) for each turn.
  - ✎ `briefs.status`: `running` → `awaiting_clarification` | `awaiting_plan_approval` | `failed`.
  - ✎ `briefs.clarification_question` = `{answered, questions[]}`; `mark_clarification_answered` folds answers back in.
  - LangGraph state (plan, transient messages) lives in the **checkpointer**, not these tables.
- **Note**: assistant/workflow replies stream over SSE; only the *user* turn is persisted as a `workflow` message.

### Plan approval → job — `research_jobs`
- `POST /briefs/:id/plan/approve` → `job_store.create_job`: reads plan from graph checkpoint, ✎ `research_jobs` (`status=pending`, `research_plan`=JSON), triggers the worker.

### Worker execution (phase 2) — writes progress
`worker/src/db/jobs.ts` on the **same tables**:
| Fn | Writes |
|---|---|
| `getBrief` | 👁 `briefs` (company, website, objective, contact*) |
| `updateJobStatus` | ✎ `research_jobs.status` (`running`/`failed`) |
| `updateJobResult` | ✎ `research_jobs` → `completed`, `final_report`, `sources` |
| `appendJobEvent` | ✎ `research_job_events` (event_type, data) |
| `appendResearcherResult` | ✎ `research_job_researchers` (topic, summary, sources) |
| `createTask`/`completeTask`/`failTask` | ✎ `research_tasks` (title, description, status) |

### Report & progress views — read-only polling
- `Researches.tsx` → `GET /briefs` (list of `briefs`).
- Detail/progress → `GET /briefs/:id/job` then poll `/jobs/:id`, `/jobs/:id/events`, `/researchers`, `/tasks`.
- `final_report` = JSON-encoded `ReportContent` (`summary`, `sections[]{heading,content,source_ids}`, `sources[]`).
- PDF: `GET /jobs/:id/report.pdf` reads `job.final_report` + `brief.company_name/objective`. `report_pdf_key` column exists but is **unused** (rendered on the fly).

### Follow-up chat — `messages`
- `POST /briefs/:id/messages` → `report_chat.stream_followup`: ✎ `messages` (`kind=followup`), grounds the answer on `final_report`. Listed via `GET /briefs/:id/messages?kind=followup`.

### HubSpot sync — `hubspot_deal_syncs` (service-owned, no user scope)
- Dedup by unique `deal_id`. `status` walks `pending → researching → completed|failed`.
- `brief_id`/`job_id` link back once intake dispatches. Write-back pass posts the dashboard link as a deal Note on completion.

### Copilot — **no table (gap)**
- `copilotStore.ts` persists `CopilotConversation`, `CopilotMessage`, `EditProposal` to `localStorage`; replies are a stub. `selected_brief_ids` scopes which researches it would ground on / edit.
- To productionize: needs tables for conversations, messages, and proposals (proposals target a `brief`'s report section → implies report versioning).

---

## 4. Notes for planning features
- **Report is a single blob** (`research_jobs.final_report` JSON). Editing sections (Copilot proposals) currently has no versioning/section-addressable storage — the biggest schema gap.
- **One brief : many jobs** possible (list endpoint exists), but the UI treats the latest job as canonical (`get_job_by_brief` = most recent).
- **`report_pdf_key`** is a dead column (no object-store caching yet).
- **Backend and worker duplicate the schema** (`models.py` vs `schema.ts`) — any new column must be added in both + a new Alembic migration.
- **LangGraph checkpointer** holds phase-1 transient state (plan, messages) separately from these tables — the `research_plan` is only durably persisted when a job is created.
