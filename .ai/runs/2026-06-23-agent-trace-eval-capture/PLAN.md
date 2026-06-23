# Implementation Plan & Progress — Agent Orchestrator: Trace, Evaluation & Correction Capture

> **Run folder:** `.ai/runs/2026-06-23-agent-trace-eval-capture/`
> **Spec:** `.ai/specs/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md`
> **Eval-harness detail:** `.ai/specs/agent-orchestrator/next/2026-06-20-agent-eval-harness-and-metrics.md`
> **Backing gaps:** gap-04 (eval harness), gap-05 (metrics), gap-19 (retention/partitioning)
> **Baseline (build ON this):** `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`
> **Module:** `packages/core/src/modules/agent_orchestrator/` · subdomain `lib/trace/`
> **Status:** NOT STARTED · **Created:** 2026-06-23

## Context

The Agent Orchestrator MVP is already shipped (two runtimes, propose-only contract,
`AgentRun`/`AgentProposal`/`AgentRunSession`, disposition gate, `INVOKE_AGENT` workflow bridge,
registry/SDK/skills/sub-agents, ACL, events, tests). This overlay is the **dependency root** of the `next/`
roadmap: it unblocks the cockpit trace inspector, the lifecycle regression gate, and the metrics substrate.

Problem it solves: the trace inspector has nothing to read; agent degradation is invisible (no per-agent
override/eval/cost metrics); operator overrides evaporate instead of becoming regression tests; EU AI Act
Art. 12 (record-keeping) and Art. 14 (oversight) are unmet. Outcome: the "learning loop" — capture every run
→ evaluate → record human corrections → promote them into a versioned eval-case export the lifecycle gate
consumes.

## Key design decisions (locked)

- **Extend `agent_runs` additively, do NOT rename/fork.** The spec's `AgentRun` is a superset of the shipped
  `agent_runs` table. The shipped table + commands + read APIs + `indexer` entityType are a live contract, so
  new columns are added **nullable**; keep `agentId` (do not rename to `agentDefinitionId`). The existing
  runner will stamp `runtime` + `externalRunId` so ingestion upserts the same row idempotently.
- **HMAC secret for `/trace/ingest`** reuses the `deriveJwtAudienceSecret` / `signAudienceJwt` pattern in
  `packages/shared/src/lib/auth/jwt.ts`, scoped per tenant (no new env secret). _(confirm during PR1)_
- **Deterministic-first eval.** Shared pure-function scorer registry (gap-04 single source of truth) consumed
  both inline (online) and, later, by the offline CI gate. Only deterministic scorers may carry `severity:'gate'`.
- **Append-only logs** (`AgentSpan`, `AgentToolCall`, `AgentCorrection`, `AgentEvalResult`) omit
  `updated_at`/`deleted_at`. Editable entities (`AgentRun`, `AgentEvalAssertion`, `AgentEvalCase`) carry
  `updated_at` + optimistic lock.
- **Eval-case export** is a new STABLE/ADDITIVE-ONLY contract surface — versioned envelope from day one.

## Open decisions (carry forward)

- [ ] **Queue backend** (PR4 + dispatch overlay): Postgres `SKIP LOCKED` vs BullMQ. Spec leans `SKIP LOCKED`.
- [ ] **Confirm HMAC secret source** = `signAudienceJwt` precedent (vs a dedicated env secret).
- [ ] **Partitioning DDL** (PR4) hand-authored (MikroORM v7 can't emit `PARTITION BY`); hand-update snapshot.

---

## Progress tracker

### PR 1 — Capture foundation (spec Phases 1–3)
- [ ] Extend `AgentRun` (`data/entities.ts`) with nullable trace columns: `processId`, `stepId`, `proposalId`,
      `agentVersion`, `model`, `runtime`, `externalRunId`, `confidence`, `inputTokens`, `outputTokens`,
      `costMinor` (bigint), `currency`, `latencyMs`, `evalScore`, `evalPassed`, `contextRouting`,
      `outputArtifactKey`, `humanConfirmedAt`, `deletedAt`; add `(runtime, externalRunId)` unique index +
      `(agentId, createdAt)` index; add `'cancelled'` status. Keep `agentId`.
- [ ] New `AgentSpan` (`agent_spans`, append-only) entity.
- [ ] New `AgentToolCall` (`agent_tool_calls`, append-only) entity.
- [ ] Zod (`data/validators.ts`): `traceIngestSchema`, `runListQuerySchema`, run-detail response shape.
- [ ] Migration + `.snapshot-open-mercato.json` (via `yarn generate` → `yarn db:generate` diff probe; keep
      only `agent_orchestrator` SQL; do NOT `yarn db:migrate`).
- [ ] `lib/trace/traceIngestionService.ts`: idempotent upsert on `(runtime, externalRunId)`; append
      spans/tool-calls; `sequence`+`parentSpanId` tree rebuild; storage-s3 offload (encrypted via
      `TenantDataEncryptionService`); redacted row summaries.
- [ ] `api/trace/ingest/route.ts`: HMAC verify + `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess`;
      command-path write; emit `agent_orchestrator.run.ingested`.
- [ ] Wire existing runner (`lib/runtime/agentRuntime.ts`, `openCodeAgentRunner.ts`) to stamp
      `runtime`+`externalRunId`.
- [ ] Read API `GET /api/agent_orchestrator/runs` (`makeCrudRoute` + `indexer: agent_orchestrator:agent_run` +
      `openApi`; filters `overridden|low-confidence|eval-fail|agentDefinitionId|window`; returns `updatedAt`).
- [ ] Read API `GET /api/agent_orchestrator/runs/:id` (run + spans + tool-calls + contextRouting + artifact links).
- [ ] `events.ts`: `.run.ingested`, `.run.evaluated`. `acl.ts` + `setup.ts`: `trace.view`, `trace.correct`,
      `eval.manage`, `eval.export`; `yarn mercato auth sync-role-acls`.
- [ ] Tests: unit (idempotency, out-of-order spans), integration (HMAC 401, ≤5s p95 query, RBAC, tenant-isolation).
- [ ] Validation gate + `om-code-review`; open PR.

### PR 2 — Correction flywheel (spec Phases 5–6)
- [ ] `AgentCorrection` (`agent_corrections`, append-only) + `AgentEvalCase` (`agent_eval_cases`, editable)
      entities + migration + snapshot.
- [ ] `lib/trace/correctionService.ts`: mandatory non-empty `reason` (Zod + command; empty → 422); auto-draft
      `AgentEvalCase` (`status='draft'`, `input`=run input, `expected`=correctedValue).
- [ ] Hook `CorrectionService` into shipped disposition path (`lib/disposition/dispositionService.ts`,
      `commands/dispose.ts`) — additive, does not change disposition semantics.
- [ ] `POST /api/agent_orchestrator/corrections` (command + guard, `trace.correct`).
- [ ] `POST /api/agent_orchestrator/eval-cases/:id/approve` (optimistic lock + `surfaceRecordConflict`,
      `eval.manage`).
- [ ] `GET /api/agent_orchestrator/eval-cases/export` — `EvalCaseExporter`, versioned envelope, approved only,
      `eval.export`.
- [ ] Events: `.proposal.corrected`, `.eval_case.created`, `.eval_case.approved`.
- [ ] Tests incl. headline E2E `ingest → query → correct → export`; append-only enforcement.
- [ ] Validation gate + `om-code-review`; open PR.

### PR 3 — Deterministic eval (spec Phase 4 + gap-04)
- [ ] `AgentEvalAssertion` (editable) + `AgentEvalResult` (append-only) entities + migration + snapshot.
- [ ] `lib/eval/scorers/` — shared pure-function scorer registry (schema/threshold/PII), no EM/request scope.
- [ ] `lib/eval/evalRuntimeService.ts` — inline deterministic gate tier called from `TraceIngestionService`;
      writes `AgentEvalResult`; sets `AgentRun.evalScore`/`evalPassed`; `warn` never blocks.
- [ ] `GET /api/agent_orchestrator/agents/:id/metrics` — override + eval-pass rate (+ latency/cost) over a
      window (`trace.view`).
- [ ] Tests: scorer purity, gate-fails-run, metrics-over-window.
- [ ] Validation gate + `om-code-review`; open PR.

### PR 4 — Deferred (spec Phases 7–8, gap-05/19) — needs queue-backend decision
- [ ] `llm_judge` async warn tier on `packages/queue` via `ai_assistant` `AiModelFactory`, sampled.
- [ ] Metric rollups + anti-rubber-stamp signals (approve-unchanged rate, sampled re-review, persistent warns).
- [ ] `agent_spans`/`agent_tool_calls` partitioning + tiered retention + archival worker (hand-authored DDL).

---

## Verification (each PR)

- Unit (Jest, `__tests__/`): idempotent upsert; out-of-order span tree; mandatory-reason; append-only (no
  update/delete surface for append-only entities); scorer purity.
- Integration (Playwright, `__integration__/TC-AGENT-TRACE-<NNN>.spec.ts`, per `.ai/qa/AGENTS.md`): headline
  `ingest → query → correct → export`; HMAC 401; ≤5s p95 queryability; RBAC 403 per feature; per-surface
  tenant-isolation; versioned export shape. Self-contained fixtures, cleaned in `finally`.
- Gates: `yarn generate`, `yarn workspace @open-mercato/core build`, `yarn typecheck`, `yarn lint`,
  `yarn workspace @open-mercato/core test`, `yarn i18n:check-hardcoded`; `om-code-review` before each PR.

## Reference patterns
- Entities/commands/CRUD: `src/modules/customers/` (reference module), this module's `commands/runs.ts`,
  `api/runs/route.ts`, `api/openapi.ts`.
- Atomic writes: `runCrudCommandWrite` / `withAtomicFlush` (`@open-mercato/shared/lib/commands/*`).
- Optimistic lock + conflict: `@open-mercato/ui/backend/conflicts` (`surfaceRecordConflict`).
- HMAC/JWT: `packages/shared/src/lib/auth/jwt.ts`.

## Out of scope (separate overlays)
Guardrails; identity/on-behalf-of (cross-module `auth`/`audit_logs` changes — Ask First); dispatch/A2A;
lifecycle gating (consumes this export); compliance/AI-Act (DSAR/erasure needs net-new per-subject DEK,
gap-12 — also needs DPO/legal call on fairness, gap-13); context knowledge plane; full operations-UI cockpit.

## Session log
- 2026-06-23: Plan created from spec + gap-analysis review and live-code reconciliation. Not yet started.
- 2026-06-23: **PR 1 capture foundation implemented (code complete, NOT committed).**
  - Entities: extended `AgentRun` (nullable trace cols, `(runtime,externalRunId)` UNIQUE, `'cancelled'`);
    new `AgentSpan` (added `externalSpanId` + unique `(agentRunId,externalSpanId)` for idempotent/out-of-order
    parent linking — beyond the spec sketch, needed) and `AgentToolCall`; both registered in `di.ts`.
  - Validators: `traceIngestSchema` (+span/toolcall), extended `runListQuerySchema` (`filter`+`window`).
  - Migration `Migration20260623072052_agent_orchestrator.ts` + snapshot (scoped; NOT applied).
  - `lib/trace/ingestAuth.ts` (HMAC sign+verify, per-tenant `signAudienceJwt` secret + Standard-Webhooks verify);
    `lib/trace/traceIngestionService.ts` (`ingestTrace`, idempotent upsert + append-once + parent rebuild);
    `commands/trace.ts` (`agent_orchestrator.trace.ingest`, emits `run.ingested`); `api/trace/ingest/route.ts`
    (machine HMAC webhook, `requireAuth:false`, `systemActor:true`, no CRUD mutation guard — webhook precedent).
  - Reads: extended `GET /runs` (fields/filters/`window`, gate→`trace.view`); new `GET /runs/[id]` (run+spans+
    toolcalls, org-scoped 404).
  - `events.ts`/`acl.ts`/`setup.ts`: trace+eval events, features, role grants.
  - Tests: `trace-ingest-auth.test.ts` (5) + `trace-ingestion-service.test.ts` (4, fake EM) PASS;
    `__integration__/TC-AGENT-TRACE-001.spec.ts` authored (pending integration-env run — needs shared JWT_SECRET).
  - Gate: `yarn generate` ✓ · core build ✓ · `yarn typecheck` ✓ · 90 agent_orchestrator tests ✓ · i18n no new
    hits. `yarn lint` fails ONLY on pre-existing `apps/mercato` React-hooks errors (untouched by this change).
  - **Carry-forward before merge:** (a) run `yarn mercato auth sync-role-acls` (needs DB); (b) optional: stamp
    `runtime`+`externalRunId` on runner-created runs for in-process correlation; (c) task #8 encrypted s3 offload;
    (d) run integration suite; (e) `om-code-review` + commit/PR (user has not asked to commit/push yet).
- 2026-06-23: **PR 2 correction flywheel implemented (code complete, NOT committed).**
  - Entities: `AgentCorrection` (`agent_corrections`, append-only, mandatory `reason`) + `AgentEvalCase`
    (`agent_eval_cases`, editable + optimistic lock, `expected` nullable for reject-sourced drafts); both in `di.ts`.
    Migration `Migration20260623153336_agent_orchestrator.ts` + snapshot (scoped; NOT applied).
  - Validators: `correctionAction`, `createCorrectionRequestSchema` (reason required, edit needs correctedValue),
    versioned `EvalCaseExport` envelope (`EVAL_CASE_EXPORT_VERSION = 1`), `evalCaseExportQuerySchema`.
  - `lib/trace/correctionService.ts` (`recordCorrection`: append-only correction + auto-draft draft eval case,
    links `evalCaseId`, pure over EM). `commands/corrections.ts`: `corrections.create` (resolves run input,
    emits `proposal.corrected` + `eval_case.created`) and `evalCases.approve` (draft→approved, optimistic lock,
    idempotent, emits `eval_case.approved`).
  - Disposition hook in `commands/dispose.ts`: human `edited`/`rejected` verdict auto-records a correction
    (captures the ORIGINAL pre-edit payload; best-effort — verdict already committed, failure only warns).
  - Routes: `POST /corrections` (gate `trace.correct`), `POST /eval-cases/[id]/approve` (gate `eval.manage`,
    409 via `surfaceRecordConflict`), `GET /eval-cases/export` (gate `eval.export`, approved-only versioned envelope).
  - Events: `proposal.corrected`, `eval_case.created`, `eval_case.approved`.
  - Tests: `correction-service.test.ts` (3, fake EM: edit/reject/empty-reason) PASS — total 93 module tests ✓.
    `__integration__/TC-AGENT-TRACE-002.spec.ts` authored (export envelope, approve-404, correction 422/404).
    Full correct→approve→export E2E needs a proposal fixture (runtime-produced) → unit-covered; noted in spec.
  - Gate: `yarn generate` ✓ · core build ✓ · `yarn typecheck` ✓ · 93 tests ✓ · i18n 0 agent_orchestrator hits.
    `yarn lint` still fails only on pre-existing `apps/mercato` React-hooks errors (untouched).
  - **Decision:** dispose auto-records edit/reject corrections (has the pre-edit payload); `POST /corrections`
    is the explicit surface for `override`/`answer` and non-dispose flows — both route through one command.
  - **Next:** PR 3 (deterministic eval: `AgentEvalAssertion`/`AgentEvalResult` + shared scorer registry +
    inline `EvalRuntimeService` + `agents/:id/metrics`).
- 2026-06-23: **PR 3 deterministic eval implemented (code complete, NOT committed).**
  - Entities: `AgentEvalAssertion` (editable + optimistic lock, unique `(org, appliesTo, key)`) + `AgentEvalResult`
    (append-only); both in `di.ts`. Migration `Migration20260623155649_agent_orchestrator.ts` + snapshot (scoped).
  - `lib/eval/scorers.ts`: shared PURE scorer registry (`output_present`, `required_keys`, `min_confidence`,
    `no_pii`) — no EM/request scope, the gap-04 single-source-of-truth for online + (future) offline gate.
  - `lib/eval/evalRuntimeService.ts` (`evaluateRun`): loads enabled deterministic assertions for the agent
    (`appliesTo` in `[agentId, '*']`), runs scorers, writes `AgentEvalResult` per assertion, stamps
    `run.evalScore`/`evalPassed` (AND of `gate` results; null when no gate; `warn` never blocks). Wired INLINE
    into `commands/trace.ts` after ingest; emits `run.evaluated`.
  - `api/agents/[id]/metrics`: window-scoped (24h|7d|30d|90d, default 30d) override rate + eval-pass rate +
    avg latency + total cost from this module's tables (gate `trace.view`; capped at 5000 rows → exact rollups
    in PR4). `setup.ts` `seedDefaults` now seeds tenant-scoped default deterministic assertions (idempotent).
  - Tests: `eval-scorers.test.ts` (4) + `eval-runtime.test.ts` (5, fake EM: gate-fail/gate-pass/warn-never-blocks/
    no-assertions) PASS → **102 module tests ✓**. `__integration__/TC-AGENT-TRACE-003.spec.ts` (metrics shape + window default).
  - Gate: `yarn generate` ✓ · core build ✓ · `yarn typecheck` ✓ · 102 tests ✓ · i18n 0 hits.
    `yarn lint` still fails only on pre-existing `apps/mercato` React-hooks errors (untouched).
  - **Decision:** eval runs inline in the trace COMMAND (not the pure `ingestTrace`) to keep ingestion pure and
    avoid trace→eval coupling; default assertions seeded per-tenant (proper tenant scope, unlike module_configs).
  - PRs 1–3 = trace capture + correction flywheel + deterministic eval. Remaining roadmap: PR 4 (llm_judge,
    rollups, partitioning — task #8 s3 offload too) + lifecycle/compliance overlays.
- 2026-06-23: **PR 4 (testable subset) — llm_judge async warn tier (code complete, NOT committed).**
  Scoped down after verifying APIs: the `scheduler` DI key was NOT found, so the persisted rollup table +
  periodic worker, span partitioning/retention, and the deferred s3 offload all move to **PR 4b (task #19)** —
  a periodic worker with no verified scheduler trigger + hand-authored partition DDL + S3 creds absent in
  dev/test was the wrong risk for this pass.
  - `lib/eval/sampling.ts`: pure `shouldSampleForJudge` (FNV-1a over runId, no Math.random) +
    `resolveJudgeSampleRate` (env `OM_AGENT_LLM_JUDGE_SAMPLE_RATE`, default 0.1, clamped).
  - `lib/eval/llmJudge.ts`: `createModelJudge` (`createModelFactory` + `generateObject`) + `runLlmJudgeForRun`
    (loads run + enabled `llm_judge` assertions, scores each, appends `warn` results; idempotent; NEVER touches
    `evalPassed`; pure over EM + injectable judge).
  - `lib/queue.ts` + `workers/llm-judge.ts` (`@open-mercato/queue` worker; best-effort). Enqueued from
    `commands/trace.ts` after deterministic eval for a SAMPLED subset when the agent has enabled llm_judge
    assertions (none by default — opt-in). Worker discovered in `modules.generated.ts`.
  - Metrics: added `approveUnchangedRate` + `disposedProposals` (anti-rubber-stamp, AI Act Art. 14) to
    `agents/[id]/metrics` from `AgentProposal` dispositions.
  - Tests: `eval-sampling.test.ts` (5) + `llm-judge.test.ts` (3) → **110 module tests ✓**.
  - Gate: `yarn generate` ✓ · core build ✓ · `yarn typecheck` ✓ · 110 tests ✓ · i18n 0 hits. No new entities/
    migration. `yarn lint` still only pre-existing app errors.
  - **Decision:** judge enqueued INLINE at ingest (sampling needs no scheduler); warn-only/best-effort, so a
    missing provider or queue failure never blocks ingestion or changes the gate verdict.
- **Overlay status:** PRs 1–4 (capture · flywheel · deterministic eval · llm_judge tier + anti-rubber-stamp)
  code-complete, NOT committed. Deferred: PR 4b (task #19) infra; then lifecycle/compliance overlays.
- 2026-06-23: **Operations-UI cockpit — Engineer trace inspector built (code complete, NOT committed).**
  Context: user reported "I don't see backend trace page" — the shipped `backend/traces` was a `navHidden`
  stub. The cockpit already had real Overview/Caseload(four-verb)/Agents/Playground pages + shared
  `components/`; only the Engineer trace surface was missing.
  - `backend/traces/page.tsx`: real run list over `GET /runs` (window 24h/7d/30d + facet all/eval-fail/
    low-confidence via SegmentedControl), rows → `/backend/traces/[id]`. (Backend pages are NOT module-
    namespaced — path is `/backend/traces`, mirroring `/backend/caseload`.)
  - `backend/traces/[id]/page.tsx`: run inspector — summary (status/eval/runtime/model/confidence/latency),
    span waterfall (indented by parent depth), tool calls, eval results, output (JsonDisplay).
  - `backend/traces/page.meta.ts`: unhid nav (`navHidden` removed), gated `trace.view`, added nav entry
    (`agent_orchestrator.nav.traces`, order 95) + icon. New `[id]/page.meta.ts`.
  - `GET /runs/:id` extended to also return `evalResults`. `components/types.ts` extended: `RunView` trace
    fields + `SpanView`/`ToolCallView`/`EvalResultView` + `mapSpan`/`mapToolCall`/`mapEvalResult`/`mapRunDetail`.
  - i18n: added `agent_orchestrator.nav.traces` + `agent_orchestrator.traces.*` to en.json (kept the module's
    existing NESTED en-only format; see note below).
  - Gate: `yarn generate` ✓ · `yarn typecheck` ✓ · `yarn build:app` ✓ · 110 tests ✓.
  - **Decision:** built as the module's own real backend pages (engineer surface) rather than widget-injecting
    into `workflows` My-Tasks — lower risk (the spec's top risk is unknown workflows spot ids) and self-contained.
  - **Pre-existing (NOT mine):** `i18n:check-sync` flags `agent_orchestrator` (nested format + missing
    pl/es/de) — the module shipped en-only/nested before this work (it was the 2nd module in the code-review's
    "8 issues across 2 modules" alongside `workflows`). Full flatten + 4-locale translation is a separate
    module-wide cleanup; I kept my keys consistent with the existing file rather than expand the gap.
  - **Remaining cockpit (optional):** Admin eval/override/approve-unchanged KPI tiles on Overview (task #21);
    "Open full trace" handoff link from the caseload proposal detail; guard-results panel (needs guardrails overlay).
- 2026-06-24: **Cockpit — Overview eval KPIs + trace handoff link (code complete, NOT committed).**
  - Overview: added a second KPI row — eval-pass rate, override rate, approve-unchanged rate (anti-rubber-stamp,
    AI Act Art. 14), all computed client-side from the already-loaded runs + proposals (no extra fetch; runs now
    mapped via `mapRun`). `approveUnchanged` tile turns `warning` at ≥90%.
  - Cross-persona handoff: "Open full trace" button on the caseload proposal detail → `/backend/traces/<runId>`.
  - i18n: added `overview.tiles.{evalPassRate,overrideRate,approveUnchanged}(+Meta)` + `proposal.openTrace`
    (sorted, en-only nested — same pre-existing format note as above).
  - Gate: `yarn typecheck` ✓ · `yarn build:packages` ✓ · `yarn build:app` ✓ · 110 tests ✓.
  - **Cockpit now covers:** Overview (KPIs incl. eval/quality) · Caseload four-verb + disposition + trace
    handoff · Agents registry · Playground · **Engineer trace inspector**. Not done: widget-injection into
    `workflows` My-Tasks (chose own pages) + guard-results panel (needs guardrails overlay).
