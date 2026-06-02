# Migrate Dependabot PR #2394 to `develop`

Status: in-progress

## Goal

Reproduce the dependency bumps from Dependabot PR #2394 (which targets `main`)
on a branch based on `develop`, open a replacement PR against `develop`, and
close the original PR #2394 so the bumps land on the active development line.

## Context

- Original PR: open-mercato/open-mercato#2394 — `chore(deps): bump the minor-and-patch group with 36 updates`, base `main`, head `dependabot/npm_and_yarn/minor-and-patch-0e080e5910`.
- `main` and `develop` have diverged in package.json files, and the Dependabot
  branch is based on an old point on `main`. A raw cherry-pick / patch of the
  bump commit does not land cleanly, so the migration re-applies the exact
  `(name, fromSpec) → toSpec` version pairs to `develop`'s package.json files
  and regenerates the lockfile.
- For all 38 `(name, from)` pairs, `develop` currently carries the same `from`
  spec as the Dependabot base, so the replacement is faithful and idempotent.
- Permissive peer ranges Dependabot left untouched (`bullmq ^5.0.0`,
  `ioredis ^5.0.0`, root `tar 7.5.13`) are intentionally NOT modified, because
  they never matched a Dependabot `from` spec.

## Scope

- Apply 38 exact version-spec replacements across the package.json files
  Dependabot changed (root + apps/docs + apps/mercato + 14 packages).
- Regenerate `yarn.lock` via `yarn install` so the lockfile is consistent on
  the `develop` baseline.
- Validate with the full build/typecheck/test gate.
- Open the replacement PR against `develop`; close PR #2394 with a pointer.

## Non-goals

- No source-code changes; dependency specs and the lockfile only.
- No bumps beyond the 38 pairs in #2394.
- No tightening of permissive peer ranges.
- No changes to `main`.

## Risks

- A minor/patch bump could surface a build/typecheck/test regression — the full
  validation gate is the guard; any failure is investigated before opening the PR.
- Lockfile regenerated on `develop` may pull transitive updates beyond the 36
  direct deps; reviewed via `yarn.lock` diff and the build gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply version bumps

- [x] 1.1 Apply the 38 `(name, fromSpec) → toSpec` replacements to develop's package.json files — 957cd789e
- [x] 1.2 Regenerate yarn.lock via `yarn install` — 957cd789e

### Phase 2: Validate

- [ ] 2.1 Run full validation gate (generate, build:packages, typecheck, test, build:app)

### Phase 3: Ship

- [ ] 3.1 Open replacement PR against develop and normalize labels
- [ ] 3.2 Close original PR #2394 with a pointer to the replacement
