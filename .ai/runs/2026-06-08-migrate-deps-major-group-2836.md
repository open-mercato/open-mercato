# Migrate Dependabot PR #2836 to `develop`

## Goal

Recreate the dependency bumps from Dependabot PR #2836 (`chore(deps): bump the major group with 3 updates`, opened against `main`) on top of `develop`, then close the original PR so Dependabot stops tracking the stale `main`-based branch.

## Overview

PR #2836 grouped three bumps:

| Package | PR target | State on `develop` |
|---------|-----------|--------------------|
| `pdfjs-dist` | `^5.7.284` → `^6.0.227` | **already `^6.0.227`** (landed earlier) |
| `isolated-vm` | `^6.1.2` → `^7.0.0` | **already `^7.0.0`** (landed earlier) |
| `undici` | `^8.3.0` → `^8.4.1` | still `^8.3.0` in `packages/shared/package.json` |

Net migration vs `develop` is therefore a single residual bump: `undici` in `packages/shared` from `^8.3.0` to `^8.4.1`, plus the corresponding `yarn.lock` update. The two major bumps are no-ops on `develop` and must not be re-applied.

This is a dependency-only change: `skip-qa`, `dependencies` category label.

### External References

None (`--skill-url` not supplied).

## Scope

- `packages/shared/package.json` — bump `undici` to `^8.4.1`.
- `yarn.lock` — relock via `yarn install`.

### Non-goals

- Do not touch `pdfjs-dist` / `isolated-vm` (already at target on `develop`).
- Do not change the root `package.json` pinned `undici` `7.24.0` (separate, intentional pin).
- No source/behavioral code changes.

## Risks

- `undici` 8.3 → 8.4 is a minor bump within the same major; low breakage risk. Validation gate (build + tests) confirms.
- Pre-existing observation: `develop`'s `yarn.lock` resolves `undici` only to `7.24.0` (root pin); the shared `^8.3.0` range had no v8 resolution recorded. `yarn install` after the bump will add the resolved v8 entry; verify the lock diff stays scoped to undici.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply residual bump

- [x] 1.1 Bump `undici` to `^8.4.1` in `packages/shared/package.json` — 3a986c5aa
- [x] 1.2 Relock with `yarn install`; confirm `yarn.lock` diff is scoped to undici — 3a986c5aa (lock diff = single descriptor line; root `resolutions` still pins undici 7.24.0, so installed version is unchanged)

### Phase 2: Validate

- [ ] 2.1 Run validation gate (build:packages, typecheck, test, build:app)

### Phase 3: Ship & retire original

- [ ] 3.1 Open PR against `develop`, apply labels
- [ ] 3.2 Close PR #2836 with a pointer to the new PR
