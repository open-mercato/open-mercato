# Complete main CI stabilization

## Goal
Keep full CI green after #8806 removed the main prepare failure.

## Scope
The workflow shell fixture inherits FORCE_FULL_SUITE=true from full CI. Give each fixture its own explicit flag and cover both ordinary and forced scope. Also narrow two Close locators to shared UI buttons: recorded CI DOM contains both an alert-dismiss button and the intended shared button. No production or workflow behavior change.

## Risks
Other full-suite failures can emerge after this unit failure is repaired. #8806 merged externally while tests were pending.

## Progress
PR: #8834

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repair
- [x] 1.1 Isolate scope fixture environment and verify full-suite regression — 27578b168

- [x] 1.2 Disambiguate alert dismiss buttons in API-key and column chooser tests — 911323266

- [ ] 1.3 Separate customer-group list assertions from create navigation

### Phase 2: Verify
- [ ] 2.1 Pass full stabilization CI and record review evidence
- [ ] 2.2 Update affected PR heads from fixed main where clean, without carry PRs

## Targeted verification
Workflow tests pass40/40 under inherited FORCE_FULL_SUITE=true. Headless Chromium with the two exact recorded DOM collisions confirms each old Close role matches2 controls and each scoped shared-button locator matches1. Live full-app checks remain delegated to full CI. Local Playwright discovery timed out before listing tests; no local app test pass is claimed.

The old run shard6 trace confirms every TC-CGRP-015 row assertion passed, then the test exhausted its20s overall budget during final create navigation. Split actual navigation into an independent UI test; preserve list href assertions and all fixture teardown. No timeout increases.
