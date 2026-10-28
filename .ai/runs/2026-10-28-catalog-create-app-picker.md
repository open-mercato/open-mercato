# Execution plan: create-app module catalog picker (adopted from PR #8118)

**Origin:** adopted. Reconstructed by `om-auto-continue-pr` on 2026-10-28 because PR #8118 carried no execution plan.
**PR:** #8118 · **Branch:** `catalog/create-app-picker` · **Base:** `main`
**Author:** @wojciechszyjka. This plan interprets the PR's intent. Correct it by editing this file or commenting on the PR.

## Goal

Ship the opt-in `--modules` / `--module-picker` flags of `create-mercato-app`, including the catalog's route-collision warnings, and drive the PR to merge-ready.

## Scope

- `packages/create-app/src/lib/catalog/` and its wiring in `packages/create-app/src/index.ts`.
- `.ai/specs/2026-06-09-create-app-module-picker.md`.

## Non-goals

- Phase 2 of the spec (customizing core modules of a preset).
- Blocking a conflicting module. The catalog only warns, so the picker only warns.
- Any change to the catalog repo (`open-mercato/modules`).

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Phase 1 of the spec is implemented | PR body, 5 commits on the branch | high |
| The picker must show `conflictsWith` / `warning` | PR body "Reviewers should know" item, run brief of 2026-10-28 | high |
| Field shape | `lib/schema/published/picker.ts` and `lib/emit/picker.ts` in `open-mercato/modules` | high |
| Output stays unchanged for entries without the fields | run brief | high |

## Assumptions

- The warning is shown when the new app is made from the classic preset, or when the preset registers one of the `conflictsWith` modules. A preset without those modules does not hit the route clash.
- The warning is printed, not written to `.mercato/catalog-selection.json`, so the file format stays unchanged.

## Risks

- Low. Opt-in flags; the default scaffold makes no network request.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Catalog fetch, selection, picker step, CLI flags, spec revision — c9e8e11c89

### Phase 2: Catalog route-collision warnings

- [x] 2.1 Parse conflictsWith and warning from picker.json — 82ad4df53b
- [x] 2.2 Show the warning in the plan output and in --module-picker — 82ad4df53b
- [x] 2.3 Tests on a fixture entry with conflictsWith and warning — 82ad4df53b
- [x] 2.4 Update the spec and PR body for the warning — 705c4a303d

### Phase 3: Merge-ready

- [x] 3.1 Validation gate — 9956495c0c
- [ ] 3.2 om-auto-fix-pr --no-ui loop (review, CI)
