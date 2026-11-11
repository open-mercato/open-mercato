# Version Pinning for Code-Defined Workflows

| Field | Value |
|-------|-------|
| Status | Draft |
| Issue | [#7184](https://github.com/open-mercato/open-mercato/issues/7184) |
| Related | `.ai/specs/implemented/2026-04-14-code-based-workflow-definitions.md` (revises its "WorkflowInstance (unchanged)" live-read decision), `.ai/specs/2026-06-26-subworkflow-explicit-ports-schema-builder.md` (DB draft/published versioning), #1444, #7183 |
| Module | `workflows` (`packages/core`), `@open-mercato/shared/modules/workflows` |

## 📝 TLDR

Module authors who ship workflows in `workflows.ts` cannot change a workflow's shape safely: every in-flight instance re-reads the **current** code definition on each step, so a deploy that renames or removes a step strands parked instances, and a rollback strands instances that already moved forward. `defineWorkflow({ version })` is accepted but inert. **Proposed (future behaviour):** the code registry keeps every exported version of a workflow; new starts use the highest version, and an in-flight instance resolves the version it persisted at start. A workflow exporting a single version behaves exactly as today, the persisted `definitionId` is unchanged, and no migration is needed.

## 📝 Problem Statement

Today (`packages/core/src/modules/workflows/lib/find-definition.ts`):

- `codeWorkflowUuid(workflowId)` hashes only the workflow id; every version of a code workflow shares one `definitionId`.
- `resolveCodeDefinitionForInstance` / `findDefinitionForInstance` rebuild the virtual definition from `getCodeWorkflow(workflowId)` — the **only** registered entry, i.e. the current code.
- `findWorkflowDefinition` ignores a requested `version` for code definitions ("version filter not applicable to code defs").
- The shared registry (`packages/shared/src/modules/workflows/code-registry.ts`) is a `Map<workflowId, CodeWorkflowDefinition>`; exporting a second `defineWorkflow` with the same `workflowId` silently overwrites the first.

Yet the engine already persists the started version: `WorkflowInstance.version` is written from `definition.version` in `startWorkflow` (`lib/workflow-executor.ts`). The data needed for pinning exists; resolution ignores it.

Evidence it matters: the issue reporter's production app freezes step/transition ids per `workflowId` (enforced by a test) and forks a new `workflowId` for every shape change, letting old instances drain. That workaround fragments triggers, reporting and the definitions list. DB-defined workflows already have immutable published versions (`(workflowId, version, tenantId)` unique, draft/published lifecycle); code-defined workflows are the only definitions without them.

## 📝 Proposed Solution

1. **Multi-version code registry.** The shared registry stores `Map<workflowId, Map<version, CodeWorkflowDefinition>>`. A module retains an old version simply by keeping its `defineWorkflow({ workflowId, version: N, … })` export in the `workflows` array next to version `N+1`. No new authoring API; `version` (already on the type, default `1`) becomes meaningful.
2. **Latest for new starts.** Every existing "which code workflow is this?" read — `getCodeWorkflow(workflowId)`, `getAllCodeWorkflows()`, triggers, the definitions list, customize, reset-to-code, context-schema, test-step — returns the **highest registered version**. For a single-version workflow this is the same object as today.
3. **Pinned for in-flight instances.** `resolveCodeDefinitionForInstance` / `findDefinitionForInstance` resolve `getCodeWorkflowVersion(workflowId, instance.version)`. `findWorkflowDefinition({ workflowId, version })` with an explicit version (sub-workflow pins) resolves that exact code version.
4. **Identity unchanged.** `definitionId` stays `codeWorkflowUuid(workflowId)` for every version; the pin is `(definitionId, instance.version)`, both already persisted. No migration, no change to existing instance rows.
5. **Missing pinned version.** When the requested/persisted version is not registered (an old version was deleted from code, or a legacy instance predates retention), resolution falls back to the highest registered version — exactly today's behaviour — and emits a once-per-process `logger.warn` keyed by `(workflowId, version)`. This applies uniformly to in-flight resolution and to explicit-version starts (sub-workflow pins, `POST /api/workflows/instances` with `version`), both of which already get "latest" today.
6. **Fix two direct lookups that bypass the code fallback.** `activity-worker-handler.ts` (resume of a SUB_WORKFLOW parent: `em.findOne(WorkflowDefinition, { id: parent.definitionId })`) and `step-handler.ts` `emitStepMilestone` load the definition by row id only, so a **code-defined** parent/instance gets `null` today (lost `outputMapping`, no milestone event). Both route through `findDefinitionForInstance`, which makes them version-pinned too. This is a pre-existing defect the feature cannot work without, so it is in scope.

A strict mode (fail instead of falling back) is **deferred**: today a `null` definition makes `executeWorkflow` throw `DEFINITION_NOT_FOUND` without marking the instance FAILED, and the error handler / compensation also need the definition, so a strict miss would strand the instance in RUNNING/PAUSED. Strict needs its own terminal-failure path and is a follow-up.

### Alternatives considered

| Option | Why it lost |
|--------|-------------|
| Version-qualified identity: `codeWorkflowUuid(workflowId, version)` as `definitionId` | Changes a persisted identity: every existing instance carries the unversioned hash and would need a dual-resolution path forever; breaks `GET /api/workflows/definitions/:id`, the concurrency-limit count in `loadCodeTriggers`, and the context-schema `codeWorkflowUuid` fallback, which all assume one id per code workflow. `instance.version` already discriminates versions. |
| Snapshot the code definition into a DB row at first start | Pins perfectly but turns every code workflow into a persisted row per tenant, collides with the "DB row with `codeWorkflowId` = user customization" meaning, and reintroduces the shadowing problem fixed by `Migration20260716120000`. |
| Document `version` as inert + per-instance migration hook (issue's fallback) | Leaves the correctness problem with every module author; a migration hook is still needed for genuine shape changes and can be layered later on top of retention. Deferred, not rejected. |
| Strict (fail) when a pinned version is missing — default or opt-in | As default it would fail every legacy in-flight instance whose module bumped `version` before this feature. As an opt-in it needs a terminal-failure path that does not exist today (see item 5 note). Deferred. |

## 📝 Architecture

```mermaid
flowchart LR
  A["module workflows.ts<br/>defineWorkflow v1, v2 (existing)"] --> G["workflows.generated.ts<br/>allCodeWorkflows (unchanged)"]
  G --> R["shared code-registry<br/>workflowId → version → def (CHANGED)"]
  R -->|latest| S["startWorkflow / triggers / definitions API (unchanged callers)"]
  R -->|instance.version| I["findDefinitionForInstance → step/transition/signal/timer/task handlers (CHANGED resolution)"]
```

Takeaway: the generator and every caller keep their signatures; only the registry's storage and the two instance-resolution functions change.

**Shared (`packages/shared/src/modules/workflows/code-registry.ts`)** — additive exports:
- `getCodeWorkflowVersion(workflowId: string, version: number): CodeWorkflowDefinition | undefined`
- `getCodeWorkflowVersions(workflowId: string): CodeWorkflowDefinition[]` (ascending by version)
- `getCodeWorkflow`, `getAllCodeWorkflows`, `isCodeWorkflow` keep their signatures and return the latest version.
- `registerCodeWorkflowEntries`: duplicate `(workflowId, version)` keeps today's overwrite-with-warning; a different `moduleId` contributing a version of an existing `workflowId` logs the same warning (ownership is per `workflowId`).
- "Latest" = highest registered version regardless of its `enabled` flag (the unpinned start path keeps its existing `enabled` gate). A version dropped by validation is simply not registered.
- Storage location (module-scope map) is unchanged; moving it to `globalThis` is unrelated and out of scope.

**Core bridge (`packages/core/src/modules/workflows/lib/code-registry.ts`)** — re-export the two new functions next to the existing four.

**Types / builder** — no change. `version` already exists on `WorkflowBuilderConfig` and `CodeWorkflowDefinition` (default `1`).

**Core (`packages/core/src/modules/workflows/lib/find-definition.ts`)**:
- `resolveCodeDefinitionForInstance(instance)` — instance param type gains optional `version?: number`. UUID-equality gate unchanged. Resolution: exact version → else latest + warning. Absent `version` → latest (BC for any external caller passing a narrower object).
- `findDefinitionForInstance` — passes `version` through (internal callers already pass the full `WorkflowInstance`).
- `findWorkflowDefinition({ version })` for code: exact version when registered, else latest + warning (today's result). Unpinned path unchanged (latest + `enabled` gate).
- `activity-worker-handler.ts` SUB_WORKFLOW parent resume and `step-handler.ts` `emitStepMilestone` switch from `em.findOne(WorkflowDefinition, { id })` to `findDefinitionForInstance` (DB rows resolve exactly as before).
- `buildVirtualCodeDefinition` unchanged; `virtual.version` now reflects the resolved version.
- Disabled flags: an old retained version's `enabled` flag is ignored for in-flight resolution, matching the existing rule that disabling blocks new starts, not running instances.

**Validation** — `registerCodeWorkflows` already validates each entry independently; each retained version is validated on its own. A retained version that fails validation is dropped with the existing warning, which then falls under the missing-version fallback.

**Cross-module coupling** — none added.

**Customization** — `customize` and the `[id]` PUT override path copy the **latest** code version (`existingOverride.version = codeDef.version`). A DB override created at v1 and re-customized after v2 ships therefore moves to v2; instances started on the DB row are unaffected because they resolve by row id. Instances started on the code UUID keep resolving code versions by `instance.version` even after a customization exists. `reset-to-code` removes the override; new starts return to the latest code version.

## 📝 Data Model

No schema change and no migration. Relies on existing columns: `workflow_instances.definition_id`, `workflow_instances.workflow_id`, `workflow_instances.version` (non-null, written at start).

## 📝 API Contracts

Additive only:

- `GET /api/workflows/definitions/:id?version=N` — new optional query param, honoured only when `:id` resolves to a code definition (the `code:<workflowId>` form or the `codeWorkflowUuid` form). Returns that retained version's serialized definition; `404` when not registered (no fallback — the read API reports what exists). Ignored for DB rows (those already have one row per version). OpenAPI `query` schema updated. Validation: `z.coerce.number().int().positive().optional()`.
- Code-definition serialization (`serializeCodeWorkflowDefinition`) gains additive `retainedVersions: number[]` so the definitions list/detail can show which versions are still loadable. Existing fields unchanged.

Not changed: start/instances APIs, event payloads (`workflows.instance.*` already carry `version`), trigger shapes, `workflows.generated.ts`.

## 📝 UI/UX

Minimal, read-only:
- Instance detail (`backend/instances/[id]/page.tsx`) fetches `/api/workflows/definitions/${instance.definitionId}?version=${instance.version}` so the graph shown is the one the instance runs. On `404` it falls back to the unversioned fetch (today's behaviour) — the instance is running on the latest version via the fallback.
- Definition detail for a code workflow shows a "Retained versions: 1, 2" line from `retainedVersions` (i18n key `workflows.definitions.retainedVersions`).

No new pages, forms or dialogs; no mockups needed (text-only spec).

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| Single-version workflow (all existing modules) | Identical to today: latest == only version; instance.version matches. Regression test. |
| Module bumped `version` before this feature, never retained old one; instance persisted `N`, code has `N+1` | Fallback → runs `N+1` (today's behaviour) + one warning per process. |
| Old version deleted while instances still parked on it | Same as above; author is warned. Operational guidance: keep a version exported until `instances where version = N and status in (RUNNING, PAUSED, WAITING…)` is empty. |
| Rollback deploy: code goes back to a build that only knows `N`, instances already started on `N+1` | `N+1` missing → they fall back to `N` with a warning. Documented guidance: roll forward instead — keep `N+1` retained and re-export `N`'s shape as `N+2` so new starts use it. Not automated. |
| Retained version references an activity/handler that no longer exists | Unchanged from today: failure surfaces at that step. Out of scope (no versioning of activity handlers). |
| Sub-workflow pinned to code version `V` | Resolves exactly `V` when retained; otherwise latest + warning (today's result). |
| Code-defined SUB_WORKFLOW parent resumes after child completes | Parent definition now resolves through `findDefinitionForInstance` at `parent.version` (today: `null`, output mapping lost). |
| Trigger-started instance | `loadCodeTriggers` stamps `workflowVersion` from the latest; start resolves that exact version. `maxConcurrentInstances` counts by `definitionId`, i.e. across all versions of the workflow (unchanged semantics, now explicit). |
| User customizes a code workflow while instances run on old code versions | Those instances keep resolving code versions by `instance.version` (their `definitionId` is the code UUID, not the new row). |
| Two modules register the same `workflowId` | Today's warning-and-overwrite per `(workflowId, version)`; versions from both are merged. Not a supported configuration. |
| Duplicate `(workflowId, version)` within one module | Last wins with warning (today's semantics). |

## 📝 Risks & Impact Review

- **Contract surfaces (`BACKWARD_COMPATIBILITY.md`)**: shared exports — additive functions, unchanged signatures; types — one optional field; API — one optional query param + one additive response field; DB — none; generated files — unchanged. No deprecation required.
- **Behavioural change**: a workflow that exports several entries with the same `workflowId` today gets "last wins"; after this change it gets "highest version wins for new starts". Only affects modules that already export duplicates, which today is a warned misconfiguration.
- **Pre-existing defect fixed in passing**: code-defined SUB_WORKFLOW parents and milestone emission currently resolve no definition; routing them through `findDefinitionForInstance` changes behaviour for code workflows only (from broken to working). DB-row behaviour is identical.
- **Memory**: retained versions stay in memory; negligible (definitions are small JSON) and bounded by what authors export.
- **Product direction call (not a rule violation)**: retention is manual (author keeps old exports). Automatic drain detection / a migration hook is deferred.
- Rollback of this feature: revert restores latest-only resolution — exactly today's behaviour; no data to undo.

## Resolved assumptions (autonomous defaults)

| # | Question | Default chosen | Rationale |
|---|----------|----------------|-----------|
| Q1 | Change `definitionId` to a version-qualified hash, or keep it and pin via `instance.version`? | Keep `codeWorkflowUuid(workflowId)`; pin via persisted `instance.version`. | No persisted-identity change, no migration, all existing instances resolve unchanged. |
| Q2 | How do old versions stay resolvable? | Author keeps exporting `defineWorkflow({ version: N })` beside `N+1`; registry indexes by `(workflowId, version)`. | Reuses the existing authoring API and generator; no new contract. |
| Q3 | What happens when a pinned version is gone? | Fall back to latest + once-per-process warning; strict mode deferred. | Preserves today's behaviour for legacy instances; a strict miss would strand instances until a terminal-failure path exists. |
| Q4 | Which version do triggers, list, customize, context-schema use? | Latest. | Matches "new starts use latest"; single-version behaviour identical. |
| Q5 | Add a per-instance migration hook (issue's alternative)? | No — deferred. | Smallest scope that satisfies "Done when"; can layer on later. |
| Q6 | Should the instance view show the pinned graph? | Yes, via additive `?version=` read param with fallback. | Otherwise the admin sees a graph the instance is not running; additive and read-only. |
| Q7 | Split into several specs? | No; Phase 2 ships as a separate PR. | Registry + resolution are one capability; the read param/UI is visibility on top of it. |

## 📋 Phasing

- **Phase 1 — Engine pinning** (independently shippable; satisfies the issue's "Done when"): multi-version registry, fallback, instance/sub-workflow resolution, direct-lookup fixes, unit + integration tests.
- **Phase 2 — Visibility**: `?version=` read param, `retainedVersions`, instance-detail fetch, docs.

## 📋 Implementation Plan

### Phase 1 — Engine pinning

1. **Shared registry** — store `workflowId → version → def`; add `getCodeWorkflowVersion`, `getCodeWorkflowVersions`; latest-returning `getCodeWorkflow`/`getAllCodeWorkflows`/`isCodeWorkflow`. Unit tests: single version identical; two versions → latest; exact lookup; duplicate warning.
2. **Core bridge** — re-export `getCodeWorkflowVersion` / `getCodeWorkflowVersions` from `lib/code-registry.ts`.
3. **Resolution** — `resolveCodeDefinitionForInstance` / `findDefinitionForInstance` / `findWorkflowDefinition({ version })` per Architecture, with once-per-process warning. Unit tests: instance v1 resolves v1 steps while v2 is latest; new start resolves v2; missing version → latest + single warning; absent `instance.version` → latest; UUID gate still rejects foreign ids; latest picked regardless of `enabled`.
3a. **Direct lookups** — SUB_WORKFLOW parent resume (`activity-worker-handler.ts`) and `emitStepMilestone` (`step-handler.ts`) via `findDefinitionForInstance`. Unit tests: code-defined parent resumes with its `outputMapping`; DB parent unchanged; milestone emitted for a code workflow.
4. **Executor regression** — unit test through `startWorkflow` + `executeWorkflow` with mocked em: instance started on v1, registry re-registered with v1+v2, next transition follows v1's graph; single-version workflow path unchanged.
5. **Integration test** (`packages/core/src/modules/workflows/__integration__/TC-WF-0xx.spec.ts`, run via `yarn test:integration:ephemeral` only) — fixture in the example module's `workflows.ts`, registered only when `OM_INTEGRATION_TEST` is set: `example.version-pinning-fixture` exported at v1 and v2 (different step ids). Asserts: `POST` start → instance `version: 2` and v2 step ids; existing single-version example workflow still starts with `version: 1`; definitions list shows the fixture once (latest). Pinning of in-flight v1 instances is proven by the step-4 executor test (an integration test cannot create a v1 instance without a test-only write path). Self-contained, cleans up its instances.

### Phase 2 — Visibility

6. **Read API** — `?version=` on `GET /api/workflows/definitions/[id]` for code ids + OpenAPI; `retainedVersions` in `serializeCodeWorkflowDefinition`. Integration test (same TC): `?version=1` returns v1 step ids, `?version=99` → 404, `retainedVersions` = `[1, 2]`.
7. **Instance detail** — versioned fetch with unversioned fallback; i18n key for "Retained versions". Unit test for the fetch helper.
8. **Docs** — update `apps/docs` workflows code-definitions page and the implemented code-definitions spec's "WorkflowInstance" section (pointer to this spec); author guidance: keep a version exported until no non-terminal instance references it; the fallback warning and what it means.

## Final Compliance Report

- Tenant scoping: unchanged — virtual definitions are still stamped with the instance's tenant/org; the read param is behind the existing route guards and tenant filter.
- BC: additive exports, no type change, one optional query param, one additive response field; no DB/event/generated-file change (see Risks).
- Tests: unit (registry, resolution, executor), integration via the ephemeral runner with an `OM_INTEGRATION_TEST`-gated example-module fixture.
- i18n: one new key; no hard-coded strings. No new error swallowing (warnings are logged, not caught errors).

## Changelog

- 2026-11-11 — Initial draft from issue #7184 (autonomous defaults).
- 2026-11-11 — Fresh-context review: deferred strict mode (would strand instances), added the two direct-lookup sites and the core bridge, clarified start-time and customization semantics, dropped the `globalThis` move.
