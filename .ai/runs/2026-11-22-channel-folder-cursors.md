# Implement per-folder channel cursors

Source doc: .ai/specs/2026-11-22-channel-folder-cursors.md
Spec PR: #10369
Issue: #4632

## Goal

Let a host worker advance a durable checkpoint for one folder without updating channel-wide polling state. Reject stale writes and bind access to the caller's channel scope.

## Implementation Plan

### Phase 1 — Scoped cursor persistence

1. Add the folder cursor entity, migration and DI store.
2. Test competing writes and exact scoping in PostgreSQL. Document the host worker call sequence.
3. Archive the capability requirements and run the configured validation gate.

## Progress

### Phase 1 — Scoped cursor persistence

- [ ] 1.1 Add the folder cursor entity, migration and DI store
- [ ] 1.2 Verify concurrency and scope in PostgreSQL and document the worker call sequence
- [ ] 1.3 Archive the capability requirements and run the configured validation gate
