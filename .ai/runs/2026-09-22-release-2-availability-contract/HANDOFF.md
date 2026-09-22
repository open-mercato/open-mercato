# Handoff — 2026-09-22-release-2-availability-contract

**Last updated:** 2026-09-22T13:30:00Z
**Branch:** feat/release-2-availability-contract
**PR:** https://github.com/open-mercato/open-mercato/pull/6339
**Current phase/step:** Phase 1 + Phase 2 COMPLETE. Next: Step 4.1 (Playwright UI integration tests).
**Last commit:** 33de29e90 — feat(wms): register the wms AvailabilityProvider

## What just happened
- Landed all of Phase 2 (Steps 3.1–3.3): `wms`'s batched sellable-quantity calculation (R1/R4), the read-through cache + balance-change invalidation subscriber, and the `AvailabilityProvider` registration in `wms/di.ts`.
- Ran checkpoint 3 (see `checkpoint-3-checks.md`) — full suites, typechecks, build:packages, generate/db:generate no-op all green. Explicitly verified the Phase 2 spec gate: R1, R4, and hand-computed multi-location state matching, all passing through the real `resolveAvailability()` → registry → provider → cache path.
- Researched (not yet applied) the real Playwright UI-driving patterns this repo uses: `[data-crud-field-id="<fieldId>"] input` locators for `CrudForm` fields (NOT `getByLabel`, which only works on the plain check-tool page's hand-written `<Label htmlFor>`/`<Input id>` pairs), `flash(text,'success')` asserted by exact visible text, `login(page, role)` from `@open-mercato/core/modules/core/__integration__/helpers/auth`, `bumpRecordViaApi` + `expectConflictBanner` from `@open-mercato/core/helpers/integration/optimisticLockUi` for the optimistic-lock conflict bar, and `fillControlledInput` to avoid the hydration-race `.fill()` footgun.

## Next concrete action
- Write Step 4.1: a browser-driven Playwright spec under `packages/core/src/modules/availability/__integration__/` covering: policy create/edit via `CrudForm` (including the `data-testid="availability-resolution-preview"` live panel and an optimistic-lock conflict-bar case), a view-only role rendering the form `readOnly`, and the admin check tool page (`data-testid="availability-check-result"` / `-error` / `-policy-trace"`).
- Then Step 4.2: final `yarn generate` + `yarn db:generate` no-op check, spec changelog update noting Phase 1+2 implemented (Phase 3 remains open, don't move to `implemented/`).
- Then the run's final gate (full `validation.commands`, full integration suite via `om-integration-tests`, DS pass) and PR finalize (labels, review pass, summary).

## Blockers / open questions
- None. The one known constraint (no container runtime in this sandbox for the ephemeral Postgres + live dev server) has been consistently documented at every checkpoint; all Playwright specs so far are typechecked and pattern-verified against real repo precedent but not executed. This will need to be disclosed plainly in the final-gate report and PR summary — the final gate cannot claim a green integration-suite run it did not perform.

## Environment caveats
- Dev runtime runnable: not started.
- Database/migration state: clean; Phase 2 made no entity changes.

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/8967983c-8f33-4fe0-b10e-e683933caf94
- Created this run: no (reused the existing cezar-linked worktree)
