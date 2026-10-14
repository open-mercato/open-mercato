# Handoff — 2026-10-14-ecommerce-release-4-write-side

**Last updated:** 2026-10-14T21:00:00Z (Phase 1 CLOSED — all 10 steps done)
**Branch:** feat/release-4-write-side
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/15 (draft, base `develop` on the fork)
**Current phase/step:** Phase 1 (Steps 1.1–1.10) fully done; resume at Phase 2, Step 2.1
**Last commit:** see `git log` on `feat/release-4-write-side` — Step 1.10's commit (UI integration tests + two real bug fixes it surfaced) is the most recent

## What just happened
- Phase 1 is now fully closed. Steps 1.7–1.10 landed this session, on top of the 1.1–1.6 already closed at checkpoint 2:
  - **1.7** promotion form pages (create/detail, `CrudForm`) + `RuleGroupNode` recursive tree builder.
  - **1.8** benefit card (Applies to / Limits / Which pieces / echo line).
  - **1.9** API integration tests (`TC-PROM-001/002/003/004/062/062b/067/071/073`) — found and fixed a real cross-tenant existence-oracle bug (`commands/shared.ts`'s `assertPromotionScopeOrNotFound`).
  - **1.10** UI integration tests (`TC-PROM-074/075/076`) — found and fixed **two more real bugs** the API-level tests in 1.9 could not catch, because they are purely about how the browser-rendered UI behaves:
    1. `backend/promotions/[id]/page.tsx` read its dynamic `id` segment via `useParams()` from `next/navigation`. This app resolves every backend page through a single catch-all route (`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`) that never populates a Next.js router param named `id` — it passes `{ id }` down as a plain `params` prop instead. The page silently rendered nothing (`!promotionId` early-return) for every real visit. Fixed by switching to the `params` prop, per the `customers/backend/customers/people-v2/[id]/page.tsx` precedent for this exact pattern.
    2. `BenefitCard.tsx`'s Labels section used `collapsed={labelsInvalid ? false : labelsCollapsed}` to force the section open while a benefit had no valid label. The moment the user typed a non-blank label, `labelsInvalid` flipped to `false` and the expression fell through to `labelsCollapsed`'s default (`true`), instantly collapsing the section and unmounting the input the user had just typed into. Fixed with a `labelsCollapsed` state whose only forced transition is open-when-invalid (via an effect), never forced closed — so it stays open once the operator is mid-edit.
  - Also fixed one TypeScript narrowing issue in `[id]/page.tsx` (promotionId captured in a nested closure didn't retain the outer `if (!promotionId) return` narrowing) and one wrong test assumption in `TC-PROM-075` (the "Limit to the Nth piece/line" checkbox is *hidden*, not merely disabled, once a quantity cap is set — `BenefitLimitsEditor` only renders it in the uncapped branch).
- Both UI-bug fixes were caught by the Step 1.10 Playwright specs themselves failing against a real dev server + Postgres DB (not jest/unit tests) — this is exactly the kind of bug a pure API-contract test suite cannot see, which is why Step 1.10 existed as a separate step from 1.9.
- Full validation re-run after the fixes, all green: `yarn workspace @open-mercato/core build`, `yarn typecheck --force` (39/39 packages), `yarn lint --force` (0 errors), `yarn jest src/modules/promotions` (25/25 unit tests), full promotions Playwright suite (`npx playwright test ... promotions`, 19/19 passed + 1 pre-existing flaky test — `TC-PROM-001` — recovered on its built-in retry, unrelated to this session's changes).
- The throwaway diagnostic file `__integration__/zz-probe.spec.ts` (created mid-session to inspect a blank `<main>` render) was deleted before committing.

## Next concrete action
- Phase 2 (SPEC-055 Phase 2 — promotions evaluation engine), starting at Step 2.1: `lib/types.ts` public types barrel and `lib/evaluation-engine.ts` (pure three-pass evaluator over `NormalizedPromotion[]`, no DB access). Read PLAN.md's Phase 2 section and the corresponding SPEC-055 sections fresh before dispatching.
- A checkpoint-pass covering Steps 1.7–1.10 is due — the last PR comment only covered through Step 1.6. Post one before or right after starting Phase 2 so the gap doesn't widen further.

## Blockers / open questions
- None blocking. Phase 1 is complete and green.

## Environment caveats (live test environment still warm from Steps 1.9/1.10)
- A full live test stack is running and was last confirmed healthy: Next.js dev server (`yarn workspace @open-mercato/app dev`), a disposable Postgres DB (`om_qa_prom19`, `apps/mercato/.env` — gitignored, not committed), a queue worker, and a scheduler. Reuse this rather than tearing it down, unless it has gone stale by the time Phase 2 starts (in which case re-provision per `.ai/qa/AGENTS.md`).
- **This app's dev server serves `@open-mercato/core`/other packages from their built `dist/` output, not live TypeScript source.** Any source edit under `packages/<pkg>/src/` requires `yarn workspace @open-mercato/<pkg> build` (or `yarn build:packages`) before a browser/Playwright re-check will see it — this cost significant time this session (two full Playwright re-runs were wasted on a stale build before this was re-confirmed). Rebuild immediately after any `packages/` edit, every time, before re-testing in the browser.
- Node 24 via `export PATH="/opt/homebrew/bin:$PATH"` works in this environment.
- `TMPDIR=/tmp` export needed before any `tsx`-based script (`yarn i18n:check-sync`, etc.) or it EINVALs.
- No `timeout` binary on this Mac (zsh) — don't rely on it in scripts; use a `while kill -0 $PID; do sleep N; done` loop instead, with the Bash tool's own `run_in_background: true` for the backgrounding (manual `&`/`disown`/redirect buffers stdout until process exit and gives no interim signal).
- Database/migration state: clean; the promotions migration from Step 1.2 is committed but never applied via `yarn db:migrate` against the *tracked* dev database (the disposable `om_qa_prom19` QA database is separate and does have it applied, from Step 1.9's setup).
- Fork repository: `adeptofvoltron/open-mercato`. Pass `-R adeptofvoltron/open-mercato` on every `gh` call. Upstream `open-mercato/open-mercato` must never be touched; issues are disabled on the fork.
- **Re-check `git fetch fork feat/release-4-write-side` before every push.**

## Worktree
- Path: this cezar run's own worktree (`.ai/cezar/worktrees/e12a1916-0f76-40d7-a20f-3395d9ab0856`), checked out at `feat/release-4-write-side`, tracking `fork/feat/release-4-write-side`.
