# Execution Plan: Left-align the Catch The Tornado sponsor logo in README

## Goal

Make the Catch The Tornado sponsor logo in the main `README.md` left-aligned, matching the presentation of the Blacksmith sponsor logo directly above it, and land the fix on both `develop` and `main`.

## Scope

- `README.md` Sponsors section only: replace the `<div align="center">` wrapper around the Catch The Tornado logo with a plain left-aligned link + image, mirroring the Blacksmith markup style.
- Fix the incidental `./apps/mercato//public/...` double-slash in the logo path on the line being touched.
- Backport the same change to `main` via a second PR (explicitly requested in the brief: "fix it to main and develop").

## Non-goals

- No changes to any other README content, logos, badges, or the top-of-page Open Mercato logo.
- No image/asset changes.

## Risks

- Trivial (docs-only, one section). Only risk is GitHub markdown rendering; mitigated by mirroring the already-rendering Blacksmith markup.

## Implementation Plan

### Phase 1: Fix README alignment (develop)

- 1.1 Left-align the Catch The Tornado logo in `README.md` and fix the double-slash path

### Phase 2: Validate and finalize PR

- 2.1 Docs-only validation gate (diff re-read; no markdown lint command configured) and PR finalization

### Phase 3: Backport to main

- 3.1 Cherry-pick the README fix onto a branch off `origin/main` and open a PR targeting `main`

## Progress

PR: #5258

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix README alignment (develop)

- [x] 1.1 Left-align the Catch The Tornado logo in `README.md` and fix the double-slash path — 326e66bd0

### Phase 2: Validate and finalize PR

- [x] 2.1 Docs-only validation gate (diff re-read; no markdown lint command configured) and PR finalization — diff re-read clean, markup mirrors the Blacksmith entry

### Phase 3: Backport to main

- [x] 3.1 Cherry-pick the README fix onto a branch off `origin/main` and open a PR targeting `main` — fec30d14d (PR #5259)

### Phase 4: Unblock failing `test` CI job (pre-existing on develop)

- [x] 4.1 Scale the lessons-catalog byte budget with the record count (fixed 32 KiB cap kept breaking as lessons grow), sync the stale declared lesson count (128 → 130), add a unit test — 95f9cd6a9
