# Product & Business Thinking

*AI Research Copilot. Pre-meeting account briefings for sellers.*

## 1. Weaknesses in the current design

1. **It lives on its own island.** Briefings sit in a web app, away from where the rep actually works (the CRM, the inbox, the calendar). Sales tools that don't show up inside the daily workflow tend to lose the adoption fight. Reps already jump between about six systems and don't want a seventh tab. Right now there is no push to Salesforce or HubSpot, no prep triggered by a calendar event, and no "open in CRM."
2. **It is generic by design.** The workflow never learns what the seller actually sells, who their ideal customer is, or which persona they are targeting. The `objective` is free text, and the brief has no field for "our product" or "our pitch." So the *Discovery Questions* and *Outreach Strategy* come out generic. That is the exact trap that makes AI output look like the spray-and-pray outreach buyers now ignore. Personalized outreach gets roughly 45 to 55 percent open rates, while generic outreach sits around 20 to 25 percent.
3. **It is a one-time, web-only snapshot.** Research only uses web and company-site search. There are no structured signal sources (funding, news, filings, job postings, tech stack, leadership changes) and no monitoring. The report goes stale within weeks. Most of the value in sales intelligence is timing, and a one-shot report misses that completely.
4. **There is a trust gap on top of real citations.** Each section already carries source IDs and deduped sources, which is good. But there is no per-claim fact check, no confidence label, and no "as of" date. One wrong exec name or funding number in front of a buyer breaks the rep's credibility. Users tend to walk away from an AI product once they sense the error rate is past about 30 percent, even after the quality gets better.
5. **It doesn't scale to a real book of accounts.** It handles one company at a time, with manual entry, and a clarification step that blocks the run. A rep with 40 live accounts who keeps prep to 5 to 10 minutes won't paste each one in by hand. Low usage frequency is the clearest early sign of churn.
6. **There is no feedback or quality loop.** Nothing captures whether a briefing was right or useful (edits, thumbs up or down, "this part was wrong"). So quality can't be measured, improved, or shown to a buyer at renewal time.

## 2. Top 3 improvements to build next (prioritized)

| # | Improvement | Why it comes first |
|---|---|---|
| **P0** | **Trust layer.** A per-claim fact-check step, confidence labels, "as of" dates, and a clear *Unknown* instead of a guess, backed by an offline test set. | Nothing else matters if a rep can't trust the facts in front of a customer. It is the cheapest fix, the biggest driver of retention, and the base every other layer builds on. |
| **P1** | **Seller context plus CRM-native delivery.** Learn the seller's product, ICP, and persona once. Pull the account and objective from the CRM, and push the finished briefing back into it (and into the inbox). | This turns generic output into relevant output and removes the adoption tax of a standalone tool. It fixes weaknesses #1 and #2 directly. |
| **P2** | **More sources plus signal monitoring.** Add funding, news, filings, jobs, and tech-stack sources, and re-research an account when a trigger event happens. | This moves the product from "a tool I open" to "a tool that pings me at the right moment." That drives frequency and the timing value that justifies a higher price. |

## 3. Who buys, who uses, and why they pay

- **Users:** AEs, SDRs and BDRs, founders who sell, and CS or account managers prepping QBRs. They use it to walk in prepared, sound credible, ask sharper questions, and personalize outreach.
- **Economic buyer:** the VP of Sales, Head of Revenue, RevOps, or Sales Enablement. They own the seats and the budget. SMBs self-serve, while mid-market and enterprise buy through RevOps.
- **Why they pay:** reps spend about 6 hours a week (roughly 2 hours per prospect) on research, yet 82 percent of buyers say reps show up unprepared. Giving those hours back is the easy ROI. The lasting value is higher win rates and shorter sales cycles from better-targeted, better-prepared conversations. The price has room to grow, since teams already pay ZoomInfo $5k+ per seat and Clay $720+ per month.

## 4. Success metrics

- **North star:** *used* briefings per active seat per week. That means opened in the CRM, or fed into an email or call within 24 hours. Usage that touches a real deal, not just generations that sit unread.
- **Activation:** time to the first useful briefing.
- **Quality:** percent of claims with a citation, factual accuracy inferred from user edits and flags, and the hallucination or correction rate.
- **Outcome (what drives renewal):** research time saved per rep, meeting-prep coverage (percent of meetings that had a briefing), reply and meeting-booked rates on briefing-informed outreach, and win rate and cycle length on deals that a briefing touched.
- **Efficiency:** cost per briefing, p95 latency, and cross-session cache-hit rate.
- **Business:** seat expansion, NRR, and logo retention.

## 5. Four-week AI roadmap

- **Week 1: Trust and cost.** Per-claim citations, confidence and "as of" dates, and a clear *Unknown*. A golden test set plus an LLM-as-judge fact-check score used as a regression gate. Prompt caching and model routing to keep the unit economics healthy.
- **Week 2: Depth.** More research sources (news, funding, filings, jobs, tech stack, and exec or stakeholder mapping). Source-reliability weighting and a step that reconciles facts that conflict.
- **Week 3: Relevance.** Bring in the seller context (product, ICP, persona). Make the discovery questions and outreach persona-aware. Pull account context from the CRM.
- **Week 4: Stickiness.** Signal-triggered monitoring that re-researches on its own, plus a feedback loop (thumbs and edits) that feeds the test set and a quality dashboard.

## 6. Biggest cost, scaling, and reliability risks

- **Cost:** agentic, multi-step research with web fetches is heavy on tokens and API calls per run. Uncontrolled re-runs and long context can wreck the margins. *How to handle it:* a cross-session account cache (two reps on one account means one research run), prompt caching (about 90 percent off for repeated context), model routing (a cheap model to extract, a strong one to synthesize, which can save 60 to 90 percent), and a cap on how many researchers fan out.
- **Scaling:** outside data sources rate-limit, break, and carry terms-of-service and legal risk (LinkedIn especially). Long synchronous workflows tie up workers. *How to handle it:* an async job queue with checkpointing (already in place), a provider-abstraction layer with fallbacks, and per-tenant rate limiting.
- **Reliability:** made-up facts on trust-critical fields, stale data, and partial node failures. *How to handle it:* the fact-check node plus confidence gating, graceful degradation (ship a partial report and name the sections that failed), checkpointed retries so a run can recover, and tracing on every node.
- **Durable execution:** today the deep-research phase runs as an in-process async task backed by the LangGraph checkpoint, so a process crash, deploy, or restart can orphan a run that is still in flight, even though its state survives. *How to handle it:* move the research orchestration onto a durable workflow engine like Temporal. We would get retries, recovery across restarts and deploys, per-step timeouts, and a clear history of every run for free, instead of hand-rolling that machinery on top of asyncio. The two-phase design and the checkpointer already point this way, so it is an evolution of the current model rather than a rewrite.

## 7. Feature I would remove

**The clarification step that blocks the run.** Stopping to ask the user questions before any research starts adds friction and waiting time. That fights the core job, which is a prepared briefing, fast, across many accounts. I would replace it with non-blocking clarification: start right away on sensible defaults, then show "I assumed X. Want to refine?" so the rep is never stopped at the door. (PDF export is the next thing I'd cut, in favor of a shareable link or a CRM push.)

## 8. Feature I would add

**CRM-native delivery with one-click action.** Auto-generate a briefing when a meeting gets booked, push it into the Salesforce or HubSpot record, and let the rep turn an insight into a drafted, grounded outreach email in one click. This closes the loop from research, to relevance, to revenue, inside the tools reps already use all day. It is the single highest-leverage new feature for both adoption and measurable impact. Signal-triggered monitoring is the natural next step.

## 9. First 90-day roadmap

- **Days 0 to 30: Trust and foundation.** Grounding, citations, confidence, the test set, cost controls (caching and routing), observability, and hardened workflows that can recover. *Goal:* a briefing a rep can put their name behind.
- **Days 31 to 60: Relevance and reach.** More sources, seller-context personalization, stakeholder mapping, and bulk or list research. *Goal:* tailored, deep, and scaled to a full book of accounts.
- **Days 61 to 90: Workflow and stickiness.** CRM push and pull, one-click outreach, signal monitoring, and the feedback loop plus quality dashboard. Roll out with design partners and land the first paid seats. *Goal:* part of the daily workflow, with proof of time saved and a win-rate lift.

## 10. If I owned this product, what I'd change first

**Trust, before anything else.** The only real moat this product has is a briefing reps believe. One made-up fact in front of a customer and they stop using it, then tell the rest of the team it can't be trusted. It is also the cheapest change to make, and it is the base layer that personalization and signals both depend on. So week one: per-claim citations, confidence, "as of" dates, a clear *Unknown*, and a test set that blocks regressions. Win trust first, then earn the right to scale relevance and reach.
