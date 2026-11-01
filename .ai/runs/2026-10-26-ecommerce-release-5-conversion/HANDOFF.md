# Handoff — 2026-10-26-ecommerce-release-5-conversion

**Last updated:** 2026-10-27T18:20:00Z
**Branch:** feat/release-5-conversion (fork `adeptofvoltron/open-mercato`)
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/16 (draft, reused — not opened by this run)
**Current phase/step:** ALL implementation (Phases 1–6) COMPLETE. Full validation gate green.
Code-review pass done (1 real bug found and fixed). UI browser QA attempted and blocked by
machine-wide resource contention (documented, not a code defect). Remaining: PR description
update, draft→ready, release the in-progress claim, notify.
**Last commit:** `db3a4beb28` — docs(runs): record blocked browser-QA pass for Release 5 admin screens

## What just happened
- Step 6.4 (full gate) went green after 3 genuine fix-forward rounds, each a real regression this
  release introduced (not pre-existing): a docs notification-type-map staleness, a module-facts
  BC-budget cap that needed re-measuring for legitimate linear growth, and 5 structural-guard
  gaps in `@open-mercato/core` (optimistic-lock allowlist, command-interceptor-mapper allowlist,
  two `useParams()`→`params`-prop page fixes, 15 missing ACL-feature i18n keys, 2 missing
  notification-category i18n keys) — `core`'s own test suite never got far enough to run in the
  aggregate `yarn test` (turbo aborts the whole run on the first package failure) until run
  standalone, which is how all 5 were found. Commits: `5f911df618`, `0347d285bd`, `32291eb8d7`,
  `1da4930625`.
- A dedicated code-review pass (dispatched as 7 parallel deep-dive sub-agents, one per release
  gate invariant) ran against `fork/develop...HEAD`. Found and fixed ONE real blocker-class bug:
  `promotions/lib/code-service.ts#useCode` was not idempotent on checkout-recovery retry — a
  crash-recovery retry of an already-committed code use could double-consume a multi-use code or
  wrongly cancel an already-valid single-use-code order. Fixed with an idempotency lookup on
  `(codeId, cartId, orderId, revertedAt: null)` plus 2 regression tests. Commit `204f2a4853`.
  Everything else across the 7 priority areas (availability/credit concurrency, D-R5-21/22
  session binding, money correctness, approval gate, visibility, the other 3 compensation legs,
  tenant scoping/optimistic locking) came back CLEAN with real evidence, including real-Postgres
  N=20-parallel concurrency tests. One item flagged-not-fixed: the `purpose:'quote'` cart-lock
  path has no approval-gate check by explicit D-R5-23 design, and the pre-existing public
  `sales/api/quotes/accept` route converts a quote to an order with zero approval reference — a
  known, scoped limitation per D-R5-23, not a new gap, but worth a line in the PR description for
  a maintainer's awareness.
- UI browser QA was attempted for real (not skipped): fresh `.env`, disposable `om_qa_r5` DB,
  forced `build:packages`/`build:app` rebuilds (confirmed 0-cached), migrations + `mercato init`
  all genuinely run — but the booted dev server was completely unresponsive (every request
  404'd or timed out at 45-60s, including after an auto-restart) while this machine's swap sat at
  ~95-96% full from unrelated concurrent cezar sessions. Waited 10 minutes, swap was still ~96%
  full, judged a same-session retry not worth the time. Decision + full context recorded in
  PLAN.md's "Decisions taken without the owner" (last entry) and NOTIFY.md. The dev server was
  killed and `om_qa_r5` dropped — nothing left running. One UI fact WAS confirmed before the
  server died: there is no dedicated staff admin UI for purchase approvals in this release (API
  routes only) — matches the Step 2.6/G15 decision already on record.

## Next concrete action
1. Update PR #16's description: scope, the 6 implementation waves, the release gates, deviations
   from the brief (the `min_order_value` fail-open correction from Phase 5, the D-R5-23
   quote-channel approval-gate scope limitation above), and point at the full "Decisions taken
   without the owner" log in PLAN.md rather than reproducing it. Explicitly flag that browser UI
   QA screenshots could not be captured this run (machine contention, documented) and that a
   human or a later run should do that pass before or shortly after merge.
2. Flip PR #16 from draft to ready, on the fork repo (`gh pr ready 16 --repo adeptofvoltron/open-mercato`).
3. Release any in-progress claim this run holds (this run never actually took a claim lock since
   PR #16 was reused per the brief's own override, not claimed via the normal auto-skill flow —
   confirm no stray `in-progress` label/assignee/claim-comment exists before finishing; if one
   does, release it).
4. Send the final PushNotification with the result and the PR #16 URL.

## Blockers / open questions
- None that block finishing this run. The UI-QA gap above is documented, not blocking — it's an
  honest limitation to hand off, not a reason to stop.

## Environment caveats
- Gate runner: local (no Docker `app` container running this whole run). Every turbo-driven
  command in this cezar worktree needs `TMPDIR=/private/var/tmp` + (for `yarn test`)
  `--env-mode=loose`, or tsx/jest crash with an EINVAL on a too-long unix socket path.
  `yarn test` aborts the WHOLE aggregate run on the first package's failure — always check that a
  package you care about actually printed its own `Tests:` summary line before trusting an
  aggregate "green", and re-run it standalone (`yarn workspace @open-mercato/<pkg> test`) if not.
- Real local Postgres is available on `127.0.0.1:5432` (Homebrew) — confirmed and used throughout
  Phase 5/6 for every `.pg.test.ts` real-concurrency suite and the review pass's own verification,
  via disposable throwaway databases, dropped immediately after each use. Nothing persisted.
- This machine runs many concurrent cezar sessions and can hit severe swap exhaustion (seen at
  ~96% of 32GB) — if a future QA pass on this host also 404s/times out a freshly-booted,
  successfully-compiling dev server, check `sysctl vm.swapusage` / `uptime` before suspecting the
  code; this is a known, recurring, machine-level pattern here, not unique to this branch.
- `yarn db:migrate` has never been run against any shared/persistent database this entire run —
  every real-Postgres verification used a disposable, dropped-after-use database, per the
  operator's standing instruction.

## Worktree
- Path: `/Users/bernard/workspace/open-mercato/.ai/tmp/release-5-conversion-impl`
- Created this run: yes (no prior worktree existed for this branch)
- Clean and fully pushed to `fork/feat/release-5-conversion` as of commit `db3a4beb28`.
