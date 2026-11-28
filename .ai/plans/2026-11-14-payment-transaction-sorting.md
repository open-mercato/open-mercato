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
Runner: local (no running compose app container). Package build/generate/build, translation checks, and DS lint passed (existing warnings only). Payment module unit/component tests: 244 passed. PostgreSQL sorting/paging/scope suite: six passed and two SELECT statements per request. Negative control: 11 regressions fail on original production files; all 17 affected tests pass with the change. Four EN/PL Playwright cases discover successfully. Merged main ed37e45855 (including the upstream ComboboxInput fix); global typecheck passes across all 42 tasks. The forced fresh full test run fails in two unchanged shared dynamic-loader cases on an overlong subprocess IPC path; that workspace reports 3,344 other tests passed. Production app bundling and dev bootstrap fail before UI exploration; the exact feature browser run also fails during unchanged app bundling before scenarios execute. No independent review or QA approval is claimed.
