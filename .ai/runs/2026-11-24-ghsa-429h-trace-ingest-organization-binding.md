# Execution plan — bind the trace-ingest organization to the verified tenant and validate ingest fields (GHSA-429h-x9x8-rv2m, GHSA-xch5-xj47-xcxm)

**Source advisories:** GHSA-429h-x9x8-rv2m (repository security advisory, medium), GHSA-xch5-xj47-xcxm (repository security advisory, low) — both in the same trace-ingest write path, fixed together as one remediation group.
**Source doc:** repository advisories `GHSA-429h-x9x8-rv2m` + `GHSA-xch5-xj47-xcxm` (Agent Orchestrator trace ingest integrity)
**Date:** 2026-11-24
**Engine:** om-auto-create-pr (steps: 6, --loop: no)

## Goal

The trace-ingest webhook verifies an HMAC that proves the tenant, but the organization is taken from the unsigned `x-om-organization-id` header and never checked to belong to that tenant, so one tenant's ingest secret can write runs, spans, tool calls, cost and eval results under any organization id — including an organization of another tenant (GHSA-429h). In the same payload, `workflowInstanceId`, `stepId`, `confidence` and `costMinor` arrive unvalidated: a run can inject cost into any workflow instance of the organization (also one it never ran in), confidence has no 0-1 range while it drives the `min_confidence` eval verdict and the low-confidence review lists, and `costMinor` has no upper limit (GHSA-xch5).

## Scope

- `packages/enterprise/src/modules/agent_orchestrator/lib/trace/ingestScope.ts` (new): a fail-closed ingest-scope guard used by the ingest command —
  - the principal organization must exist and belong to the HMAC-verified tenant (uniform 401, indistinguishable from an HMAC failure so the endpoint is not an existence oracle for other tenants' organizations);
  - a non-null `workflowInstanceId` must resolve (through the optional `workflowExecutor` peer, same soft-resolve pattern as `processProjection`) to an instance in the same tenant AND organization as the ingest scope, else 422; an absent workflows peer skips the reference check (no projection exists to poison in that deployment).
- `packages/enterprise/src/modules/agent_orchestrator/data/validators.ts`: `confidence` bounded to 0-1 like the proposal/option schemas; `costMinor` gains an upper bound (`TRACE_INGEST_MAX_COST_MINOR`); `stepId` requires `workflowInstanceId` (a step reference is meaningless without its instance; the internal runtime only ever produces the pair together).
- `packages/enterprise/src/modules/agent_orchestrator/commands/trace.ts`: run the guard inside the audited command so both the webhook and any other dispatch path share the choke point.
- Route doc/openapi copy updated to state the organization is validated against the verified tenant.
- Regression tests: command-level (foreign-org 401, mismatched/missing workflow instance 422, schema bounds, step-without-instance 422, happy path unchanged, absent-peer skip) in a new `__tests__/trace-ingest-scope.test.ts`.

## Non-goals

- No change to the HMAC signing scheme or signed content (adding the organization to the signature would change the trace-ingest HMAC contract and break senders; the membership check achieves the advisory's goal without it).
- No per-organization secrets, no schema/migration changes, no new event ids or route shapes.
- The internal in-process runtime paths (native trace capture, workflow-invoked runs) keep their server-derived scope; the guard applies to the audited command both paths already share where reachable.
- Residual (documented on the PR): a holder of a tenant's ingest secret can still reference a workflow instance in its own organization that the agent did not actually run — the tenant+org match removes the cross-org/cross-tenant escalation only.

## Risks

- Legitimate senders that previously posted a foreign-org id now receive 401 — that is the vulnerability being closed; correct senders always send their own organization.
- Senders posting `confidence` outside 0-1 or huge `costMinor` now get 422 — the same bounds the rest of the module's schemas already apply.
- The organization lookup adds one indexed primary-key read per ingest.

## Implementation Plan

### Phase 1: Scope guard + schema bounds

- [x] 1.1 Add `lib/trace/ingestScope.ts` guard (org-in-tenant + workflow-instance-in-scope checks) — 1f94fdc2dd
- [x] 1.2 Tighten `traceIngestSchema`: confidence 0-1, costMinor upper bound, stepId-requires-workflowInstanceId — 1f94fdc2dd

### Phase 2: Wire the guard into the ingest command

- [x] 2.1 Call the guard from `commands/trace.ts` before `ingestTrace`; update route doc/openapi copy — 1f94fdc2dd

### Phase 3: Tests

- [x] 3.1 New `__tests__/trace-ingest-scope.test.ts` covering the guard (foreign org, instance mismatch, instance missing, happy path, absent peer) — 1f94fdc2dd
- [x] 3.2 Schema-bound regressions (confidence/costMinor/stepId) including prior-behavior proofs — 1f94fdc2dd

### Phase 4: Validation and PR

- [x] 4.1 Targeted enterprise suites + lint — 1f94fdc2dd
- [ ] 4.2 Full configured validation gate (local runner)
- [ ] 4.3 Draft PR open, labels applied, summary comment, review pass

## Progress

PR: #10493 (link: https://github.com/open-mercato/open-mercato/pull/10493)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.
