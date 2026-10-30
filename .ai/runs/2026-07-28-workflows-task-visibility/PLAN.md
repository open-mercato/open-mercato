# Run: workflows-task-visibility (spec phases 5 + 6)

- Date: 2026-07-28
- Branch: `feat/workflows-task-visibility`
- Base: `feat/agent-orchestrator-mvp` @ `e3849f41b` (Phases 0–3b, canvas fidelity, task security fix, Phase 4a all merged)
- Design: `.ai/analysis/2026-07-28-task-visibility-design.md` — **the authoritative spec for this run** (753 lines: predicate, entity-access model, 16-row security checklist, 27-case matrix, 22 sized steps)
- Spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4 + the flagged security-semantics paragraph

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. Record the **pre-amend lineage** short SHA. Never leave `PENDING`. First non-`done` row is the resume point. Numbers track the design's step table.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 5 | 5.1 | Prerequisite: `claimUserTask` verifies the caller holds one of `assignedToRoles` | done | `c2023ff42` |
| 5 | 5.2 | Extract `classifyRecordsEntity` to `entities/lib/entityClassification.ts` | done | `33033ed2a` |
| 5 | 5.3 | `lib/task-entity-types.ts` — entity-type normalization sharing one alias dictionary | done | `f73400352` |
| 5 | 5.4 | `lib/task-visibility.ts` — the pure predicate + filter builder, no call sites | done | `679b08c74` |
| 5 | 5.5 | `lib/task-entity-access.ts` — per-request access map resolver | done | `1538946be` |
| 5 | 5.6 | Three administration ACL features with `dependsOn` + dependency-table test | done | `ef5fc7330` |
| 5 | 5.7 | Tenant opt-out setting (`api/task-settings.ts`, fail-to-`true`) | done | `cbdf1c7e4` |
| 5 | 5.8 | Migration: `assignee_kind` + `entity_types` + GIN index; creation writes both | done | `5ccd0a990` |
| 5 | 5.9 | Wire the predicate into every backoffice READ surface (+ 404-vs-403 policy) | done | `49c2dcd16` |
| 5 | 5.10 | Wire the ACT surfaces (claim/unclaim/complete) | done | `5845d4f4d` |
| 5 | 5.11 | `POST /api/workflows/tasks/[id]/reassign` with audit + optimistic lock | done | `552ee0990` |
| 5 | 5.12 | `administrativeQueueFeature` on the provider + enterprise registers its own source | done | `cfb89fe8e` |
| 5 | 5.13 | Author-time Problems checks on USER_TASK bindings | done | `babbb5b40` |
| 5 | 5.14 | Inbox diagnostics: "hidden — entity access" marker (workload aggregate n/a — no such surface exists) | done | `57cbca082` |
| 5 | 5.15 | Correction: owner-less USER_TASK is a warning, not a save-blocking error | done | `39215ed21` |
| 6 | 6.1 | Portal ACL features + portal task routes (list/get/complete) | done | `b89911792` |
| 6 | 6.2 | Portal task pages + nav + `portalBroadcast` live updates | done | `2b7f610fd` |
| 7 | 7.1 | Integration + Playwright suites (design §10.3/§10.4) | done | `9a21c2b55` |
| 7 | 7.2 | Docs + UPGRADE_NOTES + spec changelog | done | `6d07199fc` |
| 7 | 7.3 | Security-review evidence against the design's §9 checklist | done | `9a331fa84` |

## Goal

Ship spec §6.4 in full: a user sees and acts on a task iff (assigned, or holds an assigned role, or claims from a role queue) **AND** passes access checks on the task's bound entities — with `workflows.tasks.*` gating administration rather than one's own work. Plus portal task surfaces so a customer can complete work assigned to them.

## Maintainer decisions (2026-07-28)

1. **Ship the full §6.4 change in one move**, not the additive-then-flip two-step. Rationale: agent_orchestrator is not production code yet. **This clears it as a blocker, not as an outcome** — step 5.12 still gives disposition tasks an administrative-queue class so they cannot go invisible.
2. **Portal principals get an `assignee_kind` discriminator column**, not a `customer:<id>` string prefix.
3. **D-1 approved** — keep `workflows.tasks.claim`/`.complete` as route `requireFeatures`, against the spec's ACL-appendix sentence. Dropping them would strand two FROZEN ACL ids that no route consults; the sentence's purpose (portal parity) is served by the new `portal.tasks.*` routes. The narrowing §6.4 demands still lands: holding `.complete` no longer completes anyone else's task. **Call this out prominently in the PR — it deviates from an approved spec sentence.**
4. **D-2 approved** — denormalized `user_tasks.entity_types` so the entity gate is SQL. A JS post-filter makes `total` lie and returns short pages.

## Out of scope — do not cross these

- **A7 (closing the disposition `UserTask` when a proposal is disposed)** — design step 21, a separate PR behind `agent_orchestrator/AGENTS.md`'s Ask-First on the auto-approve boundary. The visibility model does **not** require it. Report it; do not fix it here.
- **Per-record ACL.** No such layer exists in the platform; entity access is entity-*type* + scope + portal ownership. The docs must say so plainly rather than implying row-level guarantees.
- **Role names → ids.** `assignedToRoles` stores names end to end and `loadAcl` returns no role ids. A coordinated data + authored-definition migration, filed as follow-up.
- **`BACKWARD_COMPATIBILITY.md` category 14** (design step 22) — proposing a new contract-surface category is itself a contract change; raise it, do not merge it here.
- Any new `UserTaskStatus` value; a shared `LocalizedString`; a real `Task` entity.

## Risks

- **This is a security-semantics change to a STABLE surface with no BC rule covering it.** The tenant opt-out is the "old behaviour alongside the new" bridge, for one minor release only.
- **The no-bindings case decides whether this is a narrowing or an outage.** Backoffice: an empty binding set passes vacuously — otherwise the entire pre-Phase-4 task corpus goes invisible to its own assignees on upgrade. Portal: the same case **denies**, because the binding to their own record *is* the authorization. Fail-closed applies to unresolvable bindings, not to absent ones.
- **`isPortalAdmin` resolves to `['*']`** — a naive wildcard check hands a portal admin every task in the org, across customers. The portal branch must carry no feature array at all.
- **`view_all` widens seeing, never acting.** An administrator must reassign-to-self (audited) before completing someone else's task.
- The 5-minute `CustomerRbacService` cache TTL means new portal grants are not immediate during rollout.

## Implementation rules

1. One step = one commit; flip the Tasks row in the same commit with Read+Edit tools.
2. Unit tests mandatory; the design's §10.1 27-case matrix is the acceptance bar for 5.4.
3. Additive only. New ACL ids, routes, DI keys and columns are additions; nothing removed, nothing renamed.
4. Tenant + organization scoping on every query. Every state change logs a `WorkflowEvent`.
5. Never run `yarn db:migrate` — ship the migration and snapshot.
6. i18n ×4; DS tokens only; status never colour-only.
7. **Challenge any premise that looks wrong.** Five false premises have been caught this way across the redesign, including two of mine — one would have made every Studio-authored task uncompletable.
