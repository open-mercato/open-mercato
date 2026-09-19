# Handoff — 2026-09-19-pluggable-tax-providers

**Last updated:** 2026-09-19T18:20:00Z
**Branch:** feat/pluggable-tax-providers
**PR:** #4 (draft, base `develop`)
**Current phase/step:** all 31 in-scope Steps done; final gate passed
**Last commit:** 69ac7b046 (review fixes)

## What just happened
- **All 31 in-scope Steps are complete** (Phases 1, 2, 3, 4 and 6). Phase 5 stays deferred.
- The full configured gate passed — see `final-gate-checks.md`. `@open-mercato/core` is green at
  1938 suites / 17,454 tests; `yarn build:app` builds; zero missing i18n keys.
- Both migrations were verified against a real database.

## Next concrete action
- **None for this agent.** The run is complete: all 31 in-scope Steps landed, the full gate passed,
  the review pass ran and its two findings are fixed, labels and comments are posted.
- What remains is a **human decision**: confirm or change the spec's Q7 row, then flip the PR out of
  draft. Resuming would only be needed if Phase 5 is un-deferred.

## Blockers / open questions
- **Scope:** Phase 5 is deferred by the owner and must NOT be implemented. Steps 5.1-5.5 are
  `deferred` in `PLAN.md`. The optional `commit` / `adjust` / `void` methods and the `capabilities`
  block stay in the `TaxProvider` type only (`lib/providers/types.ts`). MVP is Phases 1, 2, 3, 4, 6.
- **The PR stays a draft** against `develop` — the owner's instruction, and independently the spec's
  Q7 `⚠ NEEDS HUMAN CONFIRMATION` row (core-owned semantics for `tax_strategy_key` / `tax_info`).
- No merge, no deploy, no package publish.

## Spec deltas recorded so far
- `TaxRequestLine` gains `amountGross` and `taxAmount`; `TaxRequestCharge` gains `amountGross` and
  `taxAmount`. Without the engine's own per line figure, `table-rates` cannot be the exact identity
  the spec's central guarantee requires. See the NOTIFY entry at 2026-09-19T10:20:00Z.
- The catalog fact lookup in `resolveTaxDocumentContext` is lazy (`loadProductFacts`, default off for
  `table-rates`), so the default path adds no query to any document write and the two return
  recalculations that run inside an open transaction stay query free.
- `table-rates` emits no jurisdiction detail row for a zero-tax line.

## Known pre-existing failures (not this branch)
- `@open-mercato/cli`: 5 tests in `resolve-environment.test.ts` and `resolver.enterprise.test.ts`.
  Reproduced on `origin/develop` in this worktree. This branch touches no file under `packages/cli`.

## Environment caveats
- Dev runtime runnable: yes (`omw up`, slot 1, port 3110, https://task1-om.systevio.dev).
- Runner: local (`yarn X`) — no compose `app` container is running.
- Browser / UI checks: available through the repository's Playwright integration suite. Nothing to
  capture yet; the first UI surface lands in Step 2.7.
- Database/migration state: shared instance database. Migrations are authored and committed but
  NEVER applied from this worktree. Step 2.1 authors one; do not run `yarn db:migrate`.

## Worktree
- Path: /srv/om/repos/open-mercato/.ai/cezar/worktrees/3210729b-2d8c-49cf-a3ea-8e7ef0f83216
  (resumed session; the first session ran in worktree 8aab749e)
- Created this run: no (reused the task's linked worktree)
