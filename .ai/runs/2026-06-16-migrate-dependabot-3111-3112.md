# Migrate Dependabot PRs #3111 and #3112 to a single PR against `develop`

## Goal

Combine two Dependabot dependency bumps — currently opened against `main` — into a single PR targeting `develop`:

- #3111: `launch-editor` 2.12.0 → 2.14.1
- #3112: `@babel/core` 7.28.6 → 7.29.7

Both are transitive dependencies (not referenced directly in any `package.json`); the change is `yarn.lock`-only.

## Scope

- Branch off `origin/develop`.
- Re-resolve the two packages with Yarn 4 so the lockfile reflects the bumped versions.
- `yarn.lock` is the only expected file change.

### Non-goals

- No source-code changes, no `package.json` edits.
- No unrelated dependency churn — only the two target packages (plus their forced transitive resolutions) move.
- Not touching the original `main`-based Dependabot PRs (left for the maintainer to close).

## Risks

- `yarn up -R` could drag unrelated transitive resolutions if not constrained — verify the diff is limited to the two packages and their sub-tree.
- Lockfile must stay install-clean (`yarn install --immutable` succeeds).

## Implementation Plan

### Phase 1: Bump dependencies

- Re-resolve `launch-editor@2.14.1` and `@babel/core@7.29.7` against `develop`.
- Verify the `yarn.lock` diff is scoped to those packages.

### Phase 2: Validate

- Confirm `yarn install --immutable` is clean.
- Run a sanity build/typecheck appropriate for a lockfile-only change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bump dependencies

- [x] 1.1 Re-resolve launch-editor@2.14.1 and @babel/core@7.29.7 on develop — 2ef746598
- [x] 1.2 Verify yarn.lock diff scoped to target packages — 2ef746598

### Phase 2: Validate

- [x] 2.1 Confirm immutable install is clean — 2ef746598
- [x] 2.2 Sanity build/typecheck for lockfile-only change — 2ef746598 (`yarn build:packages` 21/21 ✓; `yarn typecheck` fails only on pre-existing `packages/events/src/bus.ts` duplicate `parseBooleanWithDefault` import that already exists on `develop` and is untouched by this branch)
