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

PR: #10266

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Customer address book

- [x] 1.1 Register the CRM definition host and enforce reserved address keys. — 5867a3d7bb
- [x] 1.2 Add encrypted storage and scoped customer address reads, writes and undo. — 47a7ab89a9
- [x] 1.3 Wire the CRM address editors and validate address-book and create flows. — 9a6ec48cef

### Phase 2: Sales address snapshots

- [x] 2.1 Register Sales address definitions and save additional address values. — badf712c97
- [x] 2.2 Save and freeze primary address values through document commands and conversion. — badf712c97
- [x] 2.3 Wire the Sales address editors and run feature and repository validation. — a7c2b35d9c

## Verification

The managed local integration run passed all 11 issue-specific cases on a7c2b35d9c. Its production build, generation and package rebuild also passed. The full GitHub Linux test step passed on the same commit. The final tenant-switcher recovery change passed its targeted tests and workspace type checking. The local Windows workspace test command encountered a process-launch failure in the standalone app scaffold suite.
