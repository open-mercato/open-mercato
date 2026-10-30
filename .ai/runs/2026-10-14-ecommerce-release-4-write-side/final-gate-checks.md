# Final gate — Phase 8 completion (Step 8.12)

Run at `1828d7c82` (HEAD after Checkpoint 5's final correction). Full `.ai/agentic.config.json` `validation.commands` list, run end-to-end across the whole monorepo.

## `validation.commands` (in order)

| # | Command | Result |
|---|---|---|
| 1 | `yarn build:packages` | ✅ 39/39 tasks |
| 2 | `yarn generate` | ✅ clean, no diffs |
| 3 | `yarn build:packages` (rebuild after generate) | ✅ 39/39 tasks |
| 4 | `yarn i18n:check-sync` | ✅ clean, 5/5 locales |
| 5 | `yarn i18n:check-usage` | ✅ advisory, exit 0; 7989 unused keys repo-wide (pre-existing baseline across 66 OTHER modules) — zero `cart.*`/`promotions.*` keys among them |
| 6 | `yarn typecheck` (`--force`) | ✅ 39/39 tasks |
| 7 | `yarn test` | See below — turbo aborts after a pre-existing `@open-mercato/cli` failure, so `core`/`ui`/`shared`/`app`/`onboarding` were run directly per the established recipe |
| 8 | `yarn build:app` (`--force`) | ✅ clean, all routes compiled |

## `yarn test` detail

Aggregate `yarn test --force` stopped scheduling after `@open-mercato/cli#test` failed (20/46 tasks completed) — a known behavior on this host (turbo halts the remaining queue on any package failure, so `core`/`ui`/`app`/`shared`/`onboarding` never actually ran under the aggregate command, even though their lines appeared as "cache bypass, force executing"). Verified and ran each directly:

| Package | Result |
|---|---|
| `@open-mercato/cli` (aggregate failure) | 3 suites / 6 cases failed under turbo — `resolve-environment.test.ts`, `resolver.enterprise.test.ts`, `agent-files-extension.test.ts`. **Confirmed environmental, not a regression**: re-run standalone with `TMPDIR=/private/var/tmp` (the documented root cause — tsx's IPC Unix socket exceeds the `sun_path` limit under cezar's long in-repo `TMPDIR`, and turbo does not forward an exported override) → **3/3 passed, 31/31 tests**. |
| `@open-mercato/core` (direct) | ✅ 2386/2388 suites, 22697/22715 tests, 0 failed (18 pre-existing skips, 2 pre-existing skipped suites) |
| `@open-mercato/ui` (direct) | ✅ 293/293 suites, 2599/2599 tests |
| `@open-mercato/shared` (direct) | ✅ 236/237 suites, 2726/2731 tests, 0 failed (1 pre-existing skipped suite, 5 skipped tests) |
| `@open-mercato/app` (direct) | ✅ 107/107 suites, 740/740 tests |
| `@open-mercato/onboarding` (direct) | ✅ 22/22 suites, 139/139 tests |

`cart`+`promotions` (inside `@open-mercato/core`'s own tally above) independently re-confirmed throughout Phase 8's checkpoints at **467/467** (Jest) and **65/66** (live Playwright integration, the one red a filed, confirmed pre-existing backend bug — see Checkpoint 5 / the PR's follow-up issues).

## Style-compliance pass

No dedicated `om-ds-guardian`/`lint:ds` script found distinct from the repo's standard `eslint` run. `npx eslint` on every file touched across Phase 8 (`cart`, `promotions`, `catalog`, `ecommerce`) — 0 errors throughout every checkpoint (re-confirmed at Checkpoints 3, 4, and this final pass); the 2 pre-existing warnings (`cart/di.ts` anonymous default export, an unrelated `promotions` eslint-disable) are confirmed byte-identical to the pre-Phase-8 baseline. Design-system self-review (`.ai/ds-rules.md`) performed directly on every Step 8.7/8.8 UI change — no arbitrary values or hardcoded status colors introduced; one pre-existing arbitrary-value finding (`BenefitCard.tsx`'s `TiersEditor`) confirmed out of scope and filed as a follow-up.

## Outcome

**Full repo-wide gate: GREEN.** Zero regressions from Phase 8's 14 Steps (8.1–8.14) across any package. The only non-green items are two pre-existing, independently-confirmed, out-of-scope defects — the `cli`/`shared` TMPDIR environmental quirk (proven clean standalone) and `TC-PROM-083`'s code-generation cache-invalidation gap (filed as a follow-up issue) — neither attributable to this release.
