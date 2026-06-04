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

## Bugs filed
- #2498 customers.people.update undo no-op (encryption deep-decrypt re-baselines change tracking before flush; systemic class)
- #2504 scheduler.jobs undo no-op (reads logEntry.payload not commandPayload; use extractUndoPayload)

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
