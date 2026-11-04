# Issue 8200: Audit row identification

Goal: identify the intended audit row and keep undo/redo reachable.
Scope: packages/core/src/modules/audit_logs/** and issue-8200 artifacts only.
Source doc: .ai/specs/2026-11-04-issue-8200-audit-row-identification.md
Engine: om-auto-create-pr (steps: 4, --loop: no)
Branch: cez/f90a1051 (pre-existing isolated cezar worktree; retained by task order).
Base: upstream/main, baseline e5774a707321fe14867a19663bc486d7a001492d.

## Implementation Plan
Phase 1: safe snapshot-based identification and summaries; integrate localized presentation.
Phase 2: sticky existing row action slot and meaningful unit/integration coverage.
Risks: previewing unsafe values, mismatching historical names, changed click behavior. Mitigations: bounded allowlist, snapshot only, fallback, existing real-table regression tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Identify rows
- [x] 1.1 Safe presentation helper and regression coverage — 7b4ff44607
- [x] 1.2 Names, summaries, seconds and localized state labels — 7b4ff44607

### Phase 2: Reach and verify actions
- [x] 2.1 Sticky row actions with preserved eligibility and interactions — 7b4ff44607
- [ ] 2.2 Integration coverage, configured validation, review and UI evidence

## Validation
Runner: local. No running compose app; fullapp compose probe requires missing JWT_SECRET. No env values printed.
Ordered gate: yarn build:packages; yarn generate; yarn build:packages; yarn i18n:check-sync; yarn i18n:check-usage; yarn typecheck; yarn test; yarn build:app.
Baseline yarn build:packages passed (42/42 cached tasks, 15.74s). yarn install --immutable passed with peer warnings. Commands and hooks use a task-private short directory created with `mktemp -d /private/tmp/cz-XXXXXX`, passed explicitly as TMPDIR, TMP and TEMP, due macOS socket path length.
Spec PR: https://github.com/open-mercato/open-mercato/pull/8673 (design-only; spec stays out of implementation commit).

Phase implementation commit: 7b4ff44607bc377f98212563db282fb1694ff55f
Targeted validation: yarn workspace @open-mercato/core test --runInBand src/modules/audit_logs — 16 suites / 210 tests passed (159.616s). Independent static review approved after correcting parent labels. New identification assertion fails against exact baseline component (record name absent). Native Playwright fixture scenario passed first attempt (1 test, 19.831s); screenshot captured and inspected; owned runtime cleaned and released. Full workspace gate remains blocked by the 2401.2s yarn test timeout with two unresolved unchanged UI-test failures; all other configured commands passed, including build:app (1513.0s).

Focused diagnostics: unchanged EntityTagsDialog suite passed 15 tests in sibling verification; own color-playground suite passed 13 tests (124.755s). The serialized full-suite retry has completed with exit 1; no gate waiver or publication claimed. Final independent review found no additional concerns and retains the publication block.

Supported-environment retry: exact candidate `d43b6f9b3ebf7cc6ad707da3a1823ee5e1f81089`, verified official Node24.19.0, full independent clone at a path without spaces, fresh immutable dependencies and native build/generate/build prerequisites all passed. Commit/tree/lockfile/cleanliness stayed identical. Unchanged `yarn test` failed with exit1 after478.893s: Turbo16/49 tasks successful; UI1failed/319passed suites,1failed/2874passed tests. Unchanged CrudForm.injectionLifecycle expectedDisplayed but receivedOriginal. This is not evidence of a baseline failure or flake. Native cleanup completed and resource allocation was released. Step2.2 remains blocked; no implementation PR or post-publication review/QA/CI is claimed. Full evidence and environment attribution are in `.ai/analysis/2026-11-04-issue-8200-review.md`.

One authorized unchanged focused UI diagnostic passed21tests in19.156s; fullgate remains failed. Read-only lifecycle review cannot establish whether the one-second display assertion failed from scheduling, ordering or suite interaction. SharedUI repair requires parent coordination with its owner; no source/timeout changes or additional retries.
