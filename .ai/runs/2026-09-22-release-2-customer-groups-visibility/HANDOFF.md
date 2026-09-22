# Handoff — 2026-09-22-release-2-customer-groups-visibility

**Last updated:** 2026-09-22T13:35:00Z
**Branch:** feat/release-2-customer-groups-visibility
**PR:** https://github.com/open-mercato/open-mercato/pull/6338 (draft)
**Current phase/step:** Phase 2, Step 2.6 (next todo row)
**Last commit:** 51dff0108 — test(customer_groups): add Phase 1 integration test suite (TC-CGRP-001..009)

## What just happened
- Session was interrupted by a provider rate limit mid-Step 2.6 dispatch; resumed after reset.
- Recovered a "cezar autosave (run finalize)" commit that had captured Step 1.13's completed work (9 Playwright integration tests + fixtures) — reviewed for quality (high), amended with a proper commit message, filled in the real SHA, pushed.
- Step 2.6 (explain-terms panel) failed instantly on the rate limit before writing any files — nothing to recover, safe to re-dispatch fresh.
- All of Phase 1 (1.1–1.14 minus 1.14 itself) and Phase 2 through 2.5 are now committed and pushed. 23 of 26 planned Steps done.

## Next concrete action
- Re-dispatch Step 2.6 (explain-terms panel on customer detail page — extends `person-groups-tab.tsx`, needs a new `GET /api/customer-groups/explain-terms?customerId=` route since `resolveTerms()` has no HTTP surface yet).
- Then 2.7 (i18n for Phase 2 surfaces — 2.5's terms section already added its own keys; 2.6 will need its own too), 2.8/2.9 (Phase 2 integration tests, mirroring 1.13's pattern), then Phase 3 (3.1–3.3, catalog-visibility library — independent of everything else, could be dispatched any time), 1.14 (Phase 1 UI integration tests — still pending, can run any time), then the final gate (step 9 of the skill: full validation.commands + full integration suite + DS pass), label normalization (step 10, MANDATORY `blocked` not `review`), review pass (step 11), summary (step 12), flip to ready (step 13).

## Blockers / open questions
- None new. Still logged (not blocking): pricing.ts group-priority tie-break deliberately unimplemented; sales tax-rate group picker ships inert (needs a follow-up `sales/` ask); drag-reorder full-row-lift is an accepted DataTable primitive limitation.

## Environment caveats
- Dev runtime runnable: not attempted this run. Postgres is running locally with several reusable `om_qa_*` databases from prior sessions, but no dev server has been started and no `.env`/QA env has been bootstrapped in this worktree yet.
- Integration tests (Step 1.13) are written and confirmed syntactically valid/discoverable (`playwright test --list`, 9/9 found) but NOT executed end-to-end — no live dev server + DB was set up for that step. The final gate (step 9) is the designated point for the authoritative full-suite run.
- Browser/UI checks: not yet attempted for any step.

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/18501eb5-8b15-41ac-929d-0633b3aa3903
- Created this run: no (pre-existing cezar worktree, reused)
- node_modules: installed; `yarn build:packages` current as of the last checkpoint.
