# Port mermaid 11.16.0 bump to develop

**Date:** 2026-07-07
**Slug:** port-mermaid-11-16-to-develop
**Branch:** feat/port-mermaid-11-16-to-develop
**Source PR:** #3708 (Dependabot, based on `main`) — to be closed after this PR opens.

## Goal

Port the Dependabot dependency bump `mermaid` 11.15.0 → 11.16.0 (PR #3708, targeting `main`)
onto `develop`, then close the original PR. `develop` currently pins `mermaid ^11.12.2` in
`apps/docs/package.json`, so the ported version is `max(develop, target) = ^11.16.0`.

## Scope

- `apps/docs/package.json` — bump `mermaid` to `^11.16.0`.
- `yarn.lock` — refresh resolutions for mermaid and its transitive deps.

## Non-goals

- No other dependency changes; no docs content changes; no code changes.

## Risks

- `mermaid` is used only by the docs site (`apps/docs`) for diagram rendering. Blast radius is
  the docs build/render. Minor version bump within `^11`, low risk.
- Per [[open-mercato-ai-sdk-v7-esm-jest-and-dep-port]] convention: apply max(develop, target),
  skip eslint mismatch concerns; this is a docs-only workspace dependency.

## Implementation Plan

### Phase 1: Bump and lock

- 1.1 Bump `mermaid` to `^11.16.0` in `apps/docs/package.json`.
- 1.2 Refresh `yarn.lock` via `yarn install`.

### Phase 2: Validate and ship

- 2.1 Verify lockfile resolves mermaid@11.16.x; sanity-build docs types if feasible.
- 2.2 Open PR against `develop`, label, close original #3708.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bump and lock

- [x] 1.1 Bump mermaid to ^11.16.0 in apps/docs/package.json — 0e384aa89
- [x] 1.2 Refresh yarn.lock via yarn install — 0e384aa89

### Phase 2: Validate and ship

- [x] 2.1 Verify lockfile resolves mermaid@11.16.x (re-resolve stable, clean tree) — 0e384aa89
- [x] 2.2 Open PR against develop, label, close original #3708 — PR #3967 (original #3708 closed)
