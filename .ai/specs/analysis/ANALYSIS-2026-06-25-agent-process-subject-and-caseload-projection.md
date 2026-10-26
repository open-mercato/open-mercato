# Pre-Implementation Analysis: Agent Process — Subject Reference & Caseload Projection

> **Spec:** `.ai/specs/enterprise/agent-orchestrator/next/2026-06-25-agent-process-subject-and-caseload-projection.md`
> **Analyzed:** 2026-06-26 · **Method:** code-grounded verification (3 parallel Explore passes) against `packages/enterprise/src/modules/agent_orchestrator/` + `packages/core/src/modules/workflows/` + `BACKWARD_COMPATIBILITY.md` + `.ai/lessons.md` + the code-review checklist.

## Executive Summary

The spec is **architecturally sound and fully additive** — no backward-compatibility violations, and every convention it leans on (entity decorators, bigint/jsonb columns, `@Unique` composite indexes, `makeCrudRoute` list routes, per-method `metadata`, ACL/`defaultRoleFeatures`, subscriber shape, `encryption.ts`) is confirmed present and matches. The caseload page genuinely does the "live cross-join compute" the spec claims it replaces.

**But it is not yet ready to implement as written.** One assumption is **wrong and blocking**: the projection is designed to be maintained by a "workflows instance lifecycle signal," yet the `workflows` module **declares `workflows.instance.*` events but never emits them** — they are not on the event bus. A second, subtler blocker is a **design contradiction**: the spec wants to SQL-filter/sort on `subject_facets` (High value / Fraud flagged) while the module's `encryption.ts` precedent would have those fields encrypted (unqueryable). There is also a **factual ACL error** (it references a feature id that doesn't exist). Recommendation: **Needs spec updates first** — not a major revision; the core read-model design survives, but it must (a) resolve where lifecycle/assignment signals come from, (b) split filterable facets from encrypted free-text, and (c) fix the ACL id. The cleanest path is to **phase** the build: an agent-event-driven projection ships now; the workflow-dependent fields follow once `workflows` emits its declared events.

## Backward Compatibility

### Violations Found

**None.** Every change the spec proposes is additive per `BACKWARD_COMPATIBILITY.md`:

| Surface | Change | Classification |
|---|---|---|
| DB schema | New table `agent_processes` (new entity) | ✓ ADDITIVE (§8 — new tables OK) |
| DB schema | No change to `agent_runs`/`agent_proposals` columns | ✓ none |
| Event payloads | Adds `processId` to `run.ingested` + `proposal.corrected`; `subject` to `proposal.created` | ✓ ADDITIVE (§5 — new optional payload fields OK) |
| Event IDs | New optional `agent_orchestrator.process.updated` | ✓ ADDITIVE |
| API routes | New `GET /processes`, `GET /processes/:id` | ✓ ADDITIVE (§7) |
| ACL features | New `agent_orchestrator.processes.view` | ✓ ADDITIVE (§10) |
| CLI | New `rebuild-processes` command (new `cli.ts`) | ✓ ADDITIVE (§13) |

### Cross-module additive change to flag

The recommended fix (below) for the lifecycle-signal blocker is to **emit the already-declared** `workflows.instance.*` events. Because those IDs already exist in `workflows/events.ts` (lines 17–27), emitting them is **purely additive** (no new contract surface, no rename) — but it is a change to a **core module** to satisfy an enterprise overlay, so it falls under the root `AGENTS.md` "Ask First" rule (touching another module). Call it out and get sign-off before implementing.

### Missing BC Section

Present and correct. The spec's "Migration & Backward Compatibility" section accurately classifies everything as additive. ✅

## Spec Completeness

### Missing / Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Events | Assumes a consumable "workflows instance lifecycle signal" that **does not exist on the bus**; does not say how the subscriber learns of *terminal*, *stage-beyond-agent-steps*, or *assignment* transitions | Add an explicit dependency + the emit-the-declared-events prerequisite; or phase the projection (see Remediation) |
| Data Models | `subject` propagation path is underspecified — `proposal.created` does **not** carry subject today, so the subscriber cannot populate it from the event | Specify that `ctx.subject` is added to the `proposal.created` payload (additive) so the subscriber stays decoupled from `workflows` |
| Data Models / Compliance | Does not reconcile `encryption.ts` with the High-value/Fraud **SQL filters** — encrypted columns are not queryable | Split: dedicated **unencrypted, typed** facet columns for filter/sort (`subject_value_minor bigint`, `subject_fraud boolean`, `subject_type varchar`); encrypt only free-text `subject_title` |
| Data Models | Uses `@Index({ name: '…_uq' })` "comment: unique" for the per-process uniqueness | Use the real convention: `@Unique({ name, properties })`; and because the row is soft-deletable, make it a **partial** unique index over live rows (`WHERE deleted_at IS NULL`), which the decorator can't express → hand-write that one migration (precedent: `agent_principals_org_agent_uq`, Migration20260625050000) |
| API Contracts | Says "two new read routes" generically; doesn't pin the list route to the established mechanism | Specify `GET /processes` uses `makeCrudRoute` with `list: { schema, entityId: 'agent_orchestrator:agent_process', fields, sortFieldMap, buildFilters }`; response envelope is `{ items, total, page, pageSize, totalPages }` (not `{ data }`) |
| API Contracts | `my_team` / `needs_decision` filters need the operator's assignment, which `buildFilters(query)` alone doesn't have | Note that these scopes require auth context (assignee/team) and that the underlying `assigneeUserId`/`teamId` are themselves workflow-sourced (same lifecycle-signal dependency) |
| Implementation Plan | Phases are present but light on per-step detail | Acceptable for a `next/` overlay; expand at `om-implement-spec` time |

All other required sections (TLDR, Overview, Problem, Proposed Solution, Architecture, Risks, Integration Coverage, Final Compliance, Changelog) are present and good.

## AGENTS.md Compliance

| Rule | Location in spec | Fix |
|---|---|---|
| ACL ids must reference **real** features; existing ids are **plural** (`agent_orchestrator.proposals.dispose`, `…proposals.view`, `…trace.view`) | Spec references `agent_orchestrator.proposal.dispose` (singular) — **does not exist** | Reference `agent_orchestrator.proposals.dispose`; name the new feature `agent_orchestrator.processes.view` (plural, matches `proposals`/`agents`) |
| `defaultRoleFeatures` must mirror new `acl.ts` features and sync via `yarn mercato auth sync-role-acls` | Spec adds the feature but doesn't list the role grants | Add `processes.view` to `superadmin`/`admin` (via `agent_orchestrator.*`) + `operator`/`engineer`/`employee` in `setup.ts` (mirror the `proposals.view` grant set) |
| Encryption: PII/person-affecting fields declared in `encryption.ts` `defaultEncryptionMaps`; reads via `findWithDecryption` | Spec's Final Compliance omits encryption; module already encrypts `agent_proposal.payload`, `agent_run.input/output` | Add an `agent_orchestrator:agent_process` map for free-text `subject_title` only; keep filterable facets as plaintext typed columns (see tension below); read the projection with `findWithDecryption` |
| List routes use `makeCrudRoute(... indexer: { entityType })`; responses raw (no `{ data }`) | Spec under-specifies | Adopt the `proposals/route.ts` pattern verbatim |
| bigint at JSON boundary (`NextResponse.json` can't serialize bigint — lessons.md:885) | Spec flags it as a risk | **Downgrade:** the projection materializes `cost_minor` as an entity column; MikroORM hydrates bigint → JS `number`, so reading the projection entity serializes fine. Only the **backfill** (if it sums via raw SQL) must normalize. Note this resolution. |
| Subscriber metadata `{ event, persistent?, id? }`, idempotent, DI via `ctx.resolve` | Spec says "event-maintained, idempotent" | Compliant; implement upsert keyed on `(tenant, org, processId)` so replays are no-ops |
| Commands/undo for writes | Projection is a derived cache, not a user mutation | Acceptable: maintain it via a subscriber-invoked service, **not** an undoable command (no user-facing write) — state this so review doesn't flag it |
| i18n + DS status tokens for status chips | Spec commits to both | Compliant |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **`workflows.instance.*` declared but never emitted** | The projection cannot learn of terminal (`auto_completed`/`completed`/`failed`/`cancelled`), stage transitions that don't invoke an agent (e.g. "Payout & comms"), or `opened_at` accurately. ~Half the mockup's signal (terminal status + accurate stage) is unbuildable from agent events alone. | **(a)** Prereq: emit the declared `workflows.instance.*` events at executor lifecycle points (additive, ask-first core change). **(b)** Phase the spec: ship the agent-event-driven subset first (subject, cost, agents, stepId-stage, disposition status, pending count), defer terminal/stage-complete to after (a). |
| **Assignment/SLA fields (`assigneeUserId`, `teamId`, `waitingSince`) are workflow-USER_TASK-owned** and likely not on the bus either | `Waiting on you`, `My team`, `Stuck >24h` filters can't be populated → these headline operator filters don't work | Verify whether `workflows` emits task-assignment/claim events; if not, fold into the same prereq (emit task lifecycle events) or derive `waitingSince` from `proposal.created` time as a degraded approximation and document the limitation |
| **Encryption vs. SQL filtering contradiction** | If `subject_facets` is encrypted (per module precedent), `high_value`/`fraud_flagged`/`subjectType` filters can't run in SQL; if left plaintext, business-sensitive data is unencrypted at rest | Split the schema: unencrypted typed columns `subject_value_minor`/`subject_fraud`/`subject_type` for filter/sort; encrypt only free-text `subject_title`. Document that filter facets are deliberately plaintext (advisory triage, not the authoritative record). |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Subject not on `proposal.created` payload | Subscriber can't set subject without reading `workflows` (coupling) | Add `subject` to the `proposal.created` payload (additive) at the bridge/command boundary |
| Projection drift (missed/duplicated event) | Stale list rows | Idempotent upsert keyed on `processId`; `rebuild-processes` backfill; list degrades to `processId`+workflow name when a row is missing |
| Cross-tenant / cross-operator leakage in the list | High-severity if it happens | All reads filter `organization_id`; `my_team`/`needs_decision` scope to assignment; mandatory tenant-isolation tests already in the spec |
| `proposal.corrected`/`run.ingested` lack `processId` | Correction/run-cost events can't be joined to a process | Add `processId` to both payloads (additive); capture from context at emit time |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| bigint serialization | Crash on raw-SQL aggregate | Sidestepped by materialized column; normalize only in backfill if raw SQL is used |
| Status taxonomy diverges from real business states | Display only | Facet-driven `fraud_hold`/`docs_requested` extend via facet vocabulary, not enum churn |

## Gap Analysis

### Critical Gaps (block implementation)

- **Lifecycle signal source.** Decide and document: emit `workflows.instance.*` (and task) events, or phase the projection to the agent-event-derivable subset. Without this, terminal status + non-agent stages + assignment filters are unimplementable.
- **Subject propagation.** Add `subject` to `proposal.created` payload (and define where the bridge reads it from `WorkflowInstance.context`), so the subscriber populates subject without coupling to `workflows`.
- **Encryption/filter split.** Resolve the facet contradiction before schema is written (it changes the columns).

### Important Gaps (should address)

- **ACL id correction** — `proposal.dispose` → `proposals.dispose`; new feature `processes.view`; mirror in `defaultRoleFeatures`.
- **List route mechanism** — pin to `makeCrudRoute` + `{ items, total, … }` envelope + `sortFieldMap`/`buildFilters` (model on `proposals/route.ts`).
- **Partial unique index** — `@Unique` over live rows via hand-written migration; document per `agent_principals` precedent.

### Nice-to-Have Gaps

- **Pause / Reassign / Take over** verb availability in `workflows` (the spec already flags this as an out-of-scope dependency — confirm the verbs exist before wiring the buttons).
- **`agent_orchestrator` has no `cli.ts` today** — the backfill is the module's first CLI command; trivially additive, just note it creates the file (invocation `yarn mercato agent_orchestrator rebuild-processes`).

## Remediation Plan

### Before Implementation (Must Do)

1. **Decide the lifecycle-signal strategy** with the maintainer: (Recommended) emit the already-declared `workflows.instance.*` events (additive core change) and verify/emit task-assignment events; OR scope this spec to the agent-event-derivable subset and file the workflow-event work as an explicit prerequisite spec.
2. **Resolve the encryption/filter split** in the Data Models section: unencrypted typed facet columns for filtering; `encryption.ts` map for free-text `subject_title` only.
3. **Fix the ACL references** (`proposals.dispose`; add `processes.view` + role grants).

### During Implementation (Add to Spec)

1. Add `subject` to `proposal.created` and `processId` to `proposal.corrected` + `run.ingested` payloads (all additive); regenerate with `yarn generate`.
2. Specify the list route as `makeCrudRoute` with the proposals-route field/sort/filter pattern; note auth-scoped `my_team`/`needs_decision`.
3. Use `@Unique` + a hand-written partial unique migration for `(tenant, org, processId) WHERE deleted_at IS NULL`; update `.snapshot-open-mercato.json` per the coding-agent migration exception.
4. Maintain the projection via an idempotent subscriber→service upsert (not an undoable command); read via `findWithDecryption`.

### Post-Implementation (Follow Up)

1. If phased: implement the `workflows` lifecycle/task emission, then enable terminal status + assignment filters + accurate non-agent stages.
2. Confirm `workflows` exposes Pause/Reassign/Take-over verbs before wiring the detail-page actions.

## Recommendation

**Needs spec updates first.** The design is correct, additive, and convention-aligned — no BC violations and no rewrite required. But three things must be settled before code: (1) where lifecycle/assignment signals come from (the workflows-events gap is real and blocking for ~half the mockup), (2) the encryption-vs-filtering column split, and (3) the ACL-id fix. The pragmatic path is to **phase**: ship an agent-event-driven projection (subject, cost, agents, per-step status, pending decisions) now, and gate terminal-status/assignment/non-agent-stage fields behind the additive `workflows.instance.*` (and task) event emission.
