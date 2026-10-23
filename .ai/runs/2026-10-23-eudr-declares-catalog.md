# Execution plan — make `metadata.requires` actually block `yarn generate` (adopted from PR #6862)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-23 because PR #6862 carried no execution plan.
**PR:** #6862 · **Branch:** `fix/eudr-declares-catalog` · **Base:** `main`
**Author:** @michalper — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Land a dependency-check fix so that a module declaring `metadata.requires: ['<other>']` actually blocks `yarn generate` when `<other>` is not enabled — closing the gap the PR's own first commit only documented (the `eudr`/`sync_excel` declarations it added were never enforced) — in a state that is mergeable, green on the full validation gate, and code-reviewed.

## Scope

- `packages/cli/src/lib/generators/module-registry.ts` — the three `requires`-reading call sites inside the ESM-built CLI.
- A regression test proving enforcement actually fires for a fixture module with a missing dependency, plus a static guard against a `require()` regression.
- `UPGRADE_NOTES.md` — documenting that this now blocks generation for any existing module whose declared `requires` is not satisfied.

## Non-goals

- No change to `eudr/index.ts` or `sync_excel/index.ts` — their `requires` declarations and explanatory comments are already correct once enforcement is real.
- No broader generator refactor beyond the `requires`-reading call sites.
- No optional-chaining fallback in `eudr/data/enrichers.ts` / `sync_excel/lib/adapters/customers.ts` — the PR's own rationale (both dependencies are hard, declaring is the honest answer) stands; this plan only makes the declaration real.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The original commit's `requires` declarations are inert | `om-auto-review-pr` review on `fe29224f37` (2026-10-22): `module-registry.ts` collects `requires` via a bare `require()` inside a CLI built as ESM (`packages/cli/package.json` `"type": "module"`), which throws and is swallowed by `catch {}` at three call sites (lines ~3686, ~4409, ~4843 pre-fix) | high |
| The fix must enforce, not just avoid crashing | Task instructions: "do not just loosen the catch ... the dependency check must actually block/fail generation when a declared requires module is missing/inactive" | high |
| An ESM-safe static extractor already exists in this exact file | `extractNamedObjectLiteralExport(sourceFile, 'metadata')` (exported, AST-based, no `require()`) and `loadModuleExportsFromSource` (real `await import()`) are already used for the same purpose at API-route metadata call sites (`module-registry.ts` ~2396, ~2440, ~2499) | high |
| Jest alone cannot regression-guard the ESM failure mode | Review: "Unit tests miss this because jest runs the generator as CommonJS, where require exists" | high |
| Every module with an existing `requires` list is affected, not just `eudr`/`sync_excel` | `grep -rn "requires:"` across `packages/*/src/modules/*/index.ts` lists 15 modules (`api_keys`, `customers`, `sales`, `wms`, `documents`, `sync_akeneo`, `tillio`, etc.) | high |
| `apps/mercato/src/modules.ts` already satisfies every one of those declarations | Manual cross-check of the enabled-modules list against each `requires` entry | high |

## Assumptions

- Chose the review's second fix option (make `requires` real) over the first (optional chaining in the two reading modules), because the task instructions ask for enforcement, not a crash-avoidance workaround, and because this closes the gap for every module's `requires` list, not only the two named in the original report.
- The three near-duplicated `require()` blocks in `module-registry.ts` share one new helper (`resolveModuleRequiresFromIndexFile`) rather than being fixed independently — a DRY cleanup of code already duplicated by the bug, not scope creep.

## Risks

- Enforcing every existing `requires` list is a behavior change for any out-of-tree app whose `src/modules.ts` enables a dependent module without its dependency — flagged in `UPGRADE_NOTES.md`. `apps/mercato`'s own module set already satisfies every declaration, confirmed by `yarn generate` passing cleanly against the real repo.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Declare `requires: ['catalog']` on `eudr` and `requires: ['customers', 'data_sync']` on `sync_excel`, plus the static-source guard test (`module-entity-ids-declare-their-owner.test.ts`) — fe29224f3

### Phase 2: Make `requires` enforcement real

- [x] 2.1 Replace the three `require()` call sites in `module-registry.ts` with the ESM-safe `loadModuleExportsFromSource` + `extractNamedObjectLiteralExport` path already used for route metadata — b57eccf3b
- [x] 2.2 Add `module-registry-requires-enforcement.test.ts`: a fixture module with a `requires` on a missing module fails generation naming it; the same fixture with the dependency enabled generates cleanly; a static guard asserts no bare `require(` remains in `module-registry.ts` — b57eccf3b
- [x] 2.3 Document the behavior change in `UPGRADE_NOTES.md` with the full list of already-affected modules — b57eccf3b

### Phase 3: Verification

- [x] 3.0 Merge `origin/main` into the branch to clear the `CONFLICTING`/`DIRTY` mergeability state that appeared mid-run (conflict only in `UPGRADE_NOTES.md`, both sides' entries kept) — 6a4962cb8
- [x] 3.1 Run the full `validation.commands` gate against the merged branch — gate run at 6a4962cb8

  Gate result: `build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck` (39/39 packages), `build:app` all green. `test` green on 47/48 package suites (`@open-mercato/core`: 2423/2423 run suites, 23345/23554 tests, 209 intentionally skipped); the one failure, **not caused by this PR**:

  - `create-mercato-app#test` › `writable-ast-oracles.test.ts` "after phase invokes only the fixed contained target yarn typecheck gate and reports its status" — a wall-clock budget assertion (`yarn typecheck` must finish within 120000ms). Reproduces standalone and twice in a row on this loaded machine (`uptime` load average 7.9–14.3 at the time), same category as the pre-existing `module-facts.bc-guard` CPU-duration flake this PR's own earlier review already documented as tracking machine load, not the diff. `git diff fe29224f3 HEAD -- packages/create-app/src/lib/writable-ast-oracles.test.ts` is empty — this PR's branch never touches that file or anything it depends on, before or after the `origin/main` merge.
- [ ] 3.2 Run the authoritative code-review pass (`om-auto-review-pr 6862 --autofix`) and land its fixes

### Phase 4: Finalize

- [ ] 4.1 Post the outcome and handoff comment, normalize labels, release the lock
