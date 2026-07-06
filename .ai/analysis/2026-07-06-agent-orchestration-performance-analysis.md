# Agent Orchestrator — Performance & Scalability Analysis

**Date:** 2026-07-06
**Scope:** `.ai/specs/enterprise/agent-orchestrator/` corpus + the shipped code in
`packages/enterprise/src/modules/agent_orchestrator/`, `packages/core/src/modules/workflows/`,
`packages/queue/`, `packages/events/`, and the OpenCode container delivery (`docker/opencode/`).
**Load target:** 1,000 cases/day, ~12 agent runs per case ⇒ **~12,000 agent runs/day**.

---

## 1. Load model — what 1,000 cases/day actually means

Assume 80% of traffic lands in a 10-hour business window and each agent run takes
30 s – 5 min of LLM latency (multi-step OpenCode runs were measured at >30 s in
`REAL-CONTAINER-FINDINGS.md` §2; the runner's deadline is 5 min).

| Metric | Value |
|---|---|
| Agent runs/day | ~12,000 |
| Peak arrival rate | ~1,200 runs/h ≈ **0.3–0.5 runs/s**, bursts 2–3× higher |
| Concurrent active runs (Little's law: 0.33 runs/s × ~60 s avg) | **~20 steady, 50–100 at peak** |
| LLM calls/day (5–20 steps per run) | 60k–240k |
| DB writes/day from run lifecycle (~15–25 stmts/run incl. events + audit) | ~200k–300k — trivial for Postgres |
| Row growth/year | `agent_runs` ~4.4M; `agent_spans`+`agent_tool_calls` ~50–90M; `workflow_events` ~15–35M |

**Headline:** the raw data volume is modest; Postgres write throughput is *not* the
problem. The system fails at this load for two reasons: **(a) execution concurrency
is configured/architected around 1–5 slots that each block for full LLM latency**,
and **(b) append-only tables and live-computed reads have no rollups, indexes,
partitioning, or retention**, so read latency and storage degrade over months.

---

## 2. Bottleneck inventory (ranked by severity at target load)

### B1 — Worker throughput: INVOKE_AGENT holds a queue slot for the whole LLM run (CRITICAL)

- The workflows engine parks the instance and enqueues an `invoke_agent` job on the
  shared **`workflow-activities`** queue (`activity-executor.ts:931,1021-1043`). The
  worker then `await`s `agentRuntime.run()` **for the full LLM duration**
  (`activity-worker-handler.ts:255`, `invokeAgentForWorkflow.ts:71`).
- Default worker concurrency is **1** (`workflow-activities.worker.ts:34-41`,
  `worker/runner.ts:111`). Capacity math: 12,000 runs × ~60 s = **720k worker-seconds/day
  ≈ 8.3 slots busy 24/7, or ~20 slots across business hours**. Concurrency 1 caps you
  at ~1,400 one-minute runs/day — an order of magnitude short.
- The default queue backend is **`local` — file-based JSON, sequential, single-process,
  1 s poll** (`packages/queue/src/strategies/local.ts:34,60,310`; `factory.ts:62`).
  Production must run `QUEUE_STRATEGY=async` (BullMQ/Redis).
- Agent jobs share the queue with fast activities (timers, waits) — long LLM jobs
  starve them.
- The CLI worker connection-budget clamp (`worker-connection-budget.ts`,
  budget = `DB_POOL_MAX`, default 20) can **silently reduce** configured concurrency.
- **No timeout on the in-process agent path** (`agentRuntime.ts` has none; only the
  OpenCode path has the 5-min `OM_OPENCODE_RUN_TIMEOUT_MS` deadline). One hung
  provider call permanently eats a slot.

### B2 — Single OpenCode container, no pool, no admission control (CRITICAL for the file-agent path)

- One `opencode` service in compose, no replicas; one singleton client with one
  `OPENCODE_URL` (`docker-compose.yml:2-37`, `ai_assistant/di.ts:12`,
  `opencode-client.ts:511-515`). All concurrent file-agent runs hit one container that
  itself runs full agent loops (LLM calls, task sub-agents). 20–50 concurrent
  multi-step sessions on one container is unrealistic.
- **No semaphore/queue anywhere in the runner** — N runs open N sessions + N
  synchronous `POST /session/:id/message` requests with a 5-min timeout each
  (`openCodeAgentRunner.ts:136,342-344`).
- **SSE firehose:** each run opens its own SSE connection to the global `/event`
  endpoint and filters client-side (`openCodeAgentRunner.ts:405-437`,
  `opencode-client.ts:140-224`). N concurrent runs decode ~N× each other's events —
  O(N²) event-processing volume on one server. No SSE reconnect; a dropped stream
  rides the 5-min deadline to failure.
- Config gap: `docker-compose.fullapp.yml` never sets `OPENCODE_URL` for the app
  container, so it defaults to `http://localhost:4096` and can't reach the sibling
  container.

### B3 — No backpressure at any entry point (HIGH)

- `agentRuntime.run` is **unbounded promise concurrency** for direct callers
  (playground, `delegate_agent` fan-out, future Agentic Tasks worker).
- Workflow starts are `setImmediate` fire-and-forget **in the web process**
  (`api/instances/route.ts:260`): a burst of 1,000 starts spawns 1,000 concurrent
  executor loops, each checking out a DB connection (pool default 20) and holding a
  `SELECT … FOR UPDATE` on its instance row.
- Agentic Tasks adds event triggers + schedules + bulk launches; a broad
  `event_pattern` can trigger-storm the same unbounded pipeline (the spec's only
  brakes are per-trigger `debounceMs`/`maxConcurrentInstances`).
- No per-provider LLM rate-limit budget exists anywhere; at 60k–240k LLM calls/day
  provider RPM/TPM limits will be the *actual* ceiling, currently expressed as
  unmanaged 429 failures (which fail-stop the workflow step — no retry:
  `activity-worker-handler.ts:306-316`).

### B4 — Cockpit read side: sampled KPIs, refetch storms, missing indexes (HIGH)

- **All KPI tiles are computed client-side from `pageSize=100` list calls** with
  default sort by `id` (UUID) — i.e. a biased random 100-row sample of an all-time
  table (`backend/overview/page.tsx:93-182`, `factory.ts:79-82,1402`). The caseload
  page paginates **client-side over the same capped 100 rows** — the operator can
  literally never see proposal #101. At 12k runs/day this is wrong within the first
  hour of the day. (`F2` metric rollups are designed but unbuilt; the code carries the
  TODO.)
- **Refetch storm:** `proposal.created/disposed/ready` are `clientBroadcast: true`;
  every event makes every connected operator's browser re-issue 3 uncached
  `count(*)`+scan list queries (`overview/page.tsx:130-132`,
  `caseload/page.tsx:291-293`). 50 operators × ~5k proposal lifecycle events/day
  ⇒ ~750k list queries/day from live-refresh alone.
- **Missing composite indexes** for the hottest operator queries:
  - `agent_proposals`: no index on `disposition`; no `(organization_id, disposition, created_at)` — the "pending, oldest first" queue query.
  - `agent_runs`: no index on `status`, `eval_passed`, `confidence`, or `(organization_id, created_at)`.
  - `workflow_events`: resume path COUNT/FINDs per instance (`workflow-executor.ts:896-950`).
- `GET /runs/:id` trace detail loads **all** spans/tool-calls/eval-results with no
  LIMIT + per-row decryption.

### B5 — Unbounded table growth, no retention/partitioning/offload (HIGH over months, not day 1)

- `agent_spans` + `agent_tool_calls` (~50–90M rows/yr), `agent_runs`/`agent_proposals`,
  `workflow_events`, plus 4 persistent event-outbox rows and ~4 audit rows per
  principalled run — **all append-only, none pruned**. gap-19 (partitioning + tiered
  retention + S3 archival) and F1 (S3 artifact offload; the `*_artifact_key` columns
  exist but are dead) and F3 are designed but ⬜ unbuilt.
- Every list read is a live `count(*)` over these growing tables (no query_index
  materialization — the CRUD `indexer:` config is inert because the routes are
  GET-only and the commands emit `run.created`, not the `agent_run.created` id the
  reindex subscriber binds to).

### B6 — Per-run and per-step write fragmentation (MEDIUM)

- One actionable in-process run + auto-approve ≈ **6–8 statements across ~7 separate
  EM forks/transactions** (createRun, context bundle, input guardrails, output
  guardrails, completeRun, createProposal, dispose) + 4 persistent events + ~4 audit
  rows. No cross-step batching.
- OpenCode adds per run: 1 session-token **bcrypt** insert into `api_keys`, a role
  lookup with decryption, an `agent_run_sessions` insert, then **750 ms polling** of
  that row for the entire run (~80 point reads per 1-min run; ~130 reads/s at 100
  concurrent — tolerable but pure waste), and 2 deletes on completion.
- Workflow engine: `WorkflowInstance.context` is a **full jsonb column rewrite on
  every step** and it accumulates all 12 agents' outputs — write volume per case is
  O(steps × context size), i.e. quadratic-ish in context growth. Each async activity
  round-trip ≈ 4–5 event-log writes + 1–2 context rewrites ⇒ **~60–120 writes per
  case** in `workflow_events` + instance updates.
- Trace ingest (`api/trace/ingest`) writes S spans + T tool-calls + A eval results
  **synchronously in the HTTP request**.

### B7 — Horizontal-scaling seams (LOW-MEDIUM — mostly already solved)

- The old in-memory run-correlation Map was already replaced by the DB-backed
  `agent_run_sessions` store, so **runner and MCP server scale across processes with
  no sticky sessions** — good.
- SSE DOM Event Bridge holds connections in an in-process Set with per-connection
  tenant/org filtering and a pg LISTEN/NOTIFY cross-process bridge — structurally OK
  for multi-pod; the cost is the O(connections) walk per broadcast plus B4's refetch
  amplification.
- The dispatch overlay (`next/2026-06-19-agent-dispatch.md`, unbuilt) is the roadmap
  answer for external/pull worker fleets: leases, capability routing, per-binding
  concurrency, payload-by-reference in S3.

---

## 3. What to do about it — phased plan

### Phase 0 — Configuration only (unblocks the target load; hours of work)

1. `QUEUE_STRATEGY=async` (Redis/BullMQ) in every non-dev environment. Non-negotiable.
2. Dedicated worker deployment (`mercato queue worker`), **not** auto-spawn in web:
   start with `WORKERS_WORKFLOW_ACTIVITIES_CONCURRENCY=10` × 2–3 worker replicas
   (≈ 20–30 slots ≥ the ~20-slot requirement), and raise
   `OM_WORKERS_DB_CONNECTION_BUDGET` / `DB_POOL_MAX` (or put pgbouncer in front) so
   the budget clamp doesn't silently undo it. Agent work is I/O-bound (LLM wait), so
   high concurrency per worker is cheap.
3. Fix `OPENCODE_URL` in the fullapp compose; set `OM_OPENCODE_RUN_TIMEOUT_MS`
   deliberately (5 min default is a reasonable ceiling).
4. Monitor from day 1: queue depth + job age on `workflow-activities`, OpenCode
   session count, `agent_runs` status distribution, DB pool saturation.

### Phase 1 — Cheap code changes with outsized returns (days)

1. **Dedicated `invoke-agent` queue** separate from `workflow-activities`, so
   minute-long LLM jobs never starve timers/waits, and its concurrency can be tuned
   (and later rate-limited per provider) independently.
2. **Timeout on the in-process agent path** (mirror the OpenCode deadline). A hung
   LLM call must fail the run, not eat a slot forever.
3. **Admission control in `agentRuntime.run`**: a global + per-tenant semaphore
   (queue when saturated, reject with a typed error at a hard cap). This also caps
   `delegate_agent` fan-out and protects the single OpenCode container until B2 is
   fixed properly.
4. **Composite indexes** (one small migration):
   `agent_proposals (organization_id, disposition, created_at)`,
   `agent_runs (organization_id, status, created_at)`, partial index on
   `eval_passed = false`, `workflow_events (workflow_instance_id, event_type)`.
5. **Default list sort `created_at DESC`** on runs/proposals routes; move caseload to
   server-side pagination/filtering (the API already supports `disposition` filters).
6. **Implement F2 metric rollups** (already fully designed: `AgentMetricRollup` +
   scheduler worker) and repoint the Overview/trust tiles at it. This deletes the
   sampled-KPI correctness bug and the biggest read load in one move.
7. **Debounce the SSE-driven refetch** (coalesce to e.g. one reload per 5–10 s per
   page) — turns the 50-operator refetch storm into background noise.

### Phase 2 — Architectural fixes (weeks)

1. **OpenCode horizontal pool**: N containers behind a config list; pin each run to
   one base URL (correlation is DB-backed, so only the send + SSE of a single run
   need the same instance). Add per-instance session caps and route new runs to the
   least-loaded instance. Autoscale on active-session count.
2. **Tame the SSE firehose**: one shared `/event` subscription per app process with a
   local dispatcher fan-out to per-run waiters, instead of one connection per run —
   O(N) instead of O(N²). Add reconnect-with-resume.
3. **Event-driven outcome delivery instead of 750 ms polling**: `submit_outcome`
   already writes the outcome row in the MCP process; add a pg `NOTIFY` (the events
   bridge already uses LISTEN/NOTIFY) so the runner wakes immediately. Keep a slow
   poll as fallback.
4. **Consider a non-blocking INVOKE_AGENT worker for OpenCode targets**: the park/
   resume machinery already exists — the worker could start the session and exit,
   with `submit_outcome`/trace-ingest completion driving the resume signal. This
   removes LLM latency from the worker-slot equation entirely (slots then only pay
   for orchestration milliseconds, and the same fleet handles 10× the load).
5. **Async trace ingest**: `202` + enqueue; batch span/tool-call inserts.
6. **F1 S3 artifact offload** (columns already exist) so large inputs/outputs leave
   the hot tables; **F3 monthly partitioning + tiered retention** for
   `agent_spans`/`agent_tool_calls`, plus a retention policy for `workflow_events`
   (prune/archive terminal instances after N days). Do this before the tables get
   big — gap-19 itself flags the migration as risk-high once data exists.
7. **Workflow context discipline**: keep agent outputs out of `WorkflowInstance.context`
   (store `agentRunId` references; the results already live in `agent_runs.output`) to
   stop the quadratic context-rewrite growth in 12-agent cases.
8. **LLM provider budget**: per-provider concurrency/RPM budget on the invoke-agent
   queue (BullMQ rate limiting), retry-with-backoff on 429 instead of fail-stop, and
   a priority lane so interactive (playground/operator) runs preempt batch/scheduled
   Agentic Task runs.

### Phase 3 — Scale-out beyond ~10× the target (when needed)

- Adopt the **dispatch overlay** (leases, capability routing, per-binding concurrency,
  payload-by-reference) for external/pull worker fleets — it is the designed answer
  to "many runtimes, bounded per-binding concurrency, survivable long tasks."
- Read replicas for cockpit/list traffic once rollups + indexes are in (the read side
  is already cleanly separable — all list reads go through the query engine).
- The app tier itself scales horizontally today (DB-backed correlation, LISTEN/NOTIFY
  event bridge); the remaining singletons after Phase 2 are Redis and Postgres,
  both standard to scale.

---

## 4. Capacity verdict

| Configuration | Sustainable load |
|---|---|
| **Today's defaults** (local queue, concurrency 1, one OpenCode container, no indexes) | ~1,000–1,400 agent runs/day, single process, cockpit accurate only below ~100 rows — **~10× short of target** |
| **Phase 0** (async queue + 20–30 worker slots + fixed URLs) | Target 12k runs/day is reachable for in-process agents; OpenCode path and cockpit degrade first |
| **Phase 0+1** | Comfortable at 12k runs/day; cockpit correct; single-tenant bursts bounded |
| **Phase 2** | 5–10× target (60–120k runs/day); table growth managed; OpenCode path horizontally scalable |

The dominant insight: this is an **LLM-latency-bound system with a slot-blocking
execution model**. Every scaling lever is either "more slots" (Phase 0), "stop
wasting slots" (timeouts, non-blocking INVOKE_AGENT), or "stop letting the ledger
tables and live reads decay" (rollups, indexes, partitioning, retention). None of it
requires re-architecting the propose-only pipeline — the disposition/park/resume
core is already signal-driven and O(1) per event, which is the right foundation.

---

## Appendix — key evidence (file:line)

- Worker slot-blocking + concurrency 1: `packages/core/src/modules/workflows/workers/workflow-activities.worker.ts:34-41`, `lib/activity-worker-handler.ts:255`, `lib/activity-executor.ts:931,1021-1043`
- Local queue default: `packages/queue/src/factory.ts:62`, `strategies/local.ts:34,60,310`
- No in-process timeout / unbounded concurrency: `agent_orchestrator/lib/runtime/agentRuntime.ts:145-372`
- Single OpenCode container + singleton client: `docker-compose.yml:2-37`, `packages/ai-assistant/src/modules/ai_assistant/di.ts:12`, `lib/opencode-client.ts:511-515`
- Per-run SSE + client-side filtering: `openCodeAgentRunner.ts:405-437`; 750 ms outcome polling: `openCodeAgentRunner.ts:79,354-358`; per-run bcrypt token: `openCodeAgentRunner.ts:158-181`
- DB-backed cross-process correlation (fixed): `lib/runtime/agentRunSessionStore.ts:44-107`, `REAL-CONTAINER-FINDINGS.md` §3
- setImmediate workflow start: `workflows/api/instances/route.ts:255-265`; full-context jsonb rewrite: `lib/workflow-executor.ts:1130-1136`; signal-driven O(1) resume: `lib/signal-handler.ts:60-83`
- Sampled KPIs + client pagination: `backend/overview/page.tsx:93-182`, `backend/caseload/page.tsx:236-379`; pageSize cap + id sort: `factory.ts:79-82,1402`
- Refetch storm: `overview/page.tsx:130-132`, `caseload/page.tsx:291-293`, `events/api/stream/route.ts:108-139`
- Missing indexes: `agent_orchestrator/data/entities.ts:11-15,885-888`
- Write amplification + sync trace ingest: `commands/{runs,proposals,dispose}.ts`, `lib/trace/traceIngestionService.ts:54-147`
- Retention/partitioning/offload unbuilt: `next/IMPLEMENTATION-TRACE.md` F1–F3, `gap-analysis/gap-19-retention-archival.md`
