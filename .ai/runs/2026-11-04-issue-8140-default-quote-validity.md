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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scoped setting
- [ ] 1.1 Add setting, migration/snapshot and transactional command support
- [ ] 1.2 Add guarded settings API and configuration form

### Phase 2: Send integration
- [ ] 2.1 Connect dialog and omitted-value send path
- [ ] 2.2 Add coverage and complete validation, review and UI QA
