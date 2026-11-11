# Execution plan: module search ranks like the catalog (adopted from PR #8117)

**Origin:** adopted. Reconstructed by `om-auto-continue-pr` on 2026-10-28 because PR #8117 carried no execution plan.
**PR:** #8117 · **Branch:** `catalog/module-search` · **Base:** `main`
**Author:** @wojciechszyjka. This plan interprets the run order; correct it by editing this file or commenting on the PR.

## Goal

`yarn mercato module search|info` answer exactly like the catalog's `search_modules` and `get_module` tools as of the
catalog search change of 25 Oct, proven by goldens produced by the catalog's own handlers, and the PR is driven to
merge-ready.

## Scope

- `packages/cli/src/lib/module-search-index.ts`, `module-search.ts`, their tests and fixtures.
- Docs page `apps/docs/docs/cli/module-search.mdx` and the spec `.ai/specs/2026-10-23-cli-module-search.md`.

## Non-goals

- `check_compat`, `plan_install` and `get_changes` are not ported. `module info` keeps `anatomy` and `untrusted` null.
- No change to the catalog repository (open-mercato/modules).
- No merge and no approval.

## Evidence

| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| The catalog search changed on 25 Oct (stop words, weak OR cut, filter without query, typo retry, new fields) | PR body "Reviewers should know", run order of 2026-10-28, open-mercato/modules commits ac334ca, d258ff1, b0c242b | high |
| 8 of 34 goldens match the current catalog | Rerun of `mcp/handlers.ts` at 587b293 on the PR fixture | high |
| Source of truth is open-mercato/modules main, `lib/core/search.ts` and `mcp/handlers.ts` | Run order | high |
| Drive the PR with `om-auto-fix-pr 8117 --no-ui` after the port | Run order | high |

## Assumptions

- The goldens keep the fixture data of 23 Oct; new behaviour that this data cannot show (presets, preview receipts) is
  covered by a declarative patch applied identically by the generator and the test.
- `minisearch@7.2.0` stays the engine; the catalog pins the same version.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port the catalog search

- [x] 1.1 Port ranking, answer fields and info warnings from open-mercato/modules 587b293 — 3469f327ac
- [x] 1.2 Regenerate goldens from the catalog handlers and document how in the fixture README — 3469f327ac
- [x] 1.3 Update the docs page and the spec — 0ab46ce84b

### Phase 2: Merge-ready

- [x] 2.1 Full validation gate — b654198707
- [x] 2.2 Drive the PR with om-auto-fix-pr 8117 --no-ui — ea19435c81

## Validation notes

Gate at b654198707, local Linux, Node 24.21.0, no compose `app` container: `build:packages`, `generate`,
`build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck` and `build:app` passed. `test`: 47 of 49 turbo
tasks passed (`@open-mercato/cli` 2218 of 2218). Two failures do not come from this branch:
`scripts/__tests__/check-lessons.test.mjs` (`.ai/lessons.md` lesson count, also red on `main` at 9a501a4b0c) and the
`create-mercato-app` "does not pack" checks, which fail only in this worktree and pass in CI.

## Outcome

Review with autofix: approvable, fixes in ea19435c81, follow-ups in #8124. #8123 landed and `main` was merged in
(9e458cd2d4), after which the required `test` passed. A second `om-auto-fix-pr 8117 --no-ui` run (2026-10-29) merged
`main` at 8bbd70dcd, moved the parity point to open-mercato/modules `2c182e6` and fixed adapter peers, the module-only
line filter, follow-up steps in text output, env-aware `src/modules.ts` reading and the line of `module info --json`
warnings. Next: a review from another account.
