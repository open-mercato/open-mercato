# CI scheduled dependency audit

## Overview

Goal: close the trigger gap reported in issue #4479, where the CI `audit` job can only ever reflect the dependency graph at the moment a manifest changed, so advisories published against unchanged dependencies leave `develop` red — or, worse, silently green — for days.

## Scope

- Add a standalone scheduled workflow that re-audits the unchanged dependency graph daily on `develop` and `main`.
- Run the audit there unconditionally: no `audit-scope` gate and no result cache.
- Give a failing scheduled audit somewhere to land: a per-branch tracking issue that the workflow opens, refreshes, and closes on its own.
- Remove the content-keyed `.audit-passed` cache from the `audit` job in `ci.yml` so the change-triggered half actually performs the scan it reports on.

## Non-goals

- No dependency bumps. The advisories currently open against the graph (4× `next`, `postcss`, `sharp`, `svgo`) are a separate remediation; the previous round shipped in #4363.
- No change to the `audit-scope` gate on the PR path — the scheduled workflow, not a broader PR trigger, is what covers unchanged graphs.
- No `schedule:` trigger bolted onto `ci.yml`, whose `concurrency: ci-${{ github.ref }}` with `cancel-in-progress: true` would make a cron run on `refs/heads/develop` cancel real CI.
- No change to the severity threshold or to which advisories are considered blocking.

## Implementation Plan

### Phase 1: Scheduled audit workflow

1. Add `.github/workflows/audit.yml`: daily cron plus `workflow_dispatch`, matrix over `develop` and `main` with `fail-fast: false`, auditing unconditionally with no result cache.
2. Report the outcome: job summary on every run, and a per-branch tracking issue that is opened, refreshed only when the advisory set changes, and closed once the audit passes again.

### Phase 2: Remove the stale-by-design result cache

1. Drop the `.audit-passed` cache from the `ci.yml` `audit` job and re-gate the install step on the `node_modules` cache alone.

### Phase 3: Verify and publish

1. Validate both workflow files (YAML parse, `node --check` on the `github-script` bodies, `bash -n` on every `run:` block) and confirm the audit command's real behavior against the current lockfile.
2. Open the PR against `develop` and record the label set.

## Risks

- The first scheduled run after merge will open a tracking issue immediately, because the current graph already carries high-severity advisories. That is the intended signal rather than a regression, but it should be called out in the PR so it is not mistaken for one.
- Dropping the `.audit-passed` cache costs one `yarn install` on every run of an already-conditional job. Accepted deliberately: a cached security check that can silently not execute is worth less than the minutes it saves.
- The tracking-issue automation needs `issues: write`. It is scoped to that one job, with the workflow default left at `contents: read`.
- A `yarn npm audit` failure caused by a network or registry problem is reported the same way as a real advisory. The job summary and the issue body carry the raw output, so the distinction is visible to whoever triages it.

## Progress

PR: #4497

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scheduled audit workflow

- [x] 1.1 Add the scheduled workflow with unconditional, uncached audit — 511be8cd7
- [x] 1.2 Report via job summary and a self-closing per-branch tracking issue — 511be8cd7

### Phase 2: Remove the stale-by-design result cache

- [x] 2.1 Drop the `.audit-passed` cache from the ci.yml audit job — 511be8cd7

### Phase 3: Verify and publish

- [x] 3.1 Validate both workflow files and the audit command behavior — 511be8cd7
- [x] 3.2 Open the PR against develop and record the label set — d0066e81c
