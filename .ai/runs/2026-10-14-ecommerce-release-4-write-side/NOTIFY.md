# Notify — 2026-10-14-ecommerce-release-4-write-side

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-14T00:00:00Z — plan authored
- Brief: eComm Release 4 (write side) — cart Phases 1–3, promotions Phases 1–3, visibility Phase 3; implemented on the fork first.
- Decisions: D-R4-1…29 in `.ai/specs/analysis/ANALYSIS-2026-10-14-ecommerce-release-4-decisions.md`.
- External skill URLs: none

## 2026-10-14T13:00:00Z — Step 0.1 complete, resumed om-auto-continue-pr-loop
- Resumed PR #15 (adeptofvoltron/open-mercato) at Step 0.1 per HANDOFF.md.
- Step 0.1 done: `.ai/specs/2026-08-14-cart-module.md` rev 9, applying D-R4-1..29/C1-C14. Commit on feat/release-4-write-side (pushed).
- Noticed a concurrent push to the branch mid-session: a merge of `origin/develop` bringing in #7298 (tax-providers roadmap pointer touching cart §5.2 trigger 5 + Changelog). Merged cleanly (one changelog-ordering conflict, resolved by keeping both entries newest-first). Branch owner appears to be syncing develop into this feature branch concurrently with this run — worth checking before each future push.
- Next: Step 0.2 (SPEC-055 promotions amendment).

## 2026-10-14T14:30:00Z — Phase 0 complete (checkpoint)
- Steps 0.1-0.4 all done: cart-module.md rev 9, SPEC-055 v2.2.0, buyer-scoped-catalog-visibility Phase 3 folded into cart, roadmap ADR-2/ADR-7 touch-ups, scope-status file updated. All D-R4-1..29 decisions are now reflected in spec text; the decisions record is no longer authoritative over the spec text per its own rule.
- Docs-only phase; no code, no migrations. Full validation gate (yarn build:packages/generate/typecheck/test/etc.) not yet run — nothing to validate for a docs-only change beyond the specs-folder find command (ran clean, 616 files).
- Next: Step 1.1 (promotions module scaffold: index.ts, acl.ts, events.ts, setup.ts, di.ts). This is the first code-writing step and the first candidate for the Exec: dispatch pattern per PLAN.md's Exec column.

## 2026-10-14T15:40:00Z — Plan correction: app registration moves earlier (decision, not a blocker)
- Step 1.2's dispatched executor registered `promotions` in `apps/mercato/src/modules.ts`, which PLAN.md's Step 1.1 note had reserved for Step 7.8. Verified via a research dispatch: `yarn db:generate` has no way to discover an unregistered module's entities (its module list comes only from `enabledModules` in that file; no `--module` scoping flag exists). The original Step 7.8 plan was unachievable as written.
- Decision (smallest conservative fix, continuing per the loop's blocker rule): accept the registration now; PLAN.md's Step 1.1 note and Step 7.8 row/bullet rewritten to say so. `cart`'s own Step 4.2 will do the same for the same reason. Step 7.8 narrows to the create-app template sync only.
- Verified the rest of Step 1.2's work directly (not just trusting the subagent's report): read the migration SQL, confirmed `ON DELETE RESTRICT` on `promotion_usages.promotion_id`, `ON DELETE SET NULL` on `promotions.rule_group_id` (breaking the circular FK the right way), cascade elsewhere; confirmed forms/wms were untouched in the final commit despite being touched transiently during `db:generate` (git status clean, diff empty against those paths).

## 2026-10-14T16:30:00Z — Plan correction: Step 6.1 duplicated Step 1.2's work
- My own Step 1.2 dispatch over-scoped: I handed the executor the whole §Data Models section instead of just the Phase-1 rows (Promotion/RuleGroup/Rule/Benefit/PromotionUsage), so it also built Code/GeneratedCode/CodeReservation/CodeUsage — which PLAN.md's Phase 6 Step 6.1 had separately scheduled. The Step 1.2 agent itself flagged this in its report; I'm resolving it now rather than letting it surface again at Phase 6.
- Fix: Step 6.1 marked done (built in Step 1.2), with a note pointing at the actual entity classes and migration file. Step 6.2 onward (code commands/service) proceeds normally against the existing schema.

## 2026-10-14T17:35:00Z — Checkpoint 2 (Phase 1 Steps 1.1-1.6)
- Steps 1.1-1.6 done: module scaffold, data model + migration (over-scoped into code entities, resolved against Step 6.1), promotion CRUD commands, rule-tree/order routes, CRUD API routes, i18n + list page.
- The full `@open-mercato/core` test suite (2341 suites, run once at this checkpoint) caught one real regression Step 1.1 introduced: the `auth` module's ACL-feature i18n catalog test failed because the new `promotions.*` features had no `auth.acl.features.promotions.*` translation entries. Fixed (commit 108fdf96da) and re-verified with a targeted re-run.
- Step 1.6 flagged a real gap in Step 1.5: the promotion list response has no rule-tree-non-empty flag, so delete-confirmation can't be conditional on tree emptiness per the spec; it confirms unconditionally (safe default) instead. Tracked, not yet fixed — low priority, revisit if a later step touches the list projection anyway.
- Posting checkpoint-2 comment to PR #15 next, then continuing to Step 1.7.

## 2026-10-14T19:25:00Z — Step 1.9 complete; environment kept warm for Step 1.10
- 16 Playwright API integration tests for promotions, all passing. Found and fixed a real cross-tenant-existence-oracle bug (403 instead of 404) in the update/delete/reconcile/reorder commands while writing TC-PROM-004 (`commands/shared.ts`'s `assertPromotionScopeOrNotFound`).
- Note on process continuity: the Step 1.9 dispatch from the prior turn set up a live dev server (apps/mercato, PID family under node, started ~18:56) + disposable Postgres DB (`om_qa_prom19`) + queue worker + scheduler, then got interrupted mid-wait (the session's context reset before it could report). Its work was NOT lost — found 9 staged files plus a real bug fix on disk, verified independently (re-ran the full suite twice, fixed one real test bug of my own — a missing eligibleCurrencies on the TC-PROM-002 fixture — and one real typecheck error in helpers.ts's recursive type), then committed.
- Decision: keeping the dev server + DB running rather than tearing down, since Step 1.10 (Phase 1 UI integration tests) needs the identical live environment next. Will tear down after 1.10 or at the next checkpoint.
- Lesson for future resumes: if a dispatched agent's final report never arrives (context reset, etc.), check `git status`/`ps aux` before re-dispatching from scratch — there may be real, valuable uncommitted work sitting in the worktree.

## 2026-10-14T21:00:00Z — Step 1.10 complete; Phase 1 fully closed
- 3 Playwright UI integration tests for promotions (TC-PROM-074/075/076), all passing. These are deliberately browser-driven (real clicks/fills against the compiled admin UI), distinct from Step 1.9's API-contract tests, and they earned their keep: they caught two real bugs the API tests structurally cannot see.
  1. `backend/promotions/[id]/page.tsx` used `useParams()` to read the dynamic `id` segment. This app routes every backend page through one catch-all route (`apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx`) that resolves the dynamic segment itself and passes it down as a `params` **prop** — `useParams()` only ever sees `{ slug: [...] }` here. The detail page silently rendered nothing for every real visit (an early `!promotionId` return). Fixed per the `people-v2/[id]/page.tsx` precedent for this exact app-wide pattern.
  2. `BenefitCard.tsx`'s Labels `CollapsibleSection` was wired as `collapsed={labelsInvalid ? false : labelsCollapsed}`. The section correctly force-opened while labels were empty/invalid, but the moment the operator typed a valid label, `labelsInvalid` flipped to `false` and the expression fell through to `labelsCollapsed`'s default `true` — collapsing the section and unmounting the input mid-edit. Fixed with an effect that only ever forces it open (never closed), so a mid-edit expand persists.
- Also fixed, incidental to the above: a TS narrowing gap in `[id]/page.tsx` (promotionId's `if (!promotionId) return` guard didn't carry into a nested `async function load()` closure — caught by the full `yarn typecheck --force` gate, fixed by capturing a local `const id = promotionId`), and one of TC-PROM-075's own assertions, written against a wrong assumption (`BenefitLimitsEditor` hides the "Limit to the Nth piece/line" toggle entirely once a benefit is capped — not disables it) — found by reading the real component rather than trusting the test's own doc comment.
- Both of the real app bugs were caught specifically because Step 1.10 tests a real dev server + Postgres DB through a real headless browser, not jest mocks. This is the whole reason Step 1.10 is scheduled as its own step after 1.9, not folded into it.
- Lesson applied mid-debug, worth keeping for future steps: this dev server serves packages from their built `dist/` output, so a `packages/**/src` edit is invisible to a running dev server / Playwright run until `yarn workspace @open-mercato/<pkg> build` (or `yarn build:packages`) re-runs. Burned two full ~6-minute Playwright re-runs on this before re-confirming it — rebuild immediately after every source edit, before the next browser check, no exceptions.
- Full validation re-run clean after all fixes: core package build, `yarn typecheck --force` (39/39), `yarn lint --force` (0 errors), `yarn jest src/modules/promotions` (25/25), full promotions Playwright suite (19/19 + 1 known-flaky pre-existing test recovered on retry). Deleted the throwaway `zz-probe.spec.ts` diagnostic file before committing.
- Phase 1 (Steps 1.1–1.10) is now fully done. Next: Phase 2 (promotions evaluation engine), starting Step 2.1. A PR checkpoint comment covering Steps 1.7–1.10 is due before/at the start of Phase 2 (last one posted only covered through 1.6).
