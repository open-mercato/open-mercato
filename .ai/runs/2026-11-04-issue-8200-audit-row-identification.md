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
- [ ] 1.1 Safe presentation helper and regression coverage
- [ ] 1.2 Names, summaries, seconds and localized state labels

### Phase 2: Reach and verify actions
- [ ] 2.1 Sticky row actions with preserved eligibility and interactions
- [ ] 2.2 Integration coverage, configured validation, review and UI evidence

## Validation
Runner: local. No running compose app; fullapp compose probe requires missing JWT_SECRET. No env values printed.
Ordered gate: yarn build:packages; yarn generate; yarn build:packages; yarn i18n:check-sync; yarn i18n:check-usage; yarn typecheck; yarn test; yarn build:app.
Baseline yarn build:packages passed (42/42 cached tasks, 15.74s). yarn install --immutable passed with peer warnings. Hooks require TMPDIR=/tmp/issue-8200 due macOS socket path length.
Spec PR: https://github.com/open-mercato/open-mercato/pull/8673 (design-only; spec stays out of implementation commit).
