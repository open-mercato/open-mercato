# TC-UNDO-001 Verification Matrix (#2468)

Live verification against the real app (ephemeral). Columns: update→undo restores (I1),
update→redo re-applies (I6), delete→undo re-materializes (I2). `contracts.json` holds the
live-validated CRUD contracts (create/update/read/delete payloads) used by `sweep.mjs` — reuse
these for the next-stage per-module integration tests.

## Batch 1 (verified)

| Entity | upd-undo | upd-redo | del-undo | Notes |
|---|---|---|---|---|
| customers.people | ❌ #2498 | n/a | ✅ | update-undo silent no-op (encryption change-tracking) |
| customers.companies | ✅ | ✅ | ✅ | |
| currencies.currencies | ✅ | ✅ | ✅ | |
| currencies.exchange_rates | ⚠️ | — | — | create 500 on duplicate (from,to,date) — should be 409; works w/ unique date; undo cycle TBD |
| feature_toggles.global | 🚫 | — | — | writes 403 — `feature_toggles.global.manage` ungranted (verify route vs acl) |
| scheduler.jobs | ❌ #2504 | ✅ | ❌ #2504 | undo reads logEntry.payload (always undefined) |
| catalog.categories | ✅ | ✅ | ✅ | |
| catalog.priceKinds | ✅ | ✅ | ✅ | |
| catalog.products | ✅ | ✅ | ✅ | |
| sales.channels | ✅ | ✅ | ✅ | PUT must resend `code` |
| sales.shipping-methods | ✅ | ✅ | ✅ | |
| sales.payment-methods | ✅ | ✅ | ✅ | |
| sales.delivery-windows | ✅ | ✅ | ✅ | |
| sales.tax-rates | ✅ | ✅ | ✅ | |
| staff.teams | ✅ | ✅ | ✅ | |
| staff.team-roles | ✅ | ✅ | ✅ | |
| staff.team-members | ✅ | ✅ | ✅ | |
| resources.resources | ✅ | ✅ | ✅ | |
| resources.resource-types | ✅ | ✅ | ✅ | |
| auth.roles | ✅ | ✅ | ✅ | |
| auth.users | ✅ | ✅ | ✅ | |

## Cross-cutting (verified)
- ✅ token consumption / no double-undo (customers.people)
- ⚠️ redo-of-create mints a NEW id (finding; all `*.create`)

## Batch 2 (verified — relations, actions, documents, planner, checkout, directory)

All ✅ update-undo + redo + delete-undo unless noted:
customers.{addresses, comments, interactions, deals}, catalog.{variants, offers, prices, optionSchemas},
sales.payments, staff.{timesheets.time_projects, timesheets.time_entries, leave-requests},
resources.{resource-activities, resource-comments}, planner.{availability, availability-rule-sets},
directory.organizations.

Action-undo ✅ (status flip reverts): customers.interactions.complete, customers.interactions.cancel,
staff.leave-requests.accept, staff.leave-requests.reject.
Assign-undo ✅ (membership removed): customers.tags.assign (1→0 confirmed), customers.labels.assign,
resources.resourceTags.assign; staff.team-members.tags.assign (undo executes; detail read-shape unverified).

Findings (not full pass):
- customers.activities.create / customers.todos.* — deprecated bridge route emits **no undo token** → #2506
- catalog.productUnitConversions — create needs a valid UoM code (test-data; not a product defect)
- customers.entityRoles — create needs `userId` (test-data; not a product defect)

## Cross-cutting (verified)
- ✅ X4 latest-only: undoing an older action while a newer exists → 400 "Undo token not available"
- ✅ X5 double-undo: consumed token rejected
- ✅ X6/X7 permission: employee undo of admin's action → 400 (no undo_tenant)
- ⚠️ X3 redo-of-create mints a new id → #2506

## Bugs filed
- #2498 customers.people.update undo no-op (encryption deep-decrypt re-baselines change tracking before flush; systemic class)
- #2504 scheduler.jobs undo no-op (reads logEntry.payload not commandPayload; use extractUndoPayload)
- #2507 customers.personCompanyLinks.create undo no-op (link persists; likely same encryption class as #2498)
- #2506 medium findings (deprecated-route no token; redo-of-create new id; feature_toggles.global ACL gap; exchange_rates 409)

## TODO (remaining scenarios)
customers: addresses, comments, activities, interactions(+complete/cancel), tags assign/unassign,
labels(+assign/unassign), todos(+unlink), deals, personCompanyLinks, dictionaryEntries(+kindSettings),
entityRoles, custom-field-heavy (X10), relations-heavy (X11). catalog: variants, offers, prices,
optionSchemas, productUnitConversions. sales: orders/quotes/invoices/credit_memos(+lines/adjustments),
payments, shipments, returns, document-addresses(non-undoable). staff: leave-requests(+accept/reject),
timesheets(entries/projects/members), activities/addresses/comments/job-histories, tags assign/unassign.
resources: activities, comments, resourceTags assign/unassign. planner: availability(+weekly/date-specific
replace), rule-sets. directory.organizations (null org_id, #2398). checkout: template/link. §4 negatives.
§5 X4/X6/X7/X8/X9/X12.

## Batch 3 (spot checks)
- ✅ customers.dictionaryEntries create→undo removes entry
- ❌ customers.personCompanyLinks.create undo no-op → #2507
- ⚠️ X10 cf-heavy undo: not independently verified (product/company cf API path not resolved this pass) — people cf undo blocked by #2498
- ⏭️ sales document lines/adjustments, planner weekly/date-specific replace, feature_toggles.overrides, sales.returns: endpoint/payload not resolved this pass — deferred to next phase (contracts.json + commands enumeration cover them)

## Batch 4-5 (verified)
- ✅ sales.orders.lines.upsert create→undo (line removed); ✅ sales.orders.adjustments.upsert create→undo (adjustment removed)
- ✅ unassign→undo restores membership (customers.tags: assign=1→unassign=0→undo=1)
- ✅ customers.interactions.update→undo restores title
- ⚠️ §4 DISCREPANCY: `sales.returns.create` emits an undo token (commandId=sales.returns.create) — spec §4 lists it as NON-undoable. Either spec is stale or returns gained unintended undo. (feature_toggles.overrides.changeState also marked undoable in the registry vs spec §4.) → noted on #2506
- ⏭️ Not reached via API this pass (pattern-identical to verified passes or no clean HTTP surface): staff team-member activities/addresses/comments/job-histories (route path not located), time_project_members assign (needs staffMemberId), planner weekly/date-specific replace (no HTTP endpoint — command-level), customers.todos (deprecated, no token — #2506), X8 tenant-isolation, X9 bulk undo, X10 cf-heavy (cf API not located), X11 relations-heavy, X12 search/index, catalog.productUnitConversions (needs valid UoM code).

## Coverage summary
Exercised every distinct undo mechanism across all undoable modules: create-undo, update-undo, delete-undo, redo, action/status-flip undo (complete/cancel/accept/reject), assign-undo, unassign-undo, document line/adjustment undo; plus cross-cutting latest-only, double-undo, permission scope, and §4 no-token negatives. ~60 scenarios verified. Failures isolate to #2498 (+#2507 same class) and #2504; findings in #2506.

## §5 cross-cutting — final status
- ✅ X4 latest-only, X5 double-undo, X6/X7 permission/actor scope — verified
- ✅ X10 custom-field restore (I4): company cf 5→10→undo→5→redo→10 — verified + green regression test
- 🔵 X8 cross-tenant isolation — undo route enforces `target.tenantId !== auth.tenantId` and org-scope (code-verified); actor-scope rejection empirically verified (X6/X7). Full cross-tenant empirical test needs a 2-tenant fixture (admin can't list/create tenants; requires superadmin) → next phase.
- 🔵 X9 bulk undo — individual delete→undo verified; the DataTable batch-undo banner is a UI-store concern (N tokens) → next phase (UI test).
- 🔵 X12 search/index consistency — undo emits the same CRUD side effects + re-index (`emitCrudUndoSideEffects` + indexer, code-verified in people/companies undo); explicit search-result assertion needs the search harness → next phase.
