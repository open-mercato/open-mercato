# CRM inbound email admission

## Goal

Implement issue #5468 using the shared inbound command and keep incremental synchronization reliable across email providers.

Source doc: .ai/specs/2026-11-22-crm-inbound-email-admission.md

## Scope

Change admission, focused tests, and upgrade notes. Preserve explicit history import and the existing provider cursor and HTTP contracts.

## Implementation Plan

### Phase 1 — Shared admission

1.1 Implement scoped contact lookup and the pre-persistence admission decision.

1.2 Verify admitted senders, thread replies, skipped messages, and lookup failures at the command boundary.

### Phase 2 — Entry-point verification

2.1 Verify IMAP and Gmail cursor progression and preserve operator history import.

2.2 Add API-backed regression coverage and the upgrade note.

## Risks

An incorrect skip can discard valid CRM email when the cursor advances. The command must distinguish proven non-membership from a failed lookup. All match inputs and stored references must remain scoped to the receiving channel.

## Progress

PR: #10292

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared admission

- [x] 1.1 Implement scoped contact lookup and the pre-persistence admission decision. — 3eda8687c6
- [x] 1.2 Verify admitted senders, thread replies, skipped messages, and lookup failures at the command boundary. — 3eda8687c6

### Phase 2: Entry-point verification

- [x] 2.1 Verify IMAP and Gmail cursor progression and preserve operator history import. — 223120dca9
- [x] 2.2 Add API-backed regression coverage and the upgrade note. — 223120dca9
