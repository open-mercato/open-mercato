# #8140: Configurable default quote validity

Source doc: .ai/specs/2026-11-04-issue-8140-default-quote-validity.md
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal and scope
One organization-scoped sales setting shared by the quote-send UI and API, initially 14. All source changes in sales; no shared UI, customer, document, staff or audit source changes. Keep existing date suggestion and explicit send precedence. Reuse the existing cezar isolated branch, rather than creating/nesting a worktree.

## Implementation Plan
1. Add setting, migration/snapshot and transactional command support.
2. Add guarded settings API and configuration form with locales and conflict handling.
3. Connect dialog and omitted-value send path through shared helpers.
4. Add regression/integration coverage; run configured gate, independent review and native ephemeral UI QA, then publish ready when gates pass.

## Risks
Version-check/write races; tenant/org isolation; preserving required schema outputs. Runtime must wait for parent QA slot. Use private short TMPDIR/TMP/TEMP for every test/build/hook command.

## Progress

PR: #8689

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scoped setting
- [x] 1.1 Add setting, migration/snapshot and transactional command support — 2baa0aab83
- [x] 1.2 Add guarded settings API and configuration form — 2baa0aab83

### Phase 2: Send integration
- [x] 2.1 Connect dialog and omitted-value send path — 2f464f2fcf
- [ ] 2.2 Add coverage and complete validation, review and UI QA

## Verification so far
- Runner: local. Use per-command TMPDIR/TMP/TEMP in a task-private short directory for macOS sockets.
- Independent spec audit GO.
- Seven scoped Jest suites:81 tests passed; independent reviewer repeated81 passing.
- Before/after send regression: baseline omitted duration produced14 for configured30; updated handler produces30, explicit7 unchanged.
- Generated migration contains only one defaulted sales_settings integer column. Removed unrelated generator drift under AGENTS exception; no migrations applied.
- Preparation gate: build:packages → generate → build:packages and i18n:check-sync passed. Final broad gate remains pending after subsequent source refinements.
- i18n usage deliberately interrupted before heavy commands when parent allocated the host to other tasks; NOT passed. Typecheck/fulltest/build:app and live integration/UI remain queued.
- Client-boundary scan and diff whitespace check passed. DS health/discovery commands exceeded bounded120s during host contention; not passes.
- Integration scenarios authored; discovery/runtime verification pending.
