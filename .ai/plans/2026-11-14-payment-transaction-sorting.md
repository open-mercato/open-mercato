# Payment transaction sorting

Source doc: .ai/specs/2026-11-14-payment-transaction-sorting.md (design PR #9513)
Issue: #7788
Engine: om-auto-create-pr (steps: 3, --loop: no)

## Progress
- [x] Step 1: Validate API sort field/direction, stable ordering and scope tests.
- [x] Step 2: Wire controlled server sorting to existing DataTable headers; add page request tests.
- [x] Step 3: Add PostgreSQL and self-contained UI/API integration coverage; run validation and review.

## Decisions
Preserve createdAt descending default; compare numeric face values without currency conversion. No data migration, new dependency or shared component change.

## Validation
Runner: local (no running compose app container). Package build/generate/build, translation checks, and DS lint passed (existing warnings only). Payment module unit/component tests: 244 passed. PostgreSQL sorting/paging/scope suite: six passed and two SELECT statements per request. Negative control: 11 regressions fail on original production files; all 17 affected tests pass with the change. Four EN/PL Playwright cases discover successfully. Shared ComboboxInput/CrudForm and staff type errors block global/core typecheck; no payment sorting type error remains. Full shared tests fail on a temporary IPC path. Production app bundling and dev bootstrap fail before UI exploration; exact feature browser run is attempted separately. No independent review or QA approval is claimed.
