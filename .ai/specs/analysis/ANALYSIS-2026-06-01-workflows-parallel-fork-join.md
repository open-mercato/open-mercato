# Pre-Implementation Analysis: Parallel Fork / Join for the Workflows Engine

> Target spec: `.ai/specs/2026-06-01-workflows-parallel-fork-join.md`
> Analysis date: 2026-06-02 · Scope: OSS · Module: `packages/core/src/modules/workflows/`
> Method: full spec read + `BACKWARD_COMPATIBILITY.md` (13 surfaces) + `.ai/lessons.md` + workflows/core AGENTS.md + code verification via Explore agents.

## Executive Summary

The spec is **high quality, BC-conscious, and largely implementation-accurate** — every structural claim it makes about the engine was verified against the code (single-token loop picking `validAutoTransitions[0]`, `STEP_TYPE_NOT_IMPLEMENTED` throw, instance-level resume in signal/timer/activity paths, instance-level LIFO compensation). All schema changes are genuinely additive. **No critical blockers.**

Two findings should be resolved **before** implementation, and a handful of gaps should be folded into the spec:

1. **The regression gate is weaker than the spec assumes.** TC-WF-001..013 are **Playwright integration/UI tests** (e.g. TC-WF-001 = "Event Pattern Autocomplete"), not engine unit tests. The token-abstraction refactor (the riskiest part) needs **engine-level unit regression coverage** of the existing single-token paths, authored *before* the refactor — not just the existing browser tests.
2. **`stepHandler` / `transitionHandler` are DI-registered services** (`di.ts`), and the spec refactors their functions from `(em, instance, …)` to operate on a token. Per BC surface #9 (DI service interfaces are STABLE), the existing resolved-service signatures must be preserved (keep instance-based entry points, add token-aware functions) rather than changed in place.

Recommendation: **Needs minor spec updates first** (clarify validation location, regression-test strategy, DI-signature preservation, in-flight job compatibility), then proceed to `implement-spec`. The design itself is sound.

## Backward Compatibility

The spec contains a dedicated **Backward Compatibility** section (lines 236–243), satisfying the deprecation-protocol requirement that contract-surface PRs reference a spec with BC analysis. Audit across all 14 surfaces:

### Violations / Watch-items Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 9 | DI Service interface | `stepHandler` (`executeStep(em, instance, …)`, `enterStep(em, instance, …)`) and `transitionHandler` (`executeTransition(em, container, instance, …)`) are registered DI services (`di.ts:17-27`). The spec's "token abstraction" refactor changes what these operate on. Changing the resolved-service signature in place is a STABLE-surface break. | **Warning** | Keep existing instance-based exported signatures as the public contract (root-token adapter is constructed *inside* them); add new branch/token-aware functions alongside. Do **not** repurpose the exported function arguments. Add a regression test resolving `stepHandler`/`transitionHandler` from DI with the old signature. |
| 2 | Type definition (`WorkflowInstanceStatus`) | Adding `FORKED` is additive (allowed), but exhaustive `switch` consumers on status that lack a `default` will not handle it. | **Warning (low)** | Allowed as additive. Ensure all internal switches over `WorkflowInstanceStatus` have a safe default; document `FORKED` in the status state-machine docs. |
| 7 | API route response | `instances/[id]` detail gains a `branches` array; `tasks/[id]/complete` becomes branch-aware. | **OK (additive)** | Additive response fields only — no removed fields, no method change. Confirm the detail response schema documents `branches` as optional. |

### Confirmed Non-Violations (additive / unchanged)

- **DB schema (#8, ADDITIVE-ONLY):** new table `workflow_branch_instances`; new **nullable** columns (`UserTask.branch_instance_id`, `WorkflowEvent.branch_instance_id`, `WorkflowInstance.active_fork_step_id`); new enum value `FORKED`; new indexes. No renames, no type narrowing, FK-by-id, tenant/org scoped. ✓
- **Event IDs (#5):** 5 new IDs (`workflows.branch.*`, `workflows.join.completed`) — verified none exist today (current set is 20 events, all `as const`). ✓
- **`data/validators.ts` (#1):** `config` is `z.record(z.string(), z.any()).optional()` (validators.ts:265-282). Adding FORK/JOIN `superRefine` checks is additive and does **not** narrow existing schemas. ✓
- **`WorkflowEvent.eventType`** is a plain `z.string().min(1).max(50)` (validators.ts:615), not an enum — new internal types (`PARALLEL_FORK_OPENED` … `PARALLEL_FORK_FAILED`, all ≤25 chars) need **no schema change**. ✓
- **Public executor DI methods** (`startWorkflow`, `executeWorkflow`, `resumeWorkflowAfterActivities`, `completeWorkflow`) keep signatures; new branch logic is internal. ✓
- **ACL (#10):** no feature renames; FORK/JOIN is engine-internal — no new ACL features required (existing `workflows.instances.*` / `workflows.tasks.*` / `workflows.signals.send` gate the branch-aware paths; `admin: ['workflows.*']` wildcard covers any future addition). ✓
- Import paths, widget spot IDs (Phase 4 adds nodes, renames nothing), notification IDs, CLI, AI registries, generated-file contracts: untouched. ✓

### Missing BC Section
Present and adequate. Minor: rename the section header to **"Migration & Backward Compatibility"** to match the spec-writing convention, and add the DI-signature-preservation note (item #9 above) explicitly.

## Spec Completeness

### Missing / Weak Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| API Contracts | The `instances/[id]` detail response shape with `branches` and the branch-aware `tasks/[id]/complete` / `signal` request bodies are described prose-only. | Add a short "API Contracts" subsection: the additive `branches[]` response field shape and confirm request bodies are unchanged (branch is resolved server-side from the task/signal, not passed by the client). |
| Final Compliance Report | Spec-writing checklist output is absent. | Add a brief compliance checklist before implementation sign-off. |
| Risk severity ratings | Risks table (lines 291–299) lists risk/mitigation but no severity. | Add a severity column (High/Med/Low) — see Risk Assessment below. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Definition validation ("extend save-time validation / `start-validator`", line 141) | `lib/start-validator.ts` only evaluates **START-step preconditions at runtime** — it is *not* where definition structure is validated. FORK/JOIN pairing/convergence/no-nesting belongs in `workflowDefinitionDataSchema` (validators.ts) and/or the `definitions` create/update route. | Reword the spec: graph validation = a `superRefine` on `workflowDefinitionDataSchema` (additive), enforced at save time by `POST/PUT /api/workflows/definitions`. Drop the `start-validator` reference for this. |
| Regression strategy (Phase 2, step 3) | "TC-WF-001..013 regression must pass unchanged" — but these are Playwright/UI integration tests (`__integration__/TC-WF-0NN.spec.ts`), several UI-only (TC-WF-001 = editor autocomplete). They do **not** unit-cover the executor's single-token semantics. | Add engine-level **unit** tests for the existing single-token execute loop (AUTOMATED chain, USER_TASK pause/resume, async-activity resume, compensation LIFO) as the real refactor safety net, authored before/with the token refactor. Keep TC-WF-001..013 as a secondary gate. |

## AGENTS.md Compliance

The spec aligns with workflows/core AGENTS.md. Confirmations and reminders for implementation:

| Rule | Status / Note |
|------|----------------|
| Resolve via DI; never call lib functions directly | ✓ Spec keeps DI services; preserve `stepHandler`/`transitionHandler` resolved signatures (BC #9). |
| Event sourcing — no state mutation without an event | ✓ Spec logs `PARALLEL_*` events for every branch state change. Enforce for `CANCELLED`/`FORKED` transitions too. |
| Declare new events in `events.ts` with `as const`, run `yarn generate` | ✓ Spec step 9. |
| Scope all queries by `organization_id`; never cross-tenant | ✓ Branch entity carries `tenant_id`/`organization_id`; TC-WF-020 covers it. **Enforce in every branch/task/timer lookup** (lesson: tenant scoping). |
| Idempotent activity handlers / resume | ✓ Per-branch resume must be idempotent (a re-delivered timer/queue job must not double-advance a branch). |
| Entity + migration workflow (`yarn db:generate`, keep only intended SQL, update `.snapshot-open-mercato.json`, do not `yarn db:migrate`) | ✓ Spec line 125-127 matches. |
| `withAtomicFlush` when mutating entities across phases that include queries on the same EM | ⚠️ The interleaved loop mutates branch rows and re-queries siblings under one transaction — use `withAtomicFlush` (or the existing pessimistic-lock transaction) to avoid the identity-map stale-write trap (lessons.md "Flush entity updates before…"). |
| DS rules (Phase 4 nodes) | ✓ Spec mandates semantic tokens, no hardcoded colors, lucide icons, i18n en/es/de/pl. Defer with Phase 4. |

No DIY substitutions detected (no raw fetch, no hand-rolled encryption, no raw Redis). FORK/JOIN handle no PII directly — encryption maps not implicated.

## Risk Assessment

### High
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Token-abstraction refactor regresses existing single-token execution | Every existing workflow breaks | Author engine-level unit tests for current paths *first* (not just UI TC-WF-001..013); 1:1 root-token adapter; keep DI signatures. |
| Per-branch resume hits the wrong token after deploy | Stuck/duplicated branches; data integrity | `branch_instance_id` on `UserTask`/`WorkflowEvent`/job payloads; idempotent resume; **in-flight job compatibility** (below). |

### Medium
| Risk | Impact | Mitigation |
|------|--------|-----------|
| In-flight queued jobs (timer/async-activity) enqueued *before* deploy lack `branchInstanceId` | Resume crashes or no-ops post-deploy | Treat missing `branchInstanceId` as instance-level resume (the current behavior) — explicit fallback, covered by a test. |
| `maxIterations = 100` counted per loop pass in interleaved mode (workflow-executor.ts:290) | N branches × deep paths can exhaust the budget and falsely abort | Make the cap branch-aware (per-branch budget) or raise/justify it; add a test with 3 branches × long chains. |
| Double-JOIN firing under concurrent branch resumes | Duplicate continuation after JOIN | Wait-all counted under the existing pessimistic instance lock + single transaction (spec already states this — verify the lock wraps the branch reads). |
| Sibling cancellation leaves orphaned `UserTask`/timers | Stale inbox tasks / firing timers after instance FAILED | Best-effort cancel + log (spec line 299); add assertion in TC-WF-017. |

### Low
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `WorkflowInstanceStatus` consumers without exhaustive `default` miss `FORKED` | Minor UI/label gaps | Audit switches; add i18n + status mapping for `FORKED`. |
| `outputMapping` path syntax underspecified | Author confusion | Define the path grammar (dotted `branches.<key>.<field>` → top-level key) in the spec. |
| Branch read-context snapshot ("instance.context at fork time") storage unspecified | Ambiguous merge semantics | Specify where the fork-time snapshot lives (read merged view `{...instanceContext, ...branchNamespace}`; writes only to namespace — spec line 185-186 implies this; make it explicit). |

## Gap Analysis

### Critical Gaps (Block Implementation)
- None.

### Important Gaps (Should Address before/within spec update)
- **Validation location** belongs in `workflowDefinitionDataSchema` + definitions route, not `start-validator` (see Incomplete Sections).
- **Engine unit-test regression baseline** for single-token paths (see Risk High-1).
- **In-flight job backward compatibility** for timer/async payloads lacking `branchInstanceId` (Risk Medium).
- **DI signature preservation** for `stepHandler`/`transitionHandler` (BC #9).
- **`maxIterations` semantics** in interleaved mode (Risk Medium).

### Nice-to-Have Gaps
- Optional in-app **notification on branch/instance failure** (the module already has a task-assignment notification type; reuse the pattern if desired).
- Per-branch timeline rendering in the instance viewer (Phase 4 already lists it).
- Explicit `outputMapping` grammar and fork-time context snapshot semantics.

## Remediation Plan

### Before Implementation (Must Do)
1. **Update the spec**: (a) move FORK/JOIN graph validation to `workflowDefinitionDataSchema`/definitions route; (b) state that `stepHandler`/`transitionHandler` DI signatures are preserved with new token-aware functions added alongside; (c) add the in-flight-job fallback rule; (d) clarify `maxIterations` budget in interleaved mode; (e) rename BC header to "Migration & Backward Compatibility".
2. **Plan the engine unit-test baseline** for current single-token execution as the refactor's real regression gate (the existing TC-WF-001..013 are mostly UI/integration).

### During Implementation (Add to Spec / enforce)
1. Wrap interleaved branch mutations + sibling re-queries in the existing locked transaction / `withAtomicFlush`.
2. Scope every branch/task/timer query by `tenant_id` + `organization_id`; assert in TC-WF-020.
3. Log a `PARALLEL_*` event for every branch state change (event-sourcing rule).
4. Idempotent per-branch resume for USER_TASK / signal / timer / async-activity.
5. Add the additive `branches[]` field to the `instances/[id]` detail response (document as optional).

### Post-Implementation (Follow Up)
1. Document `FORKED` in the instance state-machine docs and add i18n/status mapping.
2. Consider branch-failure notification + per-branch analytics (ties to roadmap WF-3).
3. Phase 4 visual editor (may split to its own spec) with DS-compliant nodes and full i18n.

## Recommendation

**Needs minor spec updates first**, then ready to implement. The architecture (persistent branches, BPMN-interleaved single-lock execution, wait-all JOIN, namespaced context merge, sibling cancellation + instance-level saga) is sound and fits the existing engine cleanly; all schema changes are additive and BC is well-considered. Resolve the five "Important Gaps" — chiefly the **engine-level regression baseline** and the **DI-signature preservation** — and the implementation risk drops to routine. Proceed to `implement-spec` after the spec edits.

---

### Verified codebase references
- Step types incl. `PARALLEL_FORK`/`PARALLEL_JOIN`: `data/entities.ts:14-23`; statuses (no `FORKED` yet): `data/entities.ts:25-33`; `WorkflowInstance.currentStepId/context/pendingTransition`: `:241/:244/:271`; `UserTask`/`WorkflowEvent` (no branch column; `eventType` plain string): `:376-449`/`:465-492`/`validators.ts:615`.
- Single-token loop `validAutoTransitions[0]`: `lib/workflow-executor.ts:382`; `maxIterations=100`: `:290`; `STEP_TYPE_NOT_IMPLEMENTED`: `lib/step-handler.ts:341-348`; `executeStep`/`enterStep` take instance: `:196`/`:67`; `executeTransition` takes instance: `lib/transition-handler.ts:306`; LIFO instance-level compensation: `lib/compensation-handler.ts:238-250`; instance-level resume: `lib/signal-handler.ts:247`, `lib/timer-handler.ts:212`, `lib/workflow-executor.ts:643`.
- Events (20, `as const`): `events.ts:8-42`; DI services incl. `stepHandler`/`transitionHandler`: `di.ts:17-27`; ACL (18 features, `workflows.*` admin wildcard): `acl.ts:3-24`, `setup.ts:12-14`; regression tests are Playwright: `__integration__/TC-WF-001..013.spec.ts`; API routes present: `api/instances/route.ts`, `api/instances/[id]/route.ts`, `.../advance`, `api/tasks/[id]/complete`, `api/instances/[id]/signal`, `api/definitions/route.ts`.
