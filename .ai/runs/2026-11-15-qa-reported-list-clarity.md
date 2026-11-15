# QA-reported list clarity

## Goal

Address droalina's open requests #7892 and #1976 using their explicitly offered presentation-only options. Keep the existing mutation and folder rules.

Source doc: .ai/specs/2026-07-26-workflows-ux-redesign.md (§6.2)
Source doc: .ai/specs/implemented/2026-04-23-messages-inbox-bulk-actions.md

## Scope

- Work Inbox: label the existing task detail link “Open to complete” in all five shipped locales; retain action id, URL and terminal-state visibility.
- Messages: explain why All has no bulk selection, and show translated draft status instead of the missing sent-time dash, including an accurate accessible name.
- Update existing specs and add regression coverage for these existing list surfaces.

The two requests are independently usable and remain separate commits. No API, schema, permissions, mutation, shared component contract or dependency changes.

## Implementation Plan

### Phase 1: Work Inbox

1. Add a dedicated translated navigation label, preserve row action behavior, and verify pending/in-progress/terminal states and link destination.

### Phase 2: Messages

1. Add an All-folder explanation and translated draft metadata, with tests for folder switching and draft versus sent rows.

### Phase 3: Verification and publication

1. Run targeted tests and the configured ordered gate; record failures or unavailable environment checks accurately.
2. Reopen the existing independent review task for the final implementation, address findings, publish evidence and release claims. No merge.

## Risks

The feature-labelled issues offer alternatives; this run selects the minimum described option in each. Draft status must not claim the draft has been sent. The All-folder explanation must remain hidden in other folders. Existing data-table injection ids and action ids stay stable.

## Progress

### Phase 1: Work Inbox

- [ ] 1.1 Clarify the task detail navigation label and cover its behavior.

### Phase 2: Messages

- [ ] 2.1 Explain All-folder restrictions and replace draft timestamp placeholders.

### Phase 3: Verification and publication

- [ ] 3.1 Run validation and record evidence/limits.
- [ ] 3.2 Obtain independent final review and publish the ready PR with claim cleanup.
