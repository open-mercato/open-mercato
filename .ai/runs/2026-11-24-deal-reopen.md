# Reopen a closed CRM deal

Source doc: .ai/specs/2026-11-24-deal-reopen.md
Design PR: #10552
Issue: #4330
Status: complete

## Goal

Restore a closed deal to an open stage from its detail page using the requested permission.

## Scope

Customers deal detail, ACL, guarded reopen operation, audit and native regression coverage. Resolve stage and record scope inside the command write path.

## Risks

A stale snapshot can duplicate a transition or send a deal to a stage outside the current pipeline. Use the shared pipeline resolver, fresh row lock and scoped optimistic-lock check. Keep existing update permissions for generic mutation paths.

## Progress

PR: #10553

### Phase 1: Ship the detail action

- [x] 1.1 Characterize the current Lost warning. — 4e16c3f9f0
- [x] 1.2 Register the permission and implement the guarded command path and API tests. — 5432850e50
- [x] 1.3 Add the detail action, localization and browser tests. — 47fffa58bc
- [x] 1.4 Archive the Delta and verify the completed flow. — aa62e2dc7c
