# Register `template-i18n-parity.test.ts` in the repo-wide guard registry

**Date:** 2026-08-17
**Slug:** `repo-wide-guards-template-i18n-parity`
**Branch:** `fix/repo-wide-guards-template-i18n-parity`
**Base:** `develop`

## Goal

Unbreak `develop`: register the cross-package test `packages/create-app/src/lib/template-i18n-parity.test.ts` in `scripts/repo-wide-guards.mjs` so `scripts/__tests__/repo-wide-guards.test.mjs` passes again and the new locale-parity gate is guaranteed to run unfiltered.

## Scope

One entry appended to `CROSS_PACKAGE_EXCEPTIONS` in `scripts/repo-wide-guards.mjs`. Nothing else.

## Background

PR #5272 (merged as `f7a9ed6fa`) added `packages/create-app/src/lib/template-i18n-parity.test.ts`, which reads files outside its own package — `apps/mercato/src/i18n/**` — and imports `scripts/template-sync.ts`.

`scripts/__tests__/repo-wide-guards.test.mjs:87` (`no test that audits other packages is left unclassified`) enforces a repository-wide invariant: every such test must be enumerated in either `REPO_WIDE_GUARDS` (to run unfiltered) or `CROSS_PACKAGE_EXCEPTIONS` (with a stated reason). The new test is in neither list, so the guard fails.

Confirmed against the real `develop` head `f7a9ed6fa`: `node --test scripts/__tests__/repo-wide-guards.test.mjs` → **15 pass, 1 fail**. Until this lands, the `test` job is red on `develop` and on every PR targeting it.

This is not only a red check. The registry exists so the turbo `--filter=[base]...` selection cannot skip a cross-package test on a PR that changes the files it audits. Without the entry, a PR touching only `apps/mercato/src/i18n/**` would not select `create-mercato-app`, so the very drift #5272 was opened to prevent could reappear without its new gate ever running.

`CROSS_PACKAGE_EXCEPTIONS` is the correct list rather than `REPO_WIDE_GUARDS`: the "Check create-app template parity" CI step already runs the whole `create-mercato-app` suite unconditionally, which is exactly what the exception records. The sibling `packages/create-app/src/lib/template-example-module-parity.test.ts` is registered there with that same reason (#3779), so this change follows an established precedent five lines away in the same file.

## Non-goals

- Do not modify `packages/create-app/src/lib/template-i18n-parity.test.ts`, the locale dictionaries, or `scripts/template-sync.ts` — everything else from #5272 is correct and reviewed.
- Do not add a new test. `scripts/__tests__/repo-wide-guards.test.mjs` is itself the regression test for this change: it fails before the entry and passes after, which is exactly the coverage this fix needs. A second test asserting the presence of a registry entry would duplicate it.
- Do not move the test into `REPO_WIDE_GUARDS`. That would add it to the seconds-budgeted common PR path for no benefit, since the create-app parity step already runs it unfiltered.
- Do not revisit the two non-blocking observations from the #5272 review (the `**/*.test.ts` typecheck exclusion; root `AGENTS.md` at 45 bytes of headroom). Both are tracked in that PR's review and neither belongs in a develop-unblocking fix.

## Risks

- **Very low.** One data entry in a repo-local dev script. No runtime, product, or published-package surface is touched; `scripts/repo-wide-guards.mjs` is a developer tooling module.
- The only way this is wrong is if the stated reason is false — i.e. if the create-app parity CI step did *not* run the suite unconditionally. Verified as part of the #5272 review, and it is the same claim the four sibling create-app entries already rest on.

## Implementation Plan

### Phase 1: Register the test and verify the guard

- 1.1 Add the `template-i18n-parity.test.ts` entry to `CROSS_PACKAGE_EXCEPTIONS` in `scripts/repo-wide-guards.mjs`, directly after the `template-example-module-parity.test.ts` entry.
- 1.2 Verify `node --test scripts/__tests__/repo-wide-guards.test.mjs` is 16 pass / 0 fail, and confirm it fails without the entry (so the guard is genuinely what this fixes).
- 1.3 Verify `node --test packages/create-app/src/lib/template-i18n-parity.test.ts` still passes 3/3.

### Phase 2: Validation gate and PR

- 2.1 Run the configured validation gate, scoped to what this diff can affect.
- 2.2 Open the PR against `develop`, referencing #5272 as the cause and #3779 as the exception precedent.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Register the test and verify the guard

- [ ] 1.1 Add the `CROSS_PACKAGE_EXCEPTIONS` entry
- [ ] 1.2 Verify the repo-wide guard test goes green, and red without the entry
- [ ] 1.3 Verify the locale parity test still passes

### Phase 2: Validation gate and PR

- [ ] 2.1 Run the validation gate
- [ ] 2.2 Open the PR
