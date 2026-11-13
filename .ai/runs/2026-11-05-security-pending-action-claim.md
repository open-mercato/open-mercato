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

## Verification evidence

Runner: local. Immutable pinned-Yarn install passed with optional native-build warnings. New unit regressions against main: 2 failed, 28 passed; patched focused matrix: 10 suites, 118 tests passed. Scoped ESLint exit0 (existing pages-directory warning). All configured local commands attempted in order: build/packages, generate, build/packages, translation sync/usage, typecheck and app build pass. Initial full test failed cache writes/docs under a quota-constrained temporary filesystem. Retry with a separate temporary directory completed exit1 in unchanged create-app harness boundary test; isolated reproduction also fails and the package/scripts/lockfile are unchanged from baseline. No local full-test pass claimed.

Authoritative current-source CI: https://github.com/open-mercato/open-mercato/actions/runs/41958045141 at31c99888705dae062d58d154a071a761435e8075 SUCCESS:51/51 test tasks,42/42 typecheck tasks,93/93 integration cases including CLAIM-011696ms; lint,DS lint,CodeQL,app/Docker build,timezone and documents multi-instance pass. CI skips the local-only sandbox boundary case via its existing availability guard. Focused matrix after localization121/121 and scoped lint pass.

Independent final re-review APPROVE: https://github.com/open-mercato/open-mercato/pull/8740#pullrequestreview-5779259640 at31c9988870. GitHub disallows author self-approval; verdict recorded as COMMENT. Needs-qa remains a merge gate. Existing-policy backport intent:release/v0.9.x.

Final dedup: source remains draft; GHSA source search finds only PR8740. Latest maina561278b7a adds unrelated create-app8718; no overlapping main fix. No issue/advisory state/merge/release writes.

## Risks
Concurrency claims must use refreshed database state under lock, preserve owner/tenant/organization filters and prevent cancellation/expiry from overwriting the winner. Duplicate requests may return the current in-flight result before completion. No automatic retry of crashed execution. Keep draft if verification is incomplete.

## Progress

PR: #8740

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Exclusive confirmation

- [x] 1.1 Add regression coverage and a locked expected-state transition; only the winner invokes the handler. — d441ecf5a9
- [x] 1.2 Add self-contained concurrent confirmation integration coverage and document the existing approval lifecycle. — f16bc3c446

### Phase 2: Verification and review

- [x] 2.1 Demonstrate failure before/fix after, run targeted security tests and ordered configured validation gate. — 31c9988870
- [x] 2.2 Recheck source/claim deduplication, publish evidence, obtain independent review and finalize the same PR. — 31c9988870
