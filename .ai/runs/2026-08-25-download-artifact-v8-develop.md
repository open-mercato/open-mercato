# Migrate dependabot PR #5561 (`actions/download-artifact` v6 → v8) to `develop`

**Date:** 2026-08-25
**Engine:** om-auto-create-pr
**Base branch:** `develop`
**Supersedes:** [#5561](https://github.com/open-mercato/open-mercato/pull/5561) (dependabot, targets `main`)

## Goal

Land the `actions/download-artifact` v6 → v8 bump in `.github/workflows/mutation-tests.yml`
on the project's working base branch (`develop`) instead of `main`, then close the original
dependabot PR #5561 with a pointer to the replacement.

## Context

Dependabot's `github-actions` ecosystem entry in `.github/dependabot.yml` declares no
`target-branch`, so dependabot opens against the repository's *default* branch (`main`).
The project's configured base branch (`.ai/agentic.config.json` → `baseBranch`) is `develop`,
so action bumps opened by dependabot never reach the branch the team actually builds on.

State on `origin/develop` at plan time:

- `.github/workflows/ci.yml` — 5 call sites already on `actions/download-artifact@v8`
- `.github/workflows/mutation-tests.yml:266` — still on `actions/download-artifact@v6`

So the bump is both still needed on `develop` and consistent with the version already in use
in `ci.yml`. `mutation-tests.yml` uploads with `actions/upload-artifact@v5`, which is in the
same v4+ artifact generation as `download-artifact@v8`, so upload/download stay compatible.

## Scope

- Bump the single `actions/download-artifact@v6` reference in
  `.github/workflows/mutation-tests.yml` to `@v8`.
- Open the replacement PR against `develop`.
- Close dependabot PR #5561 with a comment naming the replacement PR.

## Non-goals

- Adding `target-branch: develop` to `.github/dependabot.yml`. That fixes the systemic
  cause but changes branch/PR automation, which `AGENTS.md` puts behind "Ask First".
  Flagged in the final report instead.
- Bumping any other action pin (`actions/upload-artifact@v5` in `mutation-tests.yml`,
  `@v4` in `release.yml`, the `@v7` pins in `ci.yml`/`snapshot.yml`).
- Any change to `main`.

## Implementation Plan

### Phase 1: Port the bump to `develop`

- 1.1 Apply the `download-artifact@v6` → `@v8` change to `.github/workflows/mutation-tests.yml`
- 1.2 Verify the workflow file still parses as valid YAML and no other v6 reference remains

### Phase 2: Retire the original PR

- 2.1 Close #5561 with a comment linking the replacement PR against `develop`

## Risks

- **Low.** Single-line CI workflow pin change; no application code, no database schema,
  no public contract surface. Worst case is a failing `mutation-tests` workflow run, which
  is a scheduled/manual job and does not gate merges.
- `actions/download-artifact@v8` is already proven on this repo by the five `ci.yml`
  call sites, so the version itself carries no new risk.
- Closing #5561 leaves `main` on `@v6`. That is intended — `main` receives the change when
  `develop` is promoted, and dependabot will re-open against `main` if it does not.

## Validation

No application source is touched, so the TypeScript/build/test half of the configured
`validation.commands` gate cannot be affected by this diff. Applicable checks:

- YAML parse of the changed workflow file
- Full-tree grep confirming no stale `download-artifact@v6` reference remains

Deviation from the full gate is recorded in the PR summary comment.

## Progress

PR: #5588

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port the bump to `develop`

- [x] 1.1 Apply the `download-artifact@v6` → `@v8` change to `.github/workflows/mutation-tests.yml` — 993574f58
- [x] 1.2 Verify the workflow file still parses as valid YAML and no other v6 reference remains — 993574f58

### Phase 2: Retire the original PR

- [ ] 2.1 Close #5561 with a comment linking the replacement PR against `develop`
