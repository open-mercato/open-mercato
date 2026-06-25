# Plan — Agent Orchestrator bug fixes (#3632, #3629, #3628)

> **Created:** 2026-06-26 · **Branch base:** `feat/agent-orchestrator-mvp` · **Owner:** Patryk Lewczuk
> **Triage source:** code-verified against the current branch (3 parallel investigations). All three are **real, still-present, and not fixed** on this branch.
> **PR split:** three independent PRs (different blast radius). Recommended merge order: **#3629 → #3632 → #3628.**

## Scope at a glance

| Issue | One-line | Surface | Risk | Effort | PR |
|---|---|---|---|---|---|
| #3629 | Playground run under "All organizations" stamps a phantom `organization_id` → proposal orphaned from caseload | 1 enterprise route + i18n | Medium | Small | PR-A |
| #3632 | INVOKE_AGENT workflow hangs at `start`; whole run wrapped in one txn whose outer catch re-throws → rollback of all bookkeeping | core `workflow-executor.ts` (every workflow) | Medium-High | Medium (design-sensitive) | PR-B |
| #3628 | OpenCode-runtime runs persist no spans/tool-calls (no DB trace) | enterprise runner + trace ingest wiring | Medium | Medium | PR-C |

---

## PR-A — #3629: org-scope correctness in the agent run route (do first)

**Verified root cause.** `POST /api/agent_orchestrator/agents/[id]/run` trusts **raw `auth.orgId`** and threads it straight to `createRun`/`createProposal`:
- `packages/enterprise/src/modules/agent_orchestrator/api/agents/[id]/run/route.ts:27,59` — guards on `auth.orgId` then sets `runCtx.organizationId = auth.orgId` with no scope resolution.
- Flows unchecked: `lib/runtime/agentRuntime.ts:153-184,356-364` → `lib/runtime/persistence.ts:48-75` → `commands/runs.ts:43-60` / `commands/proposals.ts:31`. Zod validates UUID **format** only; `agent_*.organization_id` has no FK (`data/entities.ts:51-52`), so any well-formed UUID persists.
- Under "All organizations" the org cookie is `__all__` → `resolveOrganizationOverride` maps to `null`, but `applySuperAdminScope` only applies the override for superadmins; otherwise `auth.orgId` keeps a **stale "home" org id** (the observed `284107f1-…`). The caseload (`api/proposals/route.ts:23-30`, built with `makeCrudRoute` → `resolveOrganizationScopeForRequest`) filters by the resolved selected org → phantom-org proposal never matches → orphaned.

**Fix approach (precedent: `resolveCustomersRequestContext`, `packages/core/src/modules/customers/lib/interactionRequestContext.ts:31-58`).**
1. In `run/route.ts`, replace raw `auth.orgId` with `resolveOrganizationScopeForRequest({ container, auth, request: req })`.
2. Use `scope.selectedId` as the run's `organizationId`.
3. **Fail closed** when `scope.selectedId` is null (All-orgs / no concrete selection): return a clear i18n'd 400/422 ("Select a single organization before running an agent") — do **not** stamp an ambiguous org. Satisfies the issue's "attribute to real org OR fail closed".
4. Audit the sibling entry point `lib/runtime/invokeAgentForWorkflow.ts` — confirm it derives org from the workflow process scope (not a raw value) before declaring it safe.

**Tests.**
- Integration: `__integration__/TC-AGENT-RUN-ORGSCOPE-<NNN>.spec.ts` — run the Playground route under "All organizations" → assert fail-closed response and **no** `agent_runs`/`agent_proposals` row written; run under a concrete org → row persists under the resolved org and is visible in `/api/agent_orchestrator/proposals`.
- Tenant-isolation: org B token cannot produce a proposal visible to org A.

**Files:** `api/agents/[id]/run/route.ts`, `i18n/*.json` (1 key), test. Possibly `invokeAgentForWorkflow.ts` if the audit finds the same defect.

**Labels:** `bug` `enterprise` `priority-high` `risk-medium` `needs-qa`.

---

## PR-B — #3632: workflow executor partial-commit / rollback defect

**Verified root cause (reporter's "local-queue dispatch" hypothesis REFUTED).** The POST handler advances inline via `setImmediate` (`api/instances/route.ts:215-224`), so the worker is irrelevant (the demo activity is synchronous). The real defect:
- `lib/workflow-executor.ts:574-576` — the **entire** start→assess→apply→end loop runs inside `em.transactional((trx) => runExecution(trx))`. Per-step `em.flush()` only flushes to the open txn; nothing is durable until commit.
- `lib/workflow-executor.ts:541-571` — the outer catch writes `status='FAILED'` into the same `trx` then **re-throws (line 570)**. Re-throwing out of `transactional` **rolls back** the FAILED write *and* every `step_instance`/event/`currentStepId` advance → instance reverts to the foreground-committed `RUNNING`/`start` row, 0 step_instances.
- The agent proposal survives because it commits on independent forked EMs (`lib/runtime/invokeAgentForWorkflow.ts:84`, `commands/dispose.ts:102,157-172`). Auto-approve sets `skipResume:true` (`dispositionService.ts:101`, `dispose.ts:237`) — correct, not a deadlock.
- History: the outer transaction came from `329b4dc0a` (#2428, PARALLEL_FORK) and **defeats** `bf258550c` (#2593, "persist FAILED status") — which is why failures are invisible (stuck RUNNING) rather than FAILED.

**Fix approach (design-sensitive — this path was hardened by #1391/#1452/#2428/#2593).**
1. Stop wrapping the whole multi-step, network-I/O-bound run in one long-held transaction. Options to evaluate: per-step transactions, or drop the outer txn so each `em.flush()` is durable incrementally (pre-#2428 behavior), or commit bookkeeping outside the rollback scope. **Must preserve** the PARALLEL_FORK serialization #2428 added (re-check the locking model).
2. Persist `FAILED` **durably** on error (restore #2593) instead of re-throwing into a rollback.
3. Fix the misleading `"Workflow execution started in background"` (`route.ts:233`) — it's an inline `setImmediate`, not a queue job; also `setImmediate` swallows errors (`route.ts:221`) — make failures observable.
4. Latent secondary (will surface once rollback is fixed): `apply` step interpolates `{{deal.id}}` while the agent step uses `{{context.deal}}` — likely needs `{{context.deal.id}}` in `examples/deals-health-check-workflow.json`.

**Tests.**
- Regression integration: start `agent_orchestrator_deals_health_check_v1` with high-confidence context → assert `step_instances` recorded for start/assess/apply/end, `current_step_id` advances, and the effector applies (deal `pipeline_stage` updated).
- Failure path: force a step error → assert instance ends `FAILED` durably (not stuck `RUNNING`) and the error is surfaced.
- Re-run the existing `TC-WF-*` suite (concurrency/locking regressions).

**Files:** `lib/workflow-executor.ts` (primary), `api/instances/route.ts` (message + error handling), `examples/deals-health-check-workflow.json` (template), tests. **Confirm** the `[WORKFLOW] Execution failed` log (`workflow-executor.ts:543`) during repro to pin the throwing statement (not required for the root-cause class).

**Labels:** `bug` `enterprise` `priority-high` `risk-high` `needs-qa`. Batch-candidate: #2292 (STEP_TYPE_NOT_IMPLEMENTED) lives in the same file — note but keep separate unless trivial.

---

## PR-C — #3628: OpenCode runner emits no trace (observability)

**Verified root cause (reporter's in-process contrast is INACCURATE).** `AgentSpan`/`AgentToolCall` are written in exactly one place — `lib/trace/traceIngestionService.ts:93,125` inside `ingestTrace()` — reachable only via `commands/trace.ts` ← `api/trace/ingest/route.ts` (HMAC webhook). **No production code emits a trace**: neither `openCodeAgentRunner.ts` nor the in-process `agentRuntime.ts#runInProcess` calls `ingestTrace`. The trace inspector is currently fed only by the external HMAC POST. The "in-process trace" the reporter saw is the in-memory chat LoopTracePanel (SSE), not DB rows.
- `lib/runtime/openCodeAgentRunner.ts` — `driveSession()` fires `sendMessage` fire-and-forget and **discards** the returned `OpenCodeMessage { parts }` (lines ~261-263); `subscribeIdle()` handles only `session.status` (line ~351), ignoring `message.part.updated`/`message.updated` which carry tool calls; captures only the final outcome.
- Data **is available**: `OpenCodeClient.sendMessage()` returns parts (`packages/ai-assistant/.../opencode-client.ts:62-70,353`); SSE emits `message.part.updated`; `getSession(id)` exists as a fallback.

**Fix approach.**
1. In `openCodeAgentRunner.ts`, capture tool-call/step parts — extend the SSE handler for `message.part.updated`/`message.updated`, or read the `sendMessage` return / `getSession` after completion (instead of discarding).
2. Map parts → the existing `traceIngestSchema` (`data/validators.ts`) using the already-stamped `externalRunId` (= OpenCode `session.id`) so the `(runtime, externalRunId)` upsert lands on the existing run row.
3. Persist via the audited path — dispatch `agent_orchestrator.trace.ingest` (or call `ingestTrace` with verified scope) at run completion, **best-effort** (trace failure must never fail the run). The `(runtime, externalRunId)` idempotency protects against a later external POST duplicating.
4. **Decision to confirm with module owner:** was runner-side trace emission intentionally deferred to an external adapter (F8 only stamped the correlation key)? If "make runners emit," apply the same to the in-process path so both runtimes populate `/backend/traces` consistently.

**Tests.**
- Integration: run an OpenCode agent → assert `agent_spans`/`agent_tool_calls` rows exist for the run and surface in the Playground "Tools & steps" panel + `/backend/traces`.
- Idempotency: a subsequent external trace POST for the same `(runtime, externalRunId)` does not duplicate.

**Files:** `lib/runtime/openCodeAgentRunner.ts` (primary), possibly `agentRuntime.ts` (in-process parity), `data/validators.ts` (reuse schema), tests. Tie to spec `next/2026-06-24-trace-eval-pr4b-and-followups.md` §F8 as a new follow-up item.

**Labels:** `bug` `enterprise` `priority-medium` `risk-medium`. (`needs-qa` if the Playground panel is exercised; else `skip-qa` is defensible since functional outcome is unchanged — decide at PR time.)

---

## Cross-cutting notes

- **Independent PRs** — no shared files across A/B/C, so they can proceed in parallel; merge order is by risk (A safest).
- **Conventions:** all writes via `useGuardedMutation`/`apiCall`; DS status tokens + i18n on any UI; `findWithDecryption` where reading agent entities; `yarn generate` after any `events.ts`/payload change; migrations via `yarn db:generate` (none expected here — all three are logic fixes, no schema).
- **#3632 is the design-sensitive one** — recommend `om-pre-implement`-style care on the executor change and a maintainer review of the transaction model before coding.

## Progress

- [x] PR-A (#3629) — org-scope fix + fail-closed + test (branch `fix/3629-agent-run-org-scope`; `run/route.ts` now resolves `resolveOrganizationScopeForRequest` and fails closed when no single org is selected; regression test `agent-run-org-scope.test.ts`, 3 cases; enterprise typecheck + 244 unit tests green)
- [x] PR-A — audit `invokeAgentForWorkflow.ts` org derivation — **safe, no change**: it takes `organizationId` from the workflow instance ctx (a persisted concrete org), not from live request header scope
- [ ] PR-B (#3632) — executor transaction/rollback fix + durable FAILED + message + template + tests
- [ ] PR-C (#3628) — OpenCode trace capture + ingest + tests (confirm in-process parity decision)
