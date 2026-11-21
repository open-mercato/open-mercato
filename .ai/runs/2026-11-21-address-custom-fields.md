# Implement custom fields on customer and sales addresses

Source doc: .ai/specs/2026-11-21-address-custom-fields.md

## Goal

Save and reload configured fields on CRM and Sales addresses, including document-owned copies that survive changes to the customer address book.

## Scope

- Customer address definitions, scoped value storage, record API and address-book UI.
- Order and quote shipping, billing and additional addresses, through the existing Sales commands and editor flows.
- Scoped definitions and copy validation, encryption, undo, optimistic locking and protections on downstream projections.

## Implementation plan

### Phase 1 Customer address book

1. Register the CRM definition host and enforce reserved address keys.
2. Add encrypted storage and scoped customer address reads, writes and undo.
3. Wire the CRM address editors and validate address-book and create flows.

### Phase 2 Sales address snapshots

1. Register Sales address definitions and save additional address values.
2. Save and freeze primary address values through document commands and conversion.
3. Wire the Sales address editors and run feature and repository validation.

## Risks

Additional values can contain personal information. Tests must check application access, encrypted storage, index and audit exclusion, and the public quote and carrier payload boundaries. Document transitions must retain the correct values during selection, clearing, conversion and undo.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Customer address book

- [ ] 1.1 Register the CRM definition host and enforce reserved address keys.
- [ ] 1.2 Add encrypted storage and scoped customer address reads, writes and undo.
- [ ] 1.3 Wire the CRM address editors and validate address-book and create flows.

### Phase 2: Sales address snapshots

- [ ] 2.1 Register Sales address definitions and save additional address values.
- [ ] 2.2 Save and freeze primary address values through document commands and conversion.
- [ ] 2.3 Wire the Sales address editors and run feature and repository validation.
