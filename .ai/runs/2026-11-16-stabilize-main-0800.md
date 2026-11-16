# Stabilize main — scheduled 2026-11-16 08:00

## Goal

Repair demonstrated main CI root causes and verify a dedicated draft PR with all 15 integration shards before requesting automerge.

## Scope

Base: main `883077fe355515c3008a05d3c768001c115da392`. Branch: `stabilize/main-2026-11-16-0800`. Target: main.

The unsuffixed branch belongs to merged PR #9635; preserve it and use the scheduled-time suffix. Main run 43810352873 failed only shard 13: both TC-WC-040 replacement-order undo cases timed out waiting for pending_approval. Existing ci-full and trusted stabilize/ full-suite selection already satisfy the requested workflow behavior.

Non-goals: speculative fixes, disabling tests or security guards, unrelated features, taking over existing PRs, merging into main.

## Implementation Plan

### Phase 1: Diagnose and repair

1.1 Independently audit exact-head CI inventory and full-suite coverage (read-only cezar task).
1.2 Trace replacement-order approval failures and implement the smallest safe repair with regression coverage.

### Phase 2: Verify and review

2.1 Run the configured validation gate and all 15 PR integration shards, fixing demonstrated failures.
2.2 Dispatch one final independent cezar review after implementation and address its verdict.
2.3 Record exact-head green evidence, promote the draft, and add automerge.

## Execution decisions

The operator's stabilize branch naming, waiting for green CI, and final cezar review override skill defaults. Reuse this isolated linked worktree. At most two children: a disjoint read-only CI coverage audit and one final review. Root-cause implementation stays in the parent because the affected paths are coupled. No unreviewed child changes will be merged. Final tracker updates avoid another evidence-only push that invalidates green evidence.

## Validation

Configured sequence: yarn build:packages; yarn generate; yarn build:packages; yarn i18n:check-sync; yarn i18n:check-usage; yarn typecheck; yarn test; yarn build:app. Targeted regressions accompany code fixes. Exact-head PR workflows and checks must finish successfully; intentional scope skips are reported. Preserve QA and native approval gates.

## Root cause and repair

The security fix deliberately removed event payload userId/actorUserId as execution authority. The stock code approval workflow declares no grant, so UPDATE_ENTITY correctly refuses its event-triggered write. TC-WC-040 depended on that removed authority. Each undo case now creates a unique persisted copy of the stock definition with only sales.orders.manage, through the existing grant-authorized API. It retains event-driven execution and actual audited status mutation. Cleanup cancels its instances and deletes its definition with the current version header. Production authorization and stock definitions remain unchanged. Integration-only changes do not need implementation-mirroring unit tests; the existing workflow identity/definition-grant unit suites and both affected integration cases provide the relevant regression evidence.

Runner: local (no running Compose app found). yarn install --immutable succeeded; 25 ci-full selection tests and TypeScript transpilation passed. Git hooks passed with TMPDIR=/tmp because the cockpit default temporary socket path exceeds the Unix socket path limit. Full executable validation is pending.

## Risks

The latest change isolated event-triggered workflow identity; repairs must preserve trusted tenant/organization scope and fail-closed authentication. CI may expose further regressions. Local dependencies are initially absent. Existing active stabilization PRs remain separately owned.

## Progress

PR: #9657

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Independently audit exact-head CI inventory and full-suite coverage.
- [x] 1.2 Trace replacement-order approval failures and implement the smallest safe repair with regression coverage. — 1fa897a46e

### Phase 2: Verify and review

- [ ] 2.1 Run the configured validation gate and all 15 PR integration shards, fixing demonstrated failures.
- [ ] 2.2 Dispatch one final independent cezar review after implementation and address its verdict.
- [ ] 2.3 Record exact-head green evidence, promote the draft, and add automerge.
