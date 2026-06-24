> 🗂️ **Status: NOT STARTED (follow-up).** This spec is the backlog for everything deliberately deferred from the
> trace-eval overlay + operations cockpit shipped in **PR #3532** (`feat/agent-orchestrator-next-phase` →
> `feat/agent-orchestrator-mvp`). Build ON TOP of that PR. Baseline of what already exists:
> `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` + the run plan
> `.ai/runs/2026-06-23-agent-trace-eval-capture/PLAN.md` (per-PR session log). Code:
> `packages/enterprise/src/modules/agent_orchestrator/`.

# Agent Trace-Eval — PR 4b & Follow-ups

> **Status:** Draft · **Created:** 2026-06-24 · **Module:** `agent_orchestrator` (core)
> **Parent specs:** `next/2026-06-19-agent-trace-eval-capture.md`, `next/2026-06-20-agent-eval-harness-and-metrics.md`,
> `next/2026-06-19-agent-operations-ui.md` · backing gaps: gap-04, gap-05, gap-19.
> **Conventions:** `2026-06-19-agent-orchestrator-conventions.md` wins on any entity/structure conflict.

## TLDR

The trace · evaluation · correction learning loop and the operator/engineer cockpit are **implemented and merged
into the agent-orchestrator integration branch** (PR #3532). What remains is (A) the infra that was deferred because
it is environment-coupled or needs irreversible DDL — encrypted S3 artifact offload, metric rollups, and span
partitioning/retention — and (B) a handful of smaller hardening/cleanup items surfaced by the in-repo code review.
This doc carries the full context to pick any of them up cold.

---

## 1. What is already implemented (PR #3532 — treat as substrate)

All under `packages/enterprise/src/modules/agent_orchestrator/`.

### Data model (entities + 3 scoped migrations + snapshot)
- **`AgentRun`** (extended, `agent_runs`): added `runtime`, `externalRunId` (unique `(runtime, externalRunId)`),
  `agentVersion`, `model`, `processId`, `stepId`, `proposalId`, `confidence`, `inputTokens`, `outputTokens`,
  `costMinor` (bigint), `currency`, `latencyMs`, `evalScore`, `evalPassed`, `contextRouting`,
  **`outputArtifactKey`** (S3 key — column exists, NOT yet populated), `humanConfirmedAt`, `deletedAt`;
  status union widened with `'cancelled'`. Kept `agentId` (did NOT rename to `agentDefinitionId`).
- **`AgentSpan`** (`agent_spans`, append-only): `agentRunId`, `externalSpanId` (unique `(agentRunId, externalSpanId)`),
  `parentSpanId`, `sequence`, `name`, `kind`, `startedAt`, `endedAt`, `durationMs`, `status`, `attributes`.
- **`AgentToolCall`** (`agent_tool_calls`, append-only): `spanId`, `agentRunId`, `toolName`, `requestSummary`,
  `responseSummary`, **`requestArtifactKey`/`responseArtifactKey`** (S3 keys — columns exist, NOT yet populated),
  `status`, `latencyMs`, `errorMessage`.
- **`AgentCorrection`** (`agent_corrections`, append-only): mandatory `reason`, `proposedValue`, `correctedValue`,
  `action`, `evalCaseId`, FK ids to run/proposal.
- **`AgentEvalCase`** (`agent_eval_cases`, editable + optimistic lock): `sourceType`, `sourceId`, `agentDefinitionId`,
  `input`, `expected`, `assertions`, `status` (`draft|approved|archived`), `approvedByUserId`.
- **`AgentEvalAssertion`** (`agent_eval_assertions`, editable): `key`, `appliesTo` (agentId or `*`), `type`
  (`deterministic|llm_judge`), `severity` (`gate|warn`), `config`, `version`, `enabled`. Unique `(org, appliesTo, key)`.
- **`AgentEvalResult`** (`agent_eval_results`, append-only): `agentRunId`, `assertionId`, `assertionKey`, `passed`,
  `score`, `severity`, `evidence`.
- All registered in `di.ts`. Migrations: `Migration20260623072052` (capture), `Migration20260623153336` (flywheel),
  `Migration20260623155649` (eval). **Not yet applied** (`db:migrate` is the maintainer's call).

### Services / runtime (`lib/`)
- `lib/trace/ingestAuth.ts` — `signTraceIngest` / `verifyTraceIngestRequest` (per-tenant HMAC via
  `deriveJwtAudienceSecret('agent-trace-ingest:<tenantId>')` + Standard-Webhooks verify).
- `lib/trace/traceIngestionService.ts` — `ingestTrace(em, scope, payload)`: idempotent upsert on
  `(runtime, externalRunId)`, append-once spans/tool-calls, out-of-order parent rebuild. **Stores redacted,
  size-capped summaries inline (4000-char cap); does NOT offload to S3 yet** (the artifact-key columns stay null).
- `lib/trace/correctionService.ts` — `recordCorrection(em, input)`: append-only correction + auto-draft eval case.
- `lib/eval/scorers.ts` — shared pure-function registry (`output_present`, `required_keys`, `min_confidence`, `no_pii`).
- `lib/eval/evalRuntimeService.ts` — `evaluateRun(em, scope, runId)`: inline deterministic gate tier; sets
  `AgentRun.evalScore`/`evalPassed`; warn never blocks.
- `lib/eval/llmJudge.ts` — `createModelJudge(container)` (factory + `generateObject`) + `runLlmJudgeForRun` (idempotent, warn-only).
- `lib/eval/sampling.ts` — `shouldSampleForJudge` / `resolveJudgeSampleRate` (`OM_AGENT_LLM_JUDGE_SAMPLE_RATE`, default 0.1).
- `lib/eval/defaultAssertions.ts` — `seedDefaultEvalAssertions(em, scope)` (idempotent; wired into `setup.ts` `seedDefaults`).
- `lib/queue.ts` — `getAgentOrchestratorQueue` + `AGENT_ORCHESTRATOR_LLM_JUDGE_QUEUE = 'agent-orchestrator-llm-judge'`.
- `workers/llm-judge.ts` — sampled warn-only judge worker (`@open-mercato/queue` contract; best-effort).
- `commands/trace.ts` (`agent_orchestrator.trace.ingest` → ingest + inline eval + sampled judge enqueue),
  `commands/corrections.ts` (`corrections.create`, `evalCases.approve`), and the dispose hook in `commands/dispose.ts`
  (human edit/reject auto-records a correction, best-effort).

### APIs (all export `openApi`)
- `POST /api/agent_orchestrator/trace/ingest` — HMAC machine webhook (`requireAuth:false`, `systemActor:true`,
  **no CRUD mutation guard** by design — mirrors inbound carrier/payment webhook precedent).
- `GET /api/agent_orchestrator/runs` — list with `window` (24h/7d/30d/90d) + `filter` (overridden/low-confidence/
  eval-fail) facets; gate changed `agents.view` → **`trace.view`**.
- `GET /api/agent_orchestrator/runs/:id` — run + spans + toolCalls + evalResults.
- `POST /api/agent_orchestrator/corrections` — explicit correction surface (gate `trace.correct`).
- `POST /api/agent_orchestrator/eval-cases/:id/approve` — optimistic-lock 409 via `surfaceRecordConflict` (gate `eval.manage`).
- `GET /api/agent_orchestrator/eval-cases/export` — versioned envelope, approved-only (gate `eval.export`).
- `GET /api/agent_orchestrator/agents/:id/metrics` — override / eval-pass / approve-unchanged + latency/cost over a window.

### Events / ACL
- Events: `run.ingested`, `run.evaluated`, `proposal.corrected`, `eval_case.created`, `eval_case.approved`.
- ACL: `trace.view`, `trace.correct`, `eval.manage`, `eval.export` (+ role grants in `setup.ts`).

### Cockpit UI (`backend/`)
- `backend/traces/page.tsx` + `backend/traces/[id]/page.tsx` — Engineer trace inspector (list + span waterfall /
  tool calls / eval results / output). Nav entry gated `trace.view`.
- `backend/overview/page.tsx` — eval-pass / override / approve-unchanged KPI tiles (client-side from loaded data).
- `backend/caseload/[proposalId]/page.tsx` — "Open full trace" handoff link.
- `backend/playground/page.tsx` — per-agent "Insert sample" input (`SAMPLE_INPUTS`, demo agent).
- `components/types.ts` — `RunView` trace fields + `Span/ToolCall/EvalResult` views + `mapRunDetail`.

### Tests
27 unit tests + 3 integration specs (`__integration__/TC-AGENT-TRACE-00{1,2,3}.spec.ts`); 110 module tests pass.

---

## 2. What remains (the follow-up work)

Pick up any item independently. Each lists **why**, **approach**, **files**, **verified building blocks**, and **acceptance**.

### F1 — Encrypted S3 artifact offload  · effort M · priority-medium · risk-medium
**Why:** ingestion stores only size-capped inline summaries; full prompts/outputs/tool payloads should be offloaded
to `storage-s3` (encrypted at rest) with the row carrying only the key + a redacted summary (PII minimization, the
trace spec's § Constraints). The columns already exist (`AgentRun.outputArtifactKey`,
`AgentToolCall.request/responseArtifactKey`) but are never populated.
**Approach:** add `lib/trace/artifactStore.ts` with `putArtifact(container, scope, namespace, value): Promise<string|null>`:
resolve `storageService` (best-effort via try/catch — absent in dev/test), encrypt via `tenantEncryptionService`,
upload, return the key; degrade to inline summary + null key when storage is unconfigured. Wire into `ingestTrace`
for payloads above the existing cap. Add a read-side decrypt path in `GET /runs/:id` so the inspector can fetch the
full payload on demand (or a signed URL).
**Verified building blocks:**
- `storageService` (DI key `storageService`) is a proxy: `const svc = await container.resolve('storageService')._resolveService({tenantId, organizationId})`, then `svc.upload({ namespace, fileName, buffer, contentType, scope })` → `{ key }`; `svc.download({ key, scope })`. Needs per-tenant `storage_s3` integration credentials (absent in dev/test → must degrade).
- `tenantEncryptionService` (DI key `tenantEncryptionService`): `encryptEntityPayload(entityId, payload, tenantId, organizationId)` / `decryptEntityPayload(...)`. Requires a declared encryption map (see F5) or it no-ops.
**Acceptance:** large payloads land in S3 (key on the row, redacted summary inline) when storage is configured;
ingestion still succeeds (inline) when it is not; inspector can retrieve the full artifact; nothing logs raw PII.
**Gotcha:** there are **zero** existing `storageService` consumers to mirror — this is the first; budget time to
validate the proxy/credentials flow against a real `storage_s3` integration.

### F2 — Metric rollups + scheduler + persisted anti-rubber-stamp signals  · effort M · priority-medium · risk-low
**Why:** the metrics endpoint and Overview tiles compute live over a capped 5000-row window (gap-05 "ratio mirage").
Hot per-agent KPIs should be precomputed into rollup rows on a cadence so the (future) autonomy ramp + dashboards
read stable windows, and so large fleets aren't bounded by the row cap.
**Approach:** new append-only **`AgentMetricRollup`** entity (`agent_metric_rollups`: tenantId, organizationId,
agentDefinitionId, windowStart, windowEnd, computedAt, metrics jsonb — override/eval-pass/approve-unchanged/latency/
cost/count). A `packages/scheduler` registration enqueues a rollup job per org on an interval; a
`@open-mercato/queue` worker (`workers/metric-rollup.ts`) aggregates this module's tables into rollup rows
(idempotent per `(agent, windowStart)`). Repoint `/agents/:id/metrics` + Overview tiles to prefer rollups, falling
back to live compute. Stamp each rollup with `computedAt`/`windowStart`/`windowEnd`.
**Verified building blocks (scheduler convention — DI key is `schedulerService`, NOT `scheduler`):**
```ts
const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
await schedulerService.register({
  id: stableUuid('agent_orchestrator:metric-rollup:' + organizationId),
  name: 'Agent metric rollup', scopeType: 'organization', organizationId, tenantId,
  scheduleType: 'interval', scheduleValue: '300s', timezone: 'UTC',
  targetType: 'queue', targetQueue: 'agent-orchestrator-metric-rollup',
  targetPayload: { scope: { tenantId, organizationId } },
  sourceType: 'module', sourceModule: 'agent_orchestrator', isEnabled: true,
}) // idempotent upsert; guard with cradle.hasRegistration('schedulerService') — see communication_channels/setup.ts
```
Register in `setup.ts` `onTenantCreated`/`seedDefaults` (best-effort, like `integrations`/`communication_channels`/
`customer_accounts` setup). `ScheduleRegistration` type from `@open-mercato/scheduler`.
**Acceptance:** rollups refresh on the interval; metrics/tiles read rollups with a live fallback; rows carry window
provenance; worker is idempotent. New entity ⇒ migration + snapshot + `di.ts` registration.

### F3 — Span/tool-call partitioning + tiered retention + archival worker  · effort L · priority-low · risk-high
**Why:** gap-19. `agent_spans`/`agent_tool_calls` are high-volume (~9M rows/yr); they must be partitioned by
`created_at` and tiered (hot N days → cold → S3 archive), while the low-volume audit tiers
(`agent_eval_results`/`agent_corrections`/`agent_eval_cases`) stay hot, immutable, ≥6yr (AI Act Art. 12).
**Approach (per gap-19):** **hand-authored** Postgres declarative monthly range partitioning (MikroORM v7 does NOT
emit `PARTITION BY` — the conventions doc sanctions a hand-written migration + hand-updated
`.snapshot-open-mercato.json`). `schedulerService` maintenance job pre-creates N months ahead (+ a default
catch-all partition); a `@open-mercato/queue` archival worker detaches cold partitions and exports them to
`storage-s3` (reusing F1's encrypted store); a tiered-retention policy table marks audit tiers `immutable: true`.
**Decision needed:** the two tables were created **non-partitioned** in `Migration20260623072052`. Since they are
brand-new (no production rows on the integration branch), the cleanest path is a migration that **drops + recreates
them partitioned** rather than an in-place partition conversion — confirm no environment has live data first.
**Acceptance:** spans/tool-calls insert into monthly partitions; maintenance pre-creates partitions; cold partitions
archive to S3; audit tiers never pruned (guard test); GDPR erasure redacts archived artifacts on read.

### F4 — `/runs` ACL gate rollout safety  · effort S · priority-high · risk-medium · OPERATIONAL
**Why:** PR #3532 tightened `GET /runs` from `agents.view` → `trace.view`. Existing tenants get **403 until
`yarn mercato auth sync-role-acls` runs**. `setup.ts` already grants `trace.view` to the same roles for new tenants.
**Approach:** ensure the deploy runbook runs `auth sync-role-acls`. OPTIONAL safer alternative: accept either feature
on the list route (requires an OR-capable guard — current `requireFeatures` is AND), or revert the list route to
`agents.view` and reserve `trace.view` for the new detail/metrics surfaces.
**Acceptance:** existing-tenant operators retain run-list access post-deploy.

### F5 — Module `encryption.ts` + route reads via decryption helpers  · effort S · priority-medium · risk-low
**Why:** code-review Medium #1. New code reads PII-bearing tenant entities (`AgentRun`, `AgentEvalCase`) via raw
`em.find`/`em.findOne`. There is **no `encryption.ts`** for the module, so it is not a live bug today, and the shipped
MVP (`commands/runs.ts`) already reads `AgentRun` raw — but it diverges from the convention (`dispose.ts` uses
`findOneWithDecryption`; the `corrections` route was already aligned in #3532). F1's S3 encryption depends on this.
**Approach:** add `encryption.ts` exporting `defaultEncryptionMaps` marking `AgentRun.input/output`,
`AgentProposal.payload`, `AgentEvalCase.input/expected`, `AgentToolCall.request/responseSummary` as encrypted; then
route the corresponding reads in `lib/eval/*`, `lib/trace/traceIngestionService.ts`, and the `runs/[id]`/`metrics`/
`eval-cases/export` routes through `findWithDecryption`/`findOneWithDecryption` with `{ tenantId, organizationId }`.
**Acceptance:** PII-bearing reads decrypt; `optimistic-lock`/encryption guards pass; no raw `em.find(` on encrypted
entities in production files.

### F6 — Dispose→correction hook test  · effort S · priority-medium · risk-low
**Why:** code-review Medium #3. `recordCorrection` is unit-tested, but the wiring in `commands/dispose.ts` (an
`edited`/`rejected` verdict auto-records a correction with the **original pre-edit** payload) has no test.
**Approach:** integration test (or command test with a real EM) asserting an edited/rejected dispose writes an
`AgentCorrection` (correct `proposedValue` = original) + a draft `AgentEvalCase`, and that `approved`/`auto_approved`
do NOT. Add as `__integration__/TC-AGENT-TRACE-004.spec.ts` or a command unit test.
**Acceptance:** the auto-record path is covered both ways.

### F7 — i18n flatten + de/es/pl locales  · effort M · priority-low · risk-low · PRE-EXISTING
**Why:** `i18n:check-sync` flags `agent_orchestrator` (nested format + missing `pl/es/de`). This **predates** the
trace-eval work — the module shipped nested + en-only (it was the 2nd module in the code-review's "8 issues across 2
modules", alongside `workflows`). New keys were kept in the existing nested format to avoid widening the gap.
**Approach:** convert `i18n/en.json` to the flat dot-key format used by `customers/i18n` and add `de.json`/`es.json`/
`pl.json`; run `yarn i18n:check-sync --fix`. Module-wide cleanup, not trace-specific.
**Acceptance:** `yarn i18n:check-sync` passes for `agent_orchestrator`.

### F8 — Runner stamps `runtime` + `externalRunId`  · effort S · priority-low · risk-low
**Why:** ingestion correlates on `(runtime, externalRunId)`, but the in-process/OpenCode runner
(`lib/runtime/agentRuntime.ts`, `openCodeAgentRunner.ts`, via `commands/runs.ts`) does not stamp them, so
runner-created runs can't be re-correlated by a later trace POST (they have null/null — fine for the unique index,
which allows multiple nulls, but no cross-correlation).
**Approach:** pass `runtime` (`'in-process'`/`'opencode'`) + a stable `externalRunId` through `createRun` and persist
them in `agent_orchestrator.runs.create`.
**Acceptance:** runner-created runs carry `runtime`+`externalRunId`; a subsequent ingest for the same run upserts the
same row.

### F9 — `llm_judge` assertion management (CRUD or seed)  · effort M · priority-low · risk-low
**Why:** the `llm_judge` worker only runs when an enabled `type='llm_judge'` `AgentEvalAssertion` exists, but there is
**no UI/API to create assertions** (deterministic defaults are seeded; llm_judge is dormant by config). Today an
operator must insert a row by hand.
**Approach:** a CRUD route (`makeCrudRoute`, indexer `agent_orchestrator:agent_eval_assertion`, gate `eval.manage`)
+ a small backend management page, OR seed example `llm_judge` assertions. Reuse the editable/optimistic-lock pattern.
**Acceptance:** an engineer can create/enable an `llm_judge` assertion and see it produce sampled warn results.

### F10 — Cockpit guard-results panel  · effort M · priority-low · BLOCKED on guardrails overlay
**Why:** the operations-UI spec's disposition card shows `guardResults`, but the **runtime guardrails overlay**
(`next/2026-06-19-agent-runtime-guardrails.md`, entity `AgentGuardrailCheck`) is not built. The disposition card +
trace inspector should render guard verdicts once it exists.
**Approach:** implement guardrails overlay first, then add a guard-results section to `components/ProposalCard.tsx`
and the trace inspector. **Cross-ref, not part of this spec's scope.**

---

## 3. Open decisions

- **Queue backend (F2/F3 workers):** Postgres `SKIP LOCKED` vs BullMQ. `@open-mercato/queue` abstracts the strategy
  via `createModuleQueue`/`resolveQueueStrategy` — confirm the deployment's default strategy; the parent specs lean
  `SKIP LOCKED` for v1.
- **F3 partition conversion:** drop+recreate (clean, brand-new tables) vs in-place — confirm no env has live span data.
- **F1 encryption granularity:** per-tenant DEK (exists today) is sufficient for trace artifacts; per-subject
  crypto-shredding (gap-12) is only required by the separate **compliance/AI-Act overlay**, not here.

## 4. Verification commands

```bash
yarn generate && yarn build:packages && yarn typecheck
yarn workspace @open-mercato/core test -- --testPathPattern agent_orchestrator
yarn db:generate            # diff probe for F1/F2 entity changes (keep only agent_orchestrator SQL + snapshot)
yarn i18n:check-sync        # F7
yarn build:app
```

## 5. Migration & Backward Compatibility

- F2 (`AgentMetricRollup`) and any F1 columns are **additive** (new table / nullable columns + defaults).
- F3 partitioning is the only structural risk — hand-authored DDL + hand-updated snapshot; drop+recreate only on
  confirmation that no environment holds live span data.
- The eval-case export envelope (`EVAL_CASE_EXPORT_VERSION`) is already STABLE/ADDITIVE-ONLY — do not break it.
- No event IDs / API URLs / ACL features / DI names removed.

## 6. Changelog

- **2026-06-24:** Created. Captures the deferred PR 4b infra (F1 S3 offload, F2 rollups+scheduler, F3 partitioning)
  + code-review follow-ups (F4 ACL rollout, F5 encryption.ts, F6 dispose-hook test, F7 i18n, F8 runner stamping,
  F9 llm_judge assertion management) and the guardrails-blocked F10, with verified building blocks
  (`schedulerService` DI + `ScheduleRegistration`, `storageService` proxy, `tenantEncryptionService`) to start cold.
