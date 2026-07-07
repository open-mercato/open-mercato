# Execution Plan: bump actions/cache v5 → v6 (ported to develop)

## Goal

Port Dependabot PR #3695 (`build(deps): bump actions/cache from 5 to 6`, opened against `main`)
to a PR against `develop`, then close the original #3695. The develop branch pins
`actions/cache@v5` in 15 places in `.github/workflows/ci.yml`; bump them all to `@v6`.

## Scope

- `.github/workflows/ci.yml` only — bump every `uses: actions/cache@v5` to `@v6`.
- Non-goals: no changes to job logic, cache keys, paths, or any other action version.

## Rationale

Dependabot targeted `main`. Team convention is to land dependency bumps on `develop`
first (`max(develop, target)` = `max(v5, v6)` = `v6`). This recreates the equivalent
change on top of `develop`, whose ci.yml has 15 cache steps (one more than main's diff).

## Risks

- CI-config-only change. Risk is limited to GitHub Actions cache behavior in CI.
  actions/cache v6 is a routine major bump (Node runtime / internal deps); no workflow
  syntax changes required. If v6 misbehaves the change is a one-line revert.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port the bump

- [x] 1.1 Bump all `actions/cache@v5` → `@v6` in `.github/workflows/ci.yml` — 8a0564d63

### Phase 2: Ship

- [ ] 2.1 Open PR against `develop`, label, and close original #3695
