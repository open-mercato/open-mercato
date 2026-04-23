# Execution Plan — Example Module Optional

## Goal

Make `example` truly optional so disabling it does not leave broken scaffold UX or hidden test/runtime assumptions, while keeping `classic` unchanged and ensuring lean starters (`empty`, `crm`) stay green.

Source spec: `.ai/specs/2026-04-02-empty-app-starter-presets.md`

## Scope

- `apps/mercato` and `packages/create-app/template` starter surfaces that still expose example-only links or behavior when `example` is absent
- `packages/create-app` preset coverage for `empty` and `crm`
- Targeted regression tests proving `classic` keeps `example` while lean presets do not

## Non-goals

- Reworking the full starter-preset architecture beyond the example-module decoupling needed here
- Removing the `example` module from the repository
- Broad dependency pruning for all lean presets

## Overview

The preset resolver already removes `example` and `example_customers_sync` from lean starters, but the app/template home pages still hardcode example quick links and there is no end-to-end coverage proving the scaffold output matches the preset intent. This run hardens those remaining assumptions and adds regression tests around the generated starter state.

## Implementation Plan

### Phase 1: Audit and harden starter surfaces

1. Confirm the current lean-preset output and identify starter UI that still assumes `example` exists.
2. Update the monorepo app and standalone template starter surfaces so example-only affordances are shown only when `example` is enabled.

### Phase 2: Add regression coverage

1. Add or extend tests covering lean preset output and start-page/example-link behavior for `classic`, `empty`, and `crm`.
2. Run targeted package tests for create-app, CLI, app, and any touched core coverage until the no-example path is green.

### Phase 3: Final validation and review

1. Run generation/build/typecheck/i18n/full test gates required by the touched areas.
2. Perform code-review and backward-compatibility self-review, then open the PR and run `auto-review-pr`.

## Risks

- Lean preset output can still drift from actual scaffold UX if tests only inspect `src/modules.ts` and not rendered surfaces.
- The monorepo app and template can diverge if equivalent starter files are not updated in lockstep.
- Hidden example-module assumptions may still exist outside the touched surfaces; targeted test additions must catch the most likely regressions.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and harden starter surfaces

- [x] 1.1 Confirm the current lean-preset output and identify starter UI that still assumes `example` exists — 8a9312962
- [x] 1.2 Update the monorepo app and standalone template starter surfaces so example-only affordances are shown only when `example` is enabled — 8a9312962

### Phase 2: Add regression coverage

- [x] 2.1 Add or extend tests covering lean preset output and start-page/example-link behavior for `classic`, `empty`, and `crm` — 8a9312962
- [x] 2.2 Run targeted package tests for create-app, CLI, app, and any touched core coverage until the no-example path is green — 8a9312962

### Phase 3: Final validation and review

- [ ] 3.1 Run generation/build/typecheck/i18n/full test gates required by the touched areas
- [ ] 3.2 Perform code-review and backward-compatibility self-review, then open the PR and run `auto-review-pr`
