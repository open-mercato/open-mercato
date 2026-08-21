# Final gate — all 12 Steps complete

**Timestamp:** 2026-08-04T07:49:13Z
**Runner:** local (no compose `app` container was running, so not Docker mode)
**Branch head at gate:** `a7864dd25` plus the spec-changelog and SHA-fill commits

## Full `validation.commands` gate, in configured order

| # | Command | Result |
|---|---------|--------|
| 1 | `yarn build:packages` | ✅ rc=0 |
| 2 | `yarn generate` | ✅ rc=0 — produced **no** tracked-file changes |
| 3 | `yarn build:packages` | ✅ rc=0 |
| 4 | `yarn i18n:check-sync` | ✅ rc=0 |
| 5 | `yarn i18n:check-usage` | ❌ rc=1 — **pre-existing**, see below |
| 6 | `yarn typecheck` | ✅ rc=0 |
| 7 | `yarn test` | ❌ rc=1 — **environmental**, see below |
| 8 | `yarn test:scripts` | ✅ rc=0 — **463 passed / 0 failed** |
| 9 | `yarn build:app` | ✅ rc=0 |

`yarn test:scripts` is not in the configured list but is run by CI at `ci.yml:515`, and it is the
suite that covers every script this change adds. It was added to the gate deliberately.

## The two non-green steps, neither caused by this branch

### 5. `yarn i18n:check-usage` — 21 missing keys, all pre-existing

The failure is `21 missing keys` (plus 3 592 unused keys, which the tool itself labels advisory).
Every one of the 21 lives in a file this branch does not touch:

- `packages/ui/src/backend/schedule/ScheduleToolbar.tsx` (2 keys)
- `packages/core/src/modules/design_system/gallery/entries/scaffolding.tsx` (12 keys)
- `packages/core/src/modules/design_system/gallery/entries/detail.tsx` (7 keys)

This branch changes **no `.tsx` file at all** and adds **no translation keys** — its code is `.mjs`
scripts, one workflow, and markdown. Verified by intersecting `git diff --name-only
origin/develop...HEAD` with the reported files: empty. Not fixed here, because fixing unrelated
missing translation keys is a separate change with its own review surface.

### 7. `yarn test` — only `create-mercato-app`, and only because `bwrap` cannot start

23 of 24 workspace test tasks pass. The single failure is `create-mercato-app#test`, and every
assertion inside it fails for the same reason:

```
bwrap: setting up uid map: Permission denied          (29 occurrences)
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

That suite shells out to bubblewrap to run a generated app's `yarn typecheck` in a sandbox. This
execution environment is itself a restricted container, so bubblewrap cannot create a user
namespace or configure loopback. Not one failure is a content assertion — the surrounding oracle
checks (`crud.factory-import`, `crud.route`, `crud.openapi`, `routes.unique`, `source.present`) all
report `passed: true`; only `target.typecheck` fails, with the `bwrap` message as its reason.

Re-running with the sandbox disabled reproduces it identically, confirming the limitation is the
container, not the tool invocation. This branch touches no file under `packages/create-app/`.
GitHub Actions runners can run bubblewrap, so this is expected to pass in CI — that is the
authoritative check for this suite.

## Integration suite

Not run. This change adds no application code, no API route, no database access, and no UI, so
there is no integration surface to exercise. The change's behaviour is fully covered by the 54 unit
tests in `yarn test:scripts` plus the end-to-end Stryker run recorded below.

## Design-system / style pass

Not applicable. No `.tsx`, nothing under `packages/ui/src/`, no `className`, no design tokens.

## End-to-end verification against ground truth

Beyond unit tests, the toolchain was run against a file whose correct answer was already known from
the Phase 0 pilot:

| Check | Expected | Measured |
|-------|----------|----------|
| `packages/shared/src/lib/boolean.ts` mutation score, via the new factory | 93.3 % (pilot) | **93.33 %** |
| Mutants | — | 28 killed / 2 survived / 2 errors |
| `report.mjs` score against the real `mutation.json` | match Stryker's own output | **match** |
| `report.mjs` survivors | the two equivalent mutants the pilot identified | **match** |

The clean run also confirmed Stryker restores its `inPlace` modifications correctly on a normal
exit: `git status` reported zero modified tracked files afterwards.
