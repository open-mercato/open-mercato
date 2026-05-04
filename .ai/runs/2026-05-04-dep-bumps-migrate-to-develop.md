---
title: Migrate Dependabot PRs #1724 + #1723 to develop
date: 2026-05-04
status: in-progress
related-prs:
  - https://github.com/open-mercato/open-mercato/pull/1724
  - https://github.com/open-mercato/open-mercato/pull/1723
precedent:
  - .ai/runs/2026-04-21-dep-bumps-migrate-to-develop.md
---

## Goal

Combine the two open Dependabot PRs that target `main` ([#1724 major group](https://github.com/open-mercato/open-mercato/pull/1724), [#1723 minor-and-patch group](https://github.com/open-mercato/open-mercato/pull/1723)) into a single PR against `develop`, so the next release cycle can consume their dependency bumps without re-opening separate Dependabot branches against the moving `develop` base.

## Scope

This run follows the precedent set by [PR #1625](https://github.com/open-mercato/open-mercato/pull/1625), but the BC-breaker landscape on `develop` has shifted since then. As of `develop@ccbadc819`:

- `@mikro-orm/core` is already at `^7.0.10` — the v6→v7 migration has landed
- `typescript` is still at `^5.9.3`
- `awilix` is still at `^12.0.5`

### In scope (apply)

#### From #1723 (minor-and-patch group)

| Package | From (develop) | To | Files |
|---------|---------------|----|-------|
| `@napi-rs/canvas` | `^0.1.78` | `^0.1.100` | `package.json`, `apps/mercato/package.json` |
| `@stripe/stripe-js` | `^9.2.0` | `^9.3.1` | `apps/mercato/package.json`, `packages/gateway-stripe/package.json` |
| `@tanstack/react-query` | `^5.99.2` | `^5.100.5` | `package.json`, `apps/mercato/package.json` |
| `lucide-react` | `^1.8.0` | `^1.11.0` | `package.json`, `apps/mercato/package.json` |
| `@tailwindcss/postcss` | `^4.2.2` | `^4.2.4` | `apps/mercato/package.json` |
| `tailwindcss` | `^4.2.2` | `^4.2.4` | `apps/mercato/package.json` |
| `bullmq` | `^5.75.2` | `^5.76.2` | `apps/mercato/package.json` |
| `tar` | `7.5.11` / `^7.5.1` | `7.5.13` / `^7.5.13` | `package.json` (resolutions), `packages/create-app/package.json` |
| `otpauth` | `9.5.0` | `9.5.1` | `packages/enterprise/package.json` |
| `stripe` | `^22.0.2` | `^22.1.0` | `packages/gateway-stripe/package.json` |

#### From #1724 (major group)

| Package | From (develop) | To | Files |
|---------|---------------|----|-------|
| `@mikro-orm/core` | `^7.0.10` | `^7.0.13` | 6 files |
| `@mikro-orm/migrations` | `^7.0.10` | `^7.0.13` | 3 files |
| `@mikro-orm/postgresql` | `^7.0.10` | `^7.0.13` | 9 files |
| `ts-morph` | `^25.0.0` | `^28.0.0` | `packages/cli/package.json` |

### Out of scope (skip — same rationale as #1625)

| Package | PR target | Why skipped |
|---------|----------|-------------|
| `typescript` | `^6.0.3` | v6 deprecates `moduleResolution=node10` (`error TS5107`) across every package `tsconfig.json` |
| `awilix` | `^13.0.3` | v13 changed `Cradle` generic default from `any` to `{}`, making `container.resolve('em')` return `unknown` at 100+ DI call sites |

These remain at develop's current versions. The Dependabot PRs themselves stay open against `main`; once develop merges to main on the next release, Dependabot will re-evaluate.

## External References

- Precedent run: `.ai/runs/2026-04-21-dep-bumps-migrate-to-develop.md` — establishes the BC-breaker policy and the "consolidated PR against develop" pattern
- Reference PR: [#1625](https://github.com/open-mercato/open-mercato/pull/1625) — the prior migration that this PR mirrors

## Phases

### Phase 1: Apply package.json bumps and regenerate lockfile

1.1 Apply minor-and-patch bumps from #1723 across the 5 affected `package.json` files.
1.2 Apply in-scope major bumps from #1724: `@mikro-orm/* 7.0.10 → 7.0.13` (across all 9 files), `ts-morph 25 → 28` (in `packages/cli/package.json`).
1.3 Run `yarn install` to regenerate `yarn.lock`.

### Phase 2: Adapt code for non-reverted majors

2.1 Audit ts-morph v25→v28 API surface against `packages/cli/src/lib/generators/**` usage. Apply narrow fixes if any required.
2.2 Audit `@mikro-orm/* 7.0.10 → 7.0.13` patch-level changelog for breaking-on-update items. None expected (within v7), but verify via `yarn typecheck` and `yarn test`.

### Phase 3: Validation gate

3.1 `yarn build:packages`
3.2 `yarn generate`
3.3 `yarn build:packages` (post-generate)
3.4 `yarn i18n:check-sync`
3.5 `yarn i18n:check-usage`
3.6 `yarn typecheck`
3.7 `yarn test`
3.8 `yarn build:app`

### Phase 4: Open PR against develop

4.1 Push branch.
4.2 Open PR with body modeled on #1625 (Goal / What Changed / Validation gate / BC / Follow-ups).

## Backward Compatibility

No contract surface changes. Public types/exports/event IDs/widget spot IDs/ACL IDs/import paths are not affected by within-major dependency bumps. The only runtime-visible changes come from the bumped dependency versions themselves; the BC-breaking package majors (`typescript`, `awilix`) have been excluded.

## Follow-ups (out of scope)

- **TypeScript 6** — separate dedicated PR; either set `"ignoreDeprecations": "6.0"` across each package `tsconfig.json` or migrate `moduleResolution` to `bundler`/`node16`.
- **awilix 13** — audit the 100+ DI call sites to add explicit generic parameters, or introduce a typed Cradle interface.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply package.json bumps and regenerate lockfile

- [ ] 1.1 Apply minor-and-patch bumps from #1723 across affected package.json files
- [ ] 1.2 Apply in-scope major bumps from #1724 (mikro-orm 7.0.13, ts-morph 28)
- [ ] 1.3 Run yarn install to regenerate yarn.lock

### Phase 2: Adapt code for non-reverted majors

- [ ] 2.1 Audit ts-morph v25→v28 API surface and apply narrow fixes if needed
- [ ] 2.2 Verify mikro-orm 7.0.10→7.0.13 patch-level changes via typecheck + test

### Phase 3: Validation gate

- [ ] 3.1 yarn build:packages
- [ ] 3.2 yarn generate
- [ ] 3.3 yarn build:packages (post-generate)
- [ ] 3.4 yarn i18n:check-sync
- [ ] 3.5 yarn i18n:check-usage
- [ ] 3.6 yarn typecheck
- [ ] 3.7 yarn test
- [ ] 3.8 yarn build:app

### Phase 4: Open PR against develop

- [ ] 4.1 Push branch
- [ ] 4.2 Open PR with body modeled on #1625
