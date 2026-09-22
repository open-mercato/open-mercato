# Handoff — 2026-09-22-release-2-customer-groups-visibility

**Last updated:** 2026-09-22T09:50:00Z
**Branch:** feat/release-2-customer-groups-visibility
**PR:** not yet opened
**Current phase/step:** Phase 0, Step 0.2 (run-folder commit)
**Last commit:** 29be10b03 — chore: stack on PR #6268 (pricing engine phases 1-2) — unmerged dependency

## What just happened
- Merged PR #6268 (`cez/d58af91f` @ c2c6c420b9c) into the feature branch as the first commit — confirmed `customerGroupIds`, `currencyCode`, `buildPriceRowFilter`, and the `@deprecated` marker are present in `packages/core/src/modules/catalog/lib/pricing.ts`.
- Three research passes completed and folded into `PLAN.md`: full customer_groups spec §14 Phase 1/2 extraction, full catalog-visibility spec §12 Phase 1 + §11 test matrix extraction, and reference-pattern survey (customers module CRUD shape, drag-reorder patterns, widget-injection wiring, tryResolve pattern).
- Resolved an ambiguity in the brief: the group-priority tie-break inside `catalog/lib/pricing.ts` (`scorePrice`/`selectBestPrice`) will NOT be implemented — it requires editing resolver internals owned by #6268 and gated by `catalog/AGENTS.md` § Ask First. Logged as a Risk in `PLAN.md` and a blocker entry in `NOTIFY.md`.
- Drafted the full 26-step `PLAN.md` Tasks table across Phase 1 (groups/membership), Phase 2 (terms), Phase 3 (catalog-visibility).

## Next concrete action
- Commit this run folder (`0.2`), push, open the draft PR (with `Tracking plan:` line), claim it with the three-signal lock, then begin Step 1.1 (scaffold `customer_groups` module skeleton) inline.

## Blockers / open questions
- See PLAN.md Risks: group-priority tie-break in pricing.ts deliberately not implemented (logged, not blocking the rest of the run).

## Environment caveats
- Dev runtime runnable: unknown (not yet started this run)
- Browser / UI checks: not yet attempted
- Database/migration state: clean (no migrations generated yet)

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/18501eb5-8b15-41ac-929d-0633b3aa3903
- Created this run: no (pre-existing cezar worktree, reused)
