# Pre-merge standalone integration gate

## Goal

Catch standalone package, discovery and runtime regressions on pull requests before the snapshot publication lane runs.

## Scope

Build and pack PR workspaces without publishing, scaffold a disposable app, pin all first-party dependencies to those tarballs, production-build and start the app with snapshot-compatible settings, then run a fixed smoke suite plus affected module tests. Add an unprivileged pull-request workflow. Keep the full snapshot suite and branch protection settings unchanged.

## Risks

The first real GitHub run is required to measure duration and validate the runner image. The gate starts as a normal PR check; maintainers can require its stable job name after observing green representative runs. A second PR consolidates snapshot and local integration configuration onto this runner's environment helper.

## Implementation Plan

### Phase 1: Package and test selection

1.1 Add isolated local package packing, install provenance verification and conservative affected-test selection with regression tests.

### Phase 2: Standalone lifecycle and CI

2.1 Add a production standalone lifecycle runner and shared environment builder.
2.2 Add the unprivileged PR workflow and operational instructions.

### Phase 3: Verification

3.1 Run targeted checks, the configured validation gate, and authoritative PR review; report any environmental blockers.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Package and test selection

- [ ] 1.1 Add isolated local package packing, install provenance verification and conservative affected-test selection with regression tests.

### Phase 2: Standalone lifecycle and CI

- [ ] 2.1 Add a production standalone lifecycle runner and shared environment builder.
- [ ] 2.2 Add the unprivileged PR workflow and operational instructions.

### Phase 3: Verification

- [ ] 3.1 Run targeted checks, the configured validation gate, and authoritative PR review; report any environmental blockers.
