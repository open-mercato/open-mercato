# Security review evidence — workflows task visibility (spec §6.4 + portal tasks)

- **Run:** `2026-07-28-workflows-task-visibility` · branch `feat/workflows-task-visibility`
- **Scope:** the change that makes a workflow user task visible and actionable on *assignment + entity access* instead of on `workflows.tasks.view`, plus the new portal task surface.
- **Why this document exists:** the spec makes a dedicated security review a **release precondition** for shipping this default-ON. This is the evidence half. It is not the review — a named human still has to sign the three items at the bottom that no test can answer.
- **Checklist:** the 16 rows of `DESIGN.md` §9, worked one at a time. Every row is answered with a file, a function or a test name. **Where an item is not satisfied it says so.** Four are not; stretching them into a full green column would be worse than useless to a reviewer.

**Summary (revised 2026-07-30): 12 of 16 satisfied · 4 not satisfied.** Row 9 moved from partial
to satisfied when its follow-up issue was filed (#4661). The four that remain are unchanged and
are all human artifacts — a written sign-off on entity-type-vs-per-record scope, a sign-off on the
stale-JWT ownership window, the D-1 deviation call-out on the PR itself, and the rollout decision
in item 1 below. None of the four is a code defect discovered and left unfixed.

Paths below are relative to the repository root; `<wf>` abbreviates `packages/core/src/modules/workflows/`.

---

## 1. Single decision point, pure, and every surface routes through it — **SATISFIED**

**The rule lives in exactly one place.** `<wf>lib/task-visibility.ts` exports `decideTaskVisibility`, `buildTaskVisibilityConditions` and `buildTaskVisibilityFilter`. Its only imports are `isOrganizationAccessAllowed` (`@open-mercato/shared/lib/auth/organizationAccess`) and `hasAllFeatures` / `hasFeature` (`@open-mercato/shared/security/features`) — no ORM, no DI container, no React, no entity registry. Purity is structural: the ACL load, entity classification, portal ownership expansion and the tenant setting are all resolved by the caller and handed in as data.

**No second copy.** `grep -rn "businessContextEnabled" packages` returns three non-test production sites, all inside the two files that are allowed to have them (`lib/task-visibility.ts` ×2, `lib/task-visibility-request.ts:280`). `grep` for the relationship comparison (`hasRoleOverlap`, `currentTaskOwnerId`) returns definitions in `lib/task-visibility.ts` and no re-implementation elsewhere.

**Every surface.** Enumerated by grepping for the entry points (`decideTaskAccess`, `gateTaskAction`, `decidePortalTaskAccess`, `filterVisiblePortalTasks`, `partitionTaskPage`, `buildTaskVisibilityRequestConditions`) outside the two wiring modules:

| Surface | Call site | Entry point | Refusal test |
|---|---|---|---|
| Task list | `<wf>api/tasks/route.ts:143,169` | `buildTaskVisibilityRequestConditions` + `partitionTaskPage` | `api/__tests__/tasks.route.test.ts` → *"narrows an ordinary caller to their own work, their queues and viewable entities"* |
| Task detail | `<wf>api/tasks/[id]/route.ts:90` | `decideTaskAccess` | `api/__tests__/taskDetail.route.test.ts` → *"an unrelated colleague gets exactly the missing-task answer"* |
| Claim | `<wf>api/tasks/[id]/claim/route.ts:67` | `gateTaskAction` | `api/__tests__/taskActions.route.test.ts` → *"a non-member cannot tell an assigned task from a nonexistent one"* |
| Unclaim | `<wf>api/tasks/[id]/unclaim/route.ts:65` | `gateTaskAction` | *"a colleague in the same queue cannot release the claimant claim"* |
| Complete | `<wf>api/tasks/[id]/complete/route.ts:105` | `gateTaskAction({ requireOwnership: true })` | *"a colleague in the same queue cannot complete what the claimant claimed"* |
| Reassign | `<wf>api/tasks/[id]/reassign/route.ts:97` | `gateTaskAction` (visibility only, by design — see row 5 note) | `api/__tests__/taskReassign.route.test.ts` → *"a caller who cannot see the row is refused as not found, never reaching the handler"* |
| Work Inbox (list + claim-next) | `<wf>lib/work-inbox/user-task-source.ts:155,225` | `buildTaskVisibilityRequestConditions` + `partitionTaskPage` | `api/__tests__/work-inbox.route.test.ts` |
| Record-page pending-work widget | `<wf>widgets/injection/pending-work/widget.client.tsx:87` | reads `GET /api/workflows/work-inbox` — no second query path | covered transitively by the inbox tests |
| Portal list | `<wf>api/portal/tasks/route.ts:110` | `buildPortalTaskConditions` + `filterVisiblePortalTasks` | `api/__tests__/portalTasks.route.test.ts` → *"drops a row the SQL admitted but ownership refuses"* |
| Portal detail | `<wf>api/portal/tasks/[id]/route.ts:77` | `decidePortalTaskAccess` | *"another customer's task is a 404"* |
| Portal complete | `<wf>api/portal/tasks/[id]/complete/route.ts:91` | `decidePortalTaskAccess` (`actable`) | *"a portal admin may READ a company member's task"* (and not complete it) |

**Note on the design's "workload aggregate" surface:** no such surface exists in the codebase (recorded in PLAN.md step 5.14). It is not skipped — there is nothing to skip.

---

## 2. Fail-closed on resolution failure — **SATISFIED**

Each failure mode has its own named test, and each one denies rather than admitting:

| Failure | Behaviour | Evidence |
|---|---|---|
| The authored `entityType` resolves to no entity id | `denied:unknown-entity-type` | `lib/__tests__/task-visibility.test.ts` → *"U12: an entity type that does not resolve is refused as unknown, not guessed"* |
| The access map has no key for a binding's type | deny | *"U27: a map key the resolver never produced denies — a missing key is not a pass"* |
| The platform has no rule for the entity | deny (`unavailable`) | *"an entity the platform has no rule for denies"* |
| The ACL row is missing | deny | `lib/__tests__/task-entity-access.test.ts` → *"a missing ACL row denies rather than defaulting to open"* |
| The ACL load **throws** | propagates (→ 500), never an empty map | `lib/__tests__/task-entity-access.test.ts` → *"a thrown ACL load propagates — it never degrades to an empty map"* |
| The tenant-setting read fails | defaults to `true`, the **new** model | `api/__tests__/task-settings.route.test.ts` → *"a failing read reports true, not the permissive legacy filter"*, *"an unresolvable container reports true"*, *"a missing service is not an opt-out"* |
| `rbacService` is absent from the container | grants nothing | `api/__tests__/tasks.route.test.ts` → *"a missing rbacService grants nothing rather than everything"* |
| An unrecognized `assigneeKind` | nothing admits | `task-visibility.test.ts` → *"an unrecognized assigneeKind is neither user nor customer, so nothing admits"* |

The distinction the design insisted on holds in code: `evaluateEntityClause` (`lib/task-visibility.ts:217-241`) treats a **missing map key** as a resolution failure, while an **empty binding list** never enters the loop at all.

---

## 3. No-bindings behaviour, both directions — **SATISFIED**

- Backoffice, vacuous pass: `task-visibility.test.ts` → *"U1: the assignee sees and can act on their own binding-free task"*; route-level: `api/__tests__/taskDetail.route.test.ts` → *"serves a legacy row whose entity columns are null"*, `taskActions.route.test.ts` → *"a legacy row with null entity columns is still actionable by its assignee"*, `tasks.route.test.ts` → *"a legacy row with null columns still reaches its own assignee"*. Integration: **TC-WF-044** asserts the fixture row's `entityBindings` is null *and* that its assignee completes it.
- Portal, deny: `task-visibility.test.ts` → *"U20: an UNBOUND portal task is visible to nobody"*; route-level: `portalTasks.route.test.ts` → *"an unbound task is a 404, not a 200"* and *"an unbound task cannot be completed and nothing is written"*. Integration: **TC-WF-048** creates an unbound portal task and asserts its own assignee gets a 404 and never sees it in the list.

The asymmetry is deliberate and is the difference between a narrowing and an outage; it is stated in the code (`lib/task-visibility.ts` header, property 1), in the framework docs and in UPGRADE_NOTES.

---

## 4. The opt-out changes only the read filter — **SATISFIED**

**Grep.** `businessContextEnabled` is read in production code at exactly three sites:

- `lib/task-visibility.ts:338` — the `legacy-read-filter` **admit** inside `decideBackoffice`, reached only after `actable`/`claimable` have already been computed by the new rule;
- `lib/task-visibility.ts:439` — `buildTaskVisibilityConditions`, which drops the relationship clause from the `WHERE`;
- `lib/task-visibility-request.ts:280` — `buildTaskEntityGateConditions`, which drops the entity fragment from the same `WHERE`.

All three are read filters. `lib/portal-task-access.ts:73` pins the portal policy to the constant `{ businessContextEnabled: true }`, so the portal branch cannot observe the setting at all.

**Tests.** `task-visibility.test.ts` → *"U7: the opt-out neither widens nor narrows the act path for an assignee"*, *"the tenant opt-out is ignored on the portal branch"*, *"the opt-out does not rescue a task blocked only by the entity gate for a non-view holder"*. `taskActions.route.test.ts` → *"the tenant opt-out restores the read and does NOT re-open acting"* and *"the opt-out does not let an unrelated colleague claim a queue they are not in"*. `task-settings.route.test.ts` → *"the opt-out is additive on reads — it never hides a row the new model shows"* and *"a cross-tenant row stays denied with the flag off"*. Integration: **TC-WF-046** flips the real tenant setting through the API and asserts the restored read *and* the still-refused foreign complete, then flips it back.

---

## 5. A2 and A3 regressions fixed and covered — **SATISFIED**

| Regression | Fix | Evidence |
|---|---|---|
| **A2** — a cross-tenant claim wrote to the foreign row before failing | `gateTaskAction` looks the row up **with `tenantId` and `organizationId` in the query**, before the predicate and long before any write (`lib/task-visibility-request.ts`, `gateTaskAction`) | `taskActions.route.test.ts` → *"a cross-tenant id is refused before the handler can write anything"* |
| **A3** — complete did not check the assignee | `requireOwnership: true` on the complete route only; owner is `claimedBy ?? assignedTo` (`currentTaskOwnerId`) | `taskActions.route.test.ts` → *"a colleague in the same queue cannot complete what the claimant claimed"*, *"an administrator with view_all sees the task but may not complete it"*. Integration **TC-WF-044** (bystander → 404) and **TC-WF-045** (view_all → 409) |
| Claim did not verify role membership | landed as step 5.1 (`c2023ff42`), before any of the visibility work — `claimUserTask` takes the caller's server-derived role names as a required parameter | `taskActions.route.test.ts` → *"a non-member cannot tell an assigned task from a nonexistent one"*, *"an empty role queue is the handler own conflict, not a server error"* |
| Concurrent claim is atomic | compare-and-set `UPDATE … WHERE status='PENDING' AND claimed_by IS NULL` (shipped Phase 4a, unchanged here) | integration **TC-WF-023** → *"two simultaneous claims on one task: exactly one wins"* |

**Worth a reviewer's attention.** The owner was initially read as `assignedTo` alone. That would have let a **role-queue member complete a colleague's already-claimed task** — the exact hole A3 describes, reintroduced one layer up. It resolves as `claimedBy ?? assignedTo`, which is what `completeUserTask` itself enforces; the predicate and the handler must agree or the UI lies about what it can do.

**Deliberate asymmetry to check, not a miss:** the **reassign** route gates on visibility, *not* ownership. Requiring ownership would make the owner-less task (row: `403 TASK_NOT_ACTIONABLE`) unrescuable by definition. The route is separately gated by `workflows.tasks.reassign`, which roots at `view_all`.

---

## 6. Bound-record org scoping — **NOT SATISFIED (requires a written human sign-off)**

The checklist asks for a reviewer to have read `DESIGN.md` §3.7 and either **signed off** that per-record scope checks are out of scope, or **required** them. No such sign-off exists yet; it cannot be produced by the implementation.

What the reviewer is being asked to accept, stated exactly:

- The **task row's** own `tenant_id` / `organization_id` are checked on every read and every act, in SQL, before the predicate.
- The **bound record's** scope is **not** re-fetched or re-checked. A binding is `{ entityType, entityId }` captured at task creation; nothing re-verifies at read time that `entityId` still lives in the caller's organization.
- The check that *is* performed is entity-**type** access: "may this principal view records of this type, in this scope".
- Consequence: a record moved between organizations after a task was created, or an id authored into a binding that never belonged to the caller's organization, is not caught by this layer. What such a caller gets is the task's *name, instructions and the binding itself* — not the record's contents, which the owning module's own API still gates.

This is stated plainly in `apps/docs/docs/framework/workflows/task-visibility.mdx` ("Known limits") and in UPGRADE_NOTES rather than left implicit.

---

## 7. The portal branch and the `isPortalAdmin` trap — **SATISFIED**

Four defences, in the order a request meets them:

1. **SQL:** `assignee_kind = 'customer'` on every portal query (`lib/portal-task-access.ts` → `buildPortalTaskConditions`), so a backoffice row cannot enter a portal result set at all.
2. **SQL:** `assigned_to IN (…)` — the principal, plus their company members when they are a portal admin. Resolved from the same company query as the owned records, by `resolvePortalTaskPrincipal`.
3. **SQL:** `entity_types IS NOT NULL`, which drops unbound rows in the query so `pagination.total` does not count rows the predicate then removes.
4. **Predicate:** ownership is `ownedRecordIds.has(binding.entityId)` — a `Set.has`, which cannot be wildcarded. `PortalTaskPrincipal` (`lib/task-visibility.ts:74-88`) **carries no feature array at all**, which is what makes the trap structurally unreachable rather than merely avoided.

Tests: `task-visibility.test.ts` → *"U23: a portal admin whose features resolve to `[*]` buys nothing with the wildcard"*, *"U24: a portal admin READS a company member's task and cannot complete it"*, *"U25: a portal admin with no company association owns nothing and sees nothing"*, *"U21: a binding on another customer's record is refused"*, *"U22: a backoffice task is structurally not portal work"*. Route-level: `portalTasks.route.test.ts` → *"a task outside their company stays a 404 even with `[*]` grants"* and *"their list query still names only their own company's members"*. Integration: **TC-WF-049** builds a real `isPortalAdmin` customer role **with an empty feature list**, proves the wildcard admits it to the route, and then proves it reads a member's task without `canComplete`, is refused on complete, and gets a byte-identical 404 for another company's task.

**One honest note on the shape of the evidence.** The design asked for "a test that constructs `resolvedFeatures: ['*']` explicitly". The predicate's portal principal type has nowhere to put such a field — that is the fix. U23 therefore constructs `isPortalAdmin: true` with an empty owned set, and the `['*']` path itself is exercised end to end by TC-WF-049 against the real `CustomerRbacService`. The intent of the row is met; the literal artifact it names cannot exist by construction.

---

## 8. Portal identity staleness — **NOT SATISFIED (requires a written human sign-off)**

`customerEntityId` and `personEntityId` are read straight off the portal JWT (`lib/portal-task-access.ts` header note; `customer_accounts/lib/customerAuth.ts`) and are **not re-verified per request**. A portal user moved between companies keeps stale ownership until their token turns over. The reviewer must either accept that window or require a per-request re-resolution; neither has happened.

Two distinct delays, easy to conflate and worth keeping apart:

- **The JWT claim window** — until the user's token is reissued.
- **The `CustomerRbacService` cache** — `cacheTtlMs = 5 * 60 * 1000`. This delays *feature grants*, not identity, and it is why a freshly granted `portal.tasks.view` is not immediately visible to a signed-in user. Documented in the user guide and UPGRADE_NOTES so nobody debugs a working system for five minutes.

---

## 9. Role matching keys on names — **SATISFIED** (was partial; issue filed 2026-07-30)

**Satisfied:** the comparison site now carries the comment the checklist asks for — `hasRoleOverlap` in `<wf>lib/task-visibility.ts` documents that both sides are names, that they are server-derived (so not client-spoofable), that they are tenant-mutable (so a rename silently orphans assignments), and why changing only the query side would match nothing (`loadAcl` returns no role ids). The consequence is also stated in `BackofficeTaskPrincipal.roleNames`' own doc comment, in `task-visibility.mdx` → Known Limits, in the UPGRADE_NOTES entry, and in the spec changelog's deferrals.

**Now satisfied (2026-07-30):** the follow-up issue the checklist requires is
**https://github.com/open-mercato/open-mercato/issues/4661** — it records the additive
`assigned_to_role_ids` column, the reason a query-side-only change would match nothing
(`loadAcl` returns no role ids), and the full scope: principal plumbing, a backfill for existing
`user_tasks` rows, a migration of authored definitions including the shipped gallery templates,
and a dual-read window per the deprecation protocol. Filed after the visibility work merged, so
it tracks outstanding debt rather than gating a release.

---

## 10. Both older task features still gate a real surface — **SATISFIED**

- `workflows.tasks.view` is the `requireFeatures` on `<wf>api/tasks/route.ts:41`, `<wf>api/tasks/[id]/route.ts:36` and the work-inbox list. It is also the dependency root of all three new administration features (`<wf>acl.ts`), so it is load-bearing in two ways rather than stored-but-unused.
- `workflows.view_tasks` still guards the task pages (`<wf>backend/tasks/[id]/page.meta.ts` → `requireFeatures: ['workflows.view_tasks']`).
- `workflows.tasks.claim` / `.complete` remain the route guards on claim and complete (D-1, row 11).

Test: `<wf>__tests__/acl-dependencies.test.ts` → *"every task administration feature is declared and roots at workflows.tasks.view"*, *"keeps every dependency target within the workflows feature set"*, *"employee defaults grant the task-inbox surface (#4231)"*.

---

## 11. D-1 resolved — **NOT SATISFIED (requires the PR comment the checklist names)**

The decision itself **is** made and recorded: `workflows.tasks.claim` / `.complete` stay on their routes, against the spec's ACL-appendix sentence. It is written down in `PLAN.md` → "Maintainer decisions (2026-07-28)" item 3, in the UPGRADE_NOTES entry, and in the spec changelog as deviation **D-1**, each with the rationale (dropping them would strand two FROZEN ACL ids that no route consults; the sentence's purpose — portal parity — is served by the new `portal.tasks.*` features; the narrowing §6.4 asks for still lands because holding `.complete` no longer completes anyone else's task).

What the checklist asks for is a **PR comment** carrying that decision, and the PR is opened by the surrounding workflow rather than by this step. **A reviewer must confirm the deviation is called out prominently on the PR itself** — PLAN.md explicitly requires it, and a spec-sentence deviation buried in a changelog is a deviation nobody reads.

---

## 12. 404 versus 403 — **SATISFIED**

`resolveTaskRefusal` (`lib/task-visibility-request.ts:629`) returns the diagnostic 403 **only** when the refusal is an entity refusal *and* `canDiagnoseTaskRefusal(principal)` — that is, superadmin or a `workflows.tasks.view_all` holder. Everything else returns `TASK_NOT_FOUND_BODY`, one shared frozen object.

Tests: `taskDetail.route.test.ts` → *"an unrelated colleague gets exactly the missing-task answer"*, *"a foreign-tenant id is the same answer again — the lookup never sees it"*, *"an entity refusal is a bare 404 for a caller who is merely assigned"*, *"a view_all holder gets the diagnosis instead, naming the blocking type"*. Portal side: `portalTasks.route.test.ts` → *"a nonexistent id and a task they may not read are byte-identical"* (there is deliberately **no** portal analogue of the diagnostic 403).

Integration proves it over the wire rather than over a mock: **TC-WF-044** compares the raw response *text* of an existing-but-unrelated task against a random uuid; **TC-WF-048** and **TC-WF-049** do the same on the portal, including the cross-company case.

---

## 13. Disposition tasks — **SATISFIED**

- A holder of `agent_orchestrator.proposals.view` still sees them, and a workflows-only principal does not: `packages/enterprise/src/modules/agent_orchestrator/__tests__/agent-disposition-work-inbox.test.ts` → *"the source declares the proposals-view queue feature"* and *"a holder is admitted and a workflows-only user is not"*. Core-side equivalents: `task-visibility.test.ts` → *"U14: the queue feature admits a principal to unassigned rows, and grants no act"*, *"U15: a workflows-only principal no longer sees them — the intended narrowing"*, *"a source that declares no queue feature falls back to workflows.tasks.view_all"*, *"the queue arm never applies to a row somebody owns"*.
- No parked instance stalls: the mechanism is a *visibility class* on the work-inbox source (`administrativeQueueFeature`), which adds an arm to a `WHERE`. It touches no engine path.
- `dispositionService.ts` is untouched: `git diff --stat e3849f41b..HEAD -- '*dispositionService*'` is empty.

**Reported, not fixed — deliberately out of scope (design step 21, "A7").** When a proposal is disposed, the corresponding disposition `UserTask` is **not** closed. Those rows stay open in the administrative queue forever. This run's `PLAN.md` puts it out of scope because it sits behind `agent_orchestrator/AGENTS.md`'s Ask-First on the auto-approve boundary, and the visibility model does not require it. It is a **hygiene and reviewability** problem, not an access-control one — the rows are gated exactly like every other administrative-queue row — but a reviewer should know the queue grows monotonically until A7 lands.

---

## 14. Every new ACL id declared, seeded and synced — **SATISFIED**

- **Declared** with `dependsOn` in `<wf>acl.ts`: `workflows.tasks.view_all` → `workflows.tasks.view`; `workflows.tasks.reassign` and `workflows.tasks.manage` → `workflows.tasks.view_all`.
- **Seeded** in `<wf>setup.ts`: `admin: ['workflows.*']` covers all three through the wildcard; `employee` deliberately gets none of them. Portal: `defaultCustomerRoleFeatures` grants `buyer` both `portal.tasks.*` features and `viewer` only `.view`; `portal_admin` is deliberately **not** granted them explicitly, because a wildcard is exactly what the portal branch refuses to treat as ownership.
- **Asserted**: `<wf>__tests__/acl-dependencies.test.ts` → *"every task administration feature is declared and roots at workflows.tasks.view"*, *"employee defaults withhold task administration"*, *"defaultRoleFeatures grants are dependency-closed for every seeded role"*. Portal: `<wf>__tests__/portal-setup-grants.test.ts` → *"every targeted role slug is one customer_accounts actually seeds"*, *"a buyer can see AND finish their work; a viewer only sees it"*, *"portal_admin is deliberately NOT granted these explicitly"*, *"the grants are portal-namespaced and never leak a backoffice feature"*.
- **Runbook**: `<wf>AGENTS.md` → Validation Commands already carries the release-runbook line (*"adding a feature to `acl.ts` grants it to new tenants … existing tenants receive nothing until `yarn mercato auth sync-role-acls` runs"*). The UPGRADE_NOTES entry repeats it as a required deploy step.

**One real gap, reported rather than papered over:** there is **no `sync-customer-role-acls` counterpart**. `defaultCustomerRoleFeatures` is merged into seeded customer roles during *tenant setup* only, and the merge is additive-into-existing (`if (!role) continue`). **Existing tenants therefore receive `portal.tasks.*` never** — they must grant them by hand from the customer-role editor. This is stated in `setup.ts`, in the framework docs, in the user guide and in UPGRADE_NOTES, and a sync command is a genuine follow-up. Workflows is the platform's first consumer of this seam, so nothing regressed; the seam was simply always half-built.

---

## 15. The `admin: ['workflows.*']` wildcard matches all three new ids — **SATISFIED**

`<wf>__tests__/acl-dependencies.test.ts` → *"the admin workflows wildcard matches every new administration feature"*, evaluated against the real feature strings. Predicate-level: `task-visibility.test.ts` → *"U9: `workflows.*` matches view_all, so no seeded admin loses access on upgrade"* and *"U8: a bare `*` grant sees everything in tenant and acts on nothing unrelated"*. Both go through the shared wildcard-aware matcher (`@open-mercato/shared/security/features`), never an exact string compare.

Consequence for the upgrade: **no seeded admin or superadmin loses access.** This is the row that makes the change a narrowing for employees rather than a lockout for everyone.

---

## 16. Response payloads are still supersets — **SATISFIED**

`serializeUserTask` (`<wf>api/tasks/serialize.ts`) gains `assigneeKind` and `entityTypes` and drops nothing. Tests: `api/__tests__/tasks.route.test.ts` → *"keeps every field the raw entity dump already returned"*, *"reports the assignee kind, defaulting a projection that lacks it"*, *"reports the stored entity types, deriving them for a row written before the column"*, *"a task about nothing reports null entity types, never an empty array"*, *"emits dates in the same ISO form the entity dump produced"*. `api/__tests__/serialize.test.ts` (definition serialization) remains green and untouched.

No API route URL, method or existing response field changed. Six routes are added; `BACKWARD_COMPATIBILITY.md` §7 permits adding routes freely.

---

## Residual risks a reviewer must accept

These are properties of the shipped design, not defects to be fixed before merge. Accepting them is part of signing this review.

1. **Role queues match role NAMES, not ids.** Server-derived, so not client-spoofable — but tenant-mutable, so renaming a role silently orphans every assignment authored against the old name, and the orphaned task falls back to whatever else admits it (usually nobody, making it an owner-less task that must be reassigned). Fixing it is a coordinated data + authored-definition migration; changing only the query side would match nothing.
2. **Entity access is entity-TYPE access, not per-record.** There is no record-level ACL layer in the platform and this change does not add one. See row 6 for exactly what that does and does not cover.
3. **Bound records are not re-scope-checked.** A binding captured at task creation is trusted as an id thereafter.
4. **Portal grant rollout is not instant.** The `CustomerRbacService` five-minute cache delays new `portal.tasks.*` grants for signed-in users, and portal identity claims (`customerEntityId` / `personEntityId`) are JWT-resident and not re-verified per request.
5. **`defaultCustomerRoleFeatures` reaches new tenants only.** Existing tenants must grant the portal features by hand until a sync command exists (row 14).
6. **A7: disposition `UserTask` rows are never closed.** Correctly gated, but the administrative queue grows without bound (row 13).
7. **The backoffice task page still renders the Complete button for a `view_all` administrator.** The backoffice detail response carries no `canComplete` field (the portal one does), so the page derives completability from status alone. The refusal is enforced server-side — the click returns `409 TASK_ASSIGNED_TO_ANOTHER_USER` — so this is a **UX defect, not an authorization hole**, but a UI that offers an action it cannot perform trains people to ignore refusals. There is also **no reassign control on the page**: the only sanctioned path from seeing to acting is currently API-only. Both are follow-ups; this is also why the design's §10.4 "the complete button is absent" Playwright case was not written (it would assert behaviour the code does not have).
8. **`assigneeKind` is authorable only through the Studio's Code view.** Anyone authoring portal tasks today edits definition JSON by hand. A picker is a follow-up.
9. **The opt-out is a second, simpler security model that exists for one minor release.** Every release it survives is another release in which two models must be tested. Its removal should be scheduled, not remembered.

---

## What a human reviewer still has to judge

No test answers any of these. They are the reason this document is evidence and not a verdict.

1. **Is the blast radius acceptable for a default-ON release?** Every employee who is not an assignee goes from "sees the whole organization's tasks" to "sees an empty inbox" on deploy, with no in-product warning. The tests prove the rule is correct; only a human can decide the rollout is. Specifically worth deciding: whether the release should ship with the opt-out **on** for existing tenants and off for new ones, rather than on-for-nobody as it stands.
2. **Row 6 — is entity-*type* access enough?** Sign the §3.7 disposition explicitly, or require per-record checks and send this back. Do not leave it implied.
3. **Row 8 — is the stale-JWT ownership window acceptable?** A portal user moved between companies keeps ownership of their old company's bound records until their token turns over. Accept the window or require re-resolution.
4. **Row 11 — is the D-1 deviation called out on the PR itself?** It contradicts an approved spec sentence. PLAN.md requires it to be prominent; a changelog line is not prominent.
5. ~~**Row 9 — open the `assigned_to_role_ids` follow-up and link it here**~~ — **done, 2026-07-30: #4661.** Remaining items on this list are 1, 2, 3, 4 and 6, all of which are genuine maintainer judgements that no test can answer.
6. **Is "administration sees but cannot act" the right default for this organization?** It is a real operational cost: a supervisor covering for an absent colleague must reassign first, which shows up in the audit trail as a reassignment that may read as a takeover. The alternative — letting `view_all` complete — makes "who approved this?" unanswerable. This document asserts the trade-off was made deliberately; only the maintainer can say it was made correctly.

---

*Prepared as step 7.3 of run `2026-07-28-workflows-task-visibility`, against `DESIGN.md` §9.*
