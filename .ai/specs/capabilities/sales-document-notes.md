# Capability: sales-document-notes

Staff can distinguish the single sales-document note from its dated team-note history while preserving Markdown content.

## Requirement: Consistent document-note editing

The system SHALL offer a formatted Markdown toolbar at creation, then retain source-text Markdown editing and preview for that same persisted Document note in Details.

### Scenario: Create and reopen a document note

- WHEN staff create either a quote or order with a formatted Document note
- THEN its existing comments payload persists Markdown and Details displays it after reopening.

### Scenario: Edit, clear and cancel in Details

- WHEN staff save an edited Document note and reopen the document
- THEN the changed Markdown persists and Team note IDs, bodies and count remain unchanged.
- WHEN staff save an empty Document note
- THEN the current null/empty clearing behavior persists without changing Team notes.
- WHEN staff cancel a Details draft
- THEN no document PUT occurs and both stores retain their previous values.

Source: .ai/specs/2026-11-21-sales-document-notes-clarity.md

## Requirement: Distinguishable note purposes

The system SHALL distinguish the single Document note from the dated Team notes history through localized labels and help text.

### Scenario: Add or cancel a team note

- WHEN staff add a note in Team notes
- THEN the dated history gains a note and the Document note remains unchanged.
- WHEN staff cancel a team-note draft
- THEN no note POST occurs and the Document note remains unchanged.

Source: .ai/specs/2026-11-21-sales-document-notes-clarity.md
