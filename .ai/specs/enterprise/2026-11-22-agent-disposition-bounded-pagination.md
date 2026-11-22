# Agent disposition bounded Work Inbox pagination

Status: Draft — blocked by shared design and contract approval
Issue: https://github.com/open-mercato/open-mercato/issues/8165
Extends: .ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md

## 📝 TLDR

Propose an adapter for the optional agent disposition Work Inbox source using the
[shared bounded key design](../2026-11-22-bounded-work-inbox-pagination.md). This is
an enterprise-only adoption of the same capability, not another Task entity or an
independent orchestration architecture. No implementation ships in this draft.

## 📝 Problem Statement

At c98419720f, `agentDispositionSource.ts:listAgentDispositionWorkItems` requests
`offset + limit` full proposals from zero and resolves labels for that entire
prefix. It orders SQL createdAt DESC before the core merge sorts its returned
prefix, so a deep page also cannot be assumed canonically ordered.

## 📝 Overview

The existing optional source is the only enterprise runtime target. It adopts the
core-owned capability and remains responsible for its own proposal queries and
presentation.

## 📝 Proposed Solution

Adopt the shared virtual-key design; no persisted read model is introduced.

## 📝 Architecture

Add the approved optional bounded adapter to the existing provider object in
`packages/enterprise/src/modules/agent_orchestrator/lib/workInbox/agentDispositionSource.ts`.
Retain `kind: agent_disposition`, module id, actions, and administrative feature
`agent_orchestrator.proposals.view`. Preserve wildcard-aware admission in core;
core never imports this file or learns this table's name.

`prepare` first runs `agentDispositionSourceMatchesQuery` unchanged. A rejected
constant-projection filter contributes an empty key relation and zero count,
without reading proposals or loading the agent registry. Keep the current
intentional exception for myWork, which does not hide an administrative queue.

Compile the relation from `buildAgentDispositionWhere(query, scope)` so it retains
trusted tenant, []/null organization semantics, `disposition: pending`,
`source: runtime`, `deletedAt: null`, and optional workflowInstanceId. Keys use
priority rank 2, NULL due date, createdAt in UTC milliseconds and proposal id.
Module/kind discriminators are injected by the coordinator. Core's canonical
createdAt ASC replaces this source's prefix DESC order after explicit approval.

Hydrate only selected ids, applying that same WHERE plus id IN selected ids through
encryption-aware read helpers on the shared read session. Resolve the translator
and labels for those selected proposals only, retaining current fallback behavior.
Project through `toAgentDispositionRow` unchanged, including proposalId, agentId,
runId, workflowInstanceId, stepId, confidence, updatedAt, detailHref and empty
assignment/entity bindings. No dispositionService, effector, principal, command
authorization or auto-approval boundary change.

## 📝 Data Models

No schema, migrations, persisted keys or settings.

## 📝 API Contracts

The source adopts the optional
shared capability; retain the legacy list method for the approved compatibility
window. It must not be used as an unbounded coordinator fallback. Shared route
shapes, degraded metadata, totals and materialization budgets come from the OSS
design. No enterprise API endpoint or ACL id is introduced.

## 📝 Migration & Backward Compatibility

All gates in the shared spec apply, including core public-contract/architecture
approval and the legacy-provider transition. Document the ordering correction for
clients in the parent-integrated release-notes patch. An absent optional module
registers nothing and causes no degradation. An installed but unsupported adapter
is explicitly degraded; it is not reported as an absent module. No startup or
configuration instruction is required, but this is an architecture change and
must not receive automerge under the task's authorization.

## 📝 Edge Cases & Failure Scenarios

An eval proposal never enters counts or hydration. Another tenant/org id never
contributes to keys, totals, projected details or errors. Source preparation/query/
hydration failure excludes only this kind through the shared algorithm. Registry
or translation failures retain the current presentation fallbacks. Duplicate ids
across kinds stay distinct. Tests must prove label resolution never sees the deep
prefix. Shared connection failures follow the shared request-failure rule.

## 📝 Risks & Impact Review

High: incorrect constant filters or source admission could disclose proposals;
reuse the existing pure builders and assert invocation counts for refused scopes.
High: changed creation order shifts pages; use the approved canonical comparator
and explicit migration guidance. Medium: presentation work could re-amplify after
bounded keys; count proposal loads, label ids, and projected rows before returning.

## 🧪 Coverage / acceptance

Extend `__tests__/agent-disposition-work-inbox.test.ts` with equal/null sort keys,
large offsets, []/null org scopes, foreign tenant/org fixtures, pending vs disposed,
runtime vs eval, all constant filters, wildcard admission and provider failure.
Database-backed integration must create its own proposal fixtures (no live agent
or model), interleave them with workflow tasks, instrument loads/label lookups,
compare exact ordered pages, and clean every owned record in finally. Verify core
passes its module-decoupling test with this module absent. These tests are planned,
not added or run by the design-only PR.

## 📋 Phasing and Implementation Plan

1. Shared Phase 0 approval is a hard dependency; this addendum cannot authorize it.
2. Shared Phase 1 adds the approved optional adapter and characterization tests,
   keeping the existing runtime path until an approved atomic cutover.
3. Shared Phase 2 switches both sources/coordinator together and runs the shared
   A1–A10 matrix plus proposal-specific fixtures and presentation counters.
4. Run the configured gate, scoped enterprise unit/integration suites, and review
   the final source diff. Exit only with exact validation evidence and agreed
   provider migration; do not mark implementation complete on a design-only merge.

## Final Compliance Report

Draft/no-go until shared approval and ORM/snapshot spike evidence. No production
change, new dependency, migration, startup/configuration edit, root file edit or
disposition authorization change is included. No independent review claimed.

## Changelog

- 2026-11-22: Drafted the enterprise adapter companion to #8165's shared proposal.
