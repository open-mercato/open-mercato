# Payment transaction sorting

Source doc: .ai/specs/2026-11-14-payment-transaction-sorting.md (design PR #9513)
Issue: #7788
Engine: om-auto-create-pr (steps: 3, --loop: no)

## Progress
- [x] Step 1: Validate API sort field/direction, stable ordering and scope tests.
- [ ] Step 2: Wire controlled server sorting to existing DataTable headers; add page request tests.
- [ ] Step 3: Add PostgreSQL and self-contained UI/API integration coverage; run validation and review.

## Decisions
Preserve createdAt descending default; compare numeric face values without currency conversion. No data migration, new dependency or shared component change.
