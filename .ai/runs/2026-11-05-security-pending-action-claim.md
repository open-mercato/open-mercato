# Single-winner pending-action confirmation

## Goal
Ensure concurrent confirmations of one approved AI action invoke its mutation handler at most once.

Source doc: .ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md
Source advisory: GHSA-4cj8-2g3g-p4m3
Security fingerprint: ai_assistant/pending-action-executor/nonexclusive-confirmation

## Scope
Repository status transitions, confirmation executor, and focused unit/PostgreSQL integration regressions. Preserve route, event, database and required exported signatures. Add an optional expected-state precondition and serialize status transitions using a database row lock. The handler runs after the claim transaction commits.

## Non-goals
No MCP delegation/policy redesign, trace signature changes, relation-options API restrictions, dependency upgrades, advisory state changes, issues, merging or auto-merge.

## Implementation Plan
### Phase 1: Exclusive confirmation
1.1 Add regression coverage and a locked expected-state transition; only the winner invokes the handler.
1.2 Add self-contained concurrent confirmation integration coverage and document the existing approval lifecycle.
### Phase 2: Verification and review
2.1 Demonstrate failure before/fix after, run targeted security tests and ordered configured validation gate.
2.2 Recheck source/claim deduplication, publish evidence, obtain independent review and finalize the same PR.

## Risks
Concurrency claims must use refreshed database state under lock, preserve owner/tenant/organization filters and prevent cancellation/expiry from overwriting the winner. Duplicate requests may return the current in-flight result before completion. No automatic retry of crashed execution. Keep draft if verification is incomplete.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Exclusive confirmation

- [x] 1.1 Add regression coverage and a locked expected-state transition; only the winner invokes the handler. — d441ecf5a9
- [ ] 1.2 Add self-contained concurrent confirmation integration coverage and document the existing approval lifecycle.

### Phase 2: Verification and review

- [ ] 2.1 Demonstrate failure before/fix after, run targeted security tests and ordered configured validation gate.
- [ ] 2.2 Recheck source/claim deduplication, publish evidence, obtain independent review and finalize the same PR.
