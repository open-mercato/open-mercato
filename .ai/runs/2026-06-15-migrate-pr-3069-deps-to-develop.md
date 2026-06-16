# Execution Plan — Migrate PR #3069 dependency bumps to `develop`

## Goal

Recreate the Dependabot "minor-and-patch" group bump from PR #3069 (opened against `main`) as a PR against `develop`, so the same 30 dependency upgrades land on the integration branch.

## Overview

PR #3069 (`dependabot/npm_and_yarn/minor-and-patch-cbbd645498`, base `main`) bumps 30 packages across 20 `package.json` files plus `yarn.lock`. The `develop` branch currently carries the same "from" versions, so the bumps transplant cleanly. We apply the version edits to each `package.json` on a fresh branch off `develop` and regenerate `yarn.lock` with `yarn install` (rather than copying main's lockfile, which is keyed to a different base).

### Source

- Source PR: https://github.com/open-mercato/open-mercato/pull/3069 (base `main`).
- Prior art: PR #2005 (`fix/migrate-dependabot-deps-to-develop`, merged) did the same migration for an earlier bump.

## Scope

- Edit dependency version ranges in the 20 affected `package.json` files to match PR #3069.
- Regenerate `yarn.lock` via `yarn install`.
- Verify the workspace builds, typechecks, and tests pass.

## Non-goals

- No source-code changes; no API/contract changes.
- No changes to the original PR #3069 (left for `main` as Dependabot manages it).
- No dependency upgrades beyond the exact set in PR #3069.

## Risks

- A bumped package could introduce a behavioral/type regression — mitigated by the full validation gate (typecheck/test/build).
- `yarn.lock` regenerated off `develop` may resolve transitive deps differently than main's lockfile — acceptable and expected (it is keyed to develop's tree).

## Implementation Plan

### Phase 1: Apply version bumps

- 1.1 Apply the exact version-range edits from PR #3069 to all 20 `package.json` files.
- 1.2 Regenerate `yarn.lock` with `yarn install`.

### Phase 2: Validate

- 2.1 Run the targeted/full validation gate (generate, build:packages, typecheck, test, build:app).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply version bumps

- [x] 1.1 Apply package.json version edits from PR #3069 (+ #3071 nodemailer 8->9) — c7fb1b942
- [x] 1.2 Regenerate yarn.lock via yarn install — c7fb1b942

### Phase 2: Validate

- [x] 2.1 Run validation gate (generate, build:packages, typecheck, test, build:app) — all green

### Post-implementation fixes (unblocking the gate)

- [x] testcontainers 12.0.2 pulls ESM archiver@8 → lazy-import GenericContainer in cli integration helper so jest can load it — 6a42c9cb8
- [x] Pre-existing develop regression: duplicate `parseBooleanWithDefault` import in events/bus.ts (from #3017) broke typecheck for events + downstream → removed — 8de48c32e

### Notes

- undici stays pinned at 7.24.0 via root `resolutions` (same on main and develop); #3071's transitive undici 7->8 bump is intentionally NOT applied — bumping it would override a deliberate pin added by "fix: dependabot insights".
