# Execution plan — Agent trace ingest scope

Source doc: `.ai/specs/enterprise/agent-orchestrator/2026-11-24-trace-ingest-scope.md`

## Goal

Authenticate trace deliveries for their tenant and organization. Use the persisted agent invocation for workflow attribution and validate it before updating the selected run.

## Scope

- Derive a signing key for each tenant and organization. Upgrade the first-party signing helpers and document the adapter cutover.
- Validate organization ownership, workflow attribution, confidence and cost in the ingest command.
- Run the trace and workflow tests. Complete the repository validation and maintainer review required for a signing contract change.

## Progress

PR: #10493 (link: https://github.com/open-mercato/open-mercato/pull/10493)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Implementation

- [x] Bind the trace signer and verifier to the authenticated scope.
- [x] Verify the persisted workflow and agent reference before writes.
- [x] Add unit coverage and update the first-party integration fixtures.
- [x] Document the adapter and operator migration.

### Merge gates

- [ ] Full configured validation and required CI.
- [ ] Maintainer approval of the signing contract cutover.
