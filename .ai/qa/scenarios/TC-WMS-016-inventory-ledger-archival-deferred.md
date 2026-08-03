# Test Scenario 016: Inventory Ledger Archival (Deferred)

## Test ID
TC-WMS-016

## Category
Warehouse Management System

## Priority
Low (backlog)

## Type
Deferred — no automated test until product spec exists

## Status
**Deferred** — out of scope for WMS phases 1–5. Tracked as future work in `.ai/specs/2026-04-15-wms-roadmap.md` → **Deferred backlog (TODO — after phases 1–5)** → Inventory ledger archival.

## Description
When implemented, this scenario will validate **archival** of immutable inventory ledger history: retention windows, movement of cold data to secondary storage, optional checkpoint/summary rows, read APIs or admin workflows for archived periods, and policies that preserve auditability without unbounded primary-DB growth.

Until a follow-up specification defines commands, jobs, and APIs, **do not** implement Playwright coverage for this case.

## Prerequisites (future)
- Archival feature flag or module configuration exists
- Sufficient movement history volume or synthetic load fixture
- Operator or system role for archival policy management

## API Endpoint (for API tests)
TBD — to be filled when archival is specified (e.g. admin jobs, export, or read-only archive queries).

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| — | *Not applicable until archival is in scope* | Roadmap defers ledger archival; reopen this file when the spec lands |

## Expected Results (target)
- Archival does not break immutability guarantees for in-primary-store movements
- Balances and current availability remain correct after archival windows are applied
- Compliance / audit trail remains explorable for required retention horizon

## Edge Cases / Error Scenarios
- Partial failure during archival batch must not leave balances inconsistent with remaining ledger rows
- Concurrent writes during archival windows must remain safe (locking or snapshot semantics TBD in spec)

## References
- `.ai/specs/2026-04-15-wms-roadmap.md` — Deferred backlog, Ledger and Balance Divergence (ledger growth)
