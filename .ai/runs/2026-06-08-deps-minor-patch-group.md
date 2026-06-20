# Execution Plan — Migrate Dependabot minor-and-patch group to `develop`

**Slug:** `deps-minor-patch-group`
**Branch:** `feat/deps-minor-patch-group`
**Base:** `develop`
**Date:** 2026-06-08

## Overview

[Dependabot PR #2834](https://github.com/open-mercato/open-mercato/pull/2834)
bumps the `minor-and-patch` group (51 npm packages) but targets `main`. This run
migrates the same dependency bumps onto a branch based off `develop` and opens an
equivalent PR against `develop`.

`develop` has diverged from `main` (24 `package.json` files differ — e.g.
`packages/storage-s3/package.json` exists differently), so a straight cherry-pick
of the Dependabot commit does not apply. Instead we apply the canonical
Package→To-version map across whichever `package.json` files on `develop`
reference each package, preserving each occurrence's existing semver range
operator, and **only bump upward** (never downgrade a dependency `develop` already
carries above the group target). Then we regenerate `yarn.lock` with
`yarn install`.

### External References

- None (`--skill-url` not used).

## Goal

Reproduce Dependabot PR #2834's 51-package minor-and-patch group bump on top of
`develop` and ship it as a PR against `develop`.

## Scope

- Edit version specifiers in repo `package.json` files for the 51 grouped packages.
- Regenerate `yarn.lock`.

## Non-goals

- No source-code changes, no API/contract changes.
- No major-version upgrades (group is minor-and-patch only).
- No changes to packages outside the Dependabot group.
- Do not downgrade any dependency `develop` already pins above the group target.

## Risks

- A minor/patch bump could still introduce a behavioral regression. Mitigated by
  the full validation gate (typecheck + build + tests).
- `yarn.lock` regenerated against `develop` will differ from Dependabot's lock
  diff; that is expected and correct for the `develop` base.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply dependency bumps

- [x] 1.1 Apply the 51-package To-version map across all `package.json` files (upward-only, prefix-preserving) — 9b2d558b6
- [x] 1.2 Regenerate `yarn.lock` via `yarn install` — committed

### Phase 2: Validate and ship

- [x] 2.1 Run validation gate (build:packages, generate, typecheck, test, build:app) — all green; build:app required the generate→rebuild ordering
- [ ] 2.2 Open PR against `develop` and normalize labels
