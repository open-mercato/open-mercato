# Owner-provided orchestrator example workflow seeding

Extends: .ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md
Extends: .ai/specs/enterprise/agent-orchestrator/archive/as-built/mvp/05-seed-and-demo.md

## TLDR

Agent Orchestrator keeps its example workflow definitions. Workflows creates them through its server authoring service if they are missing. Rerunning example setup preserves existing definitions and user edits.

## Resolved assumptions (autonomous defaults)

| # | Question | Default | Rationale |
|---|---|---|---|
| Q1 | Should demo workflows use generated process ownership? | Retain current editable rows and add create-if-absent behavior at the owner boundary. | The generated-process upsert can rewrite owned definitions and adds ownership and execution-principal metadata. |

## Overview

Enterprise workstream 4 of [#10476](https://github.com/open-mercato/open-mercato/issues/10476). Start after [#10129](https://github.com/open-mercato/open-mercato/pull/10129), which handles absent peers. Demo deals and evals keep their own call paths. The process worker and runtime materializer retain their current behavior.

## Problem Statement

`agent_orchestrator/lib/seeds.ts` checks for WorkflowDefinition metadata and then writes the table directly. Workflows already provides `workflowDefinitionAuthoring` for process materialization, but its `upsertOwnedDefinition` is intended for generated process definitions. It rewrites owned rows, sets generated metadata and synchronizes a principal. The two editable example fixtures need create-if-absent semantics. [Direct seed writes](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/enterprise/src/modules/agent_orchestrator/lib/seeds.ts#L150-L181) · [Authoring service](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/core/src/modules/workflows/lib/owned-definition.ts#L107-L160)

## Proposed Solution

Add an explicit create-if-absent operation next to the Workflows authoring methods and resolve it softly from the example seeder. As in [Django's get-or-create contract](https://docs.djangoproject.com/en/stable/ref/models/querysets/#get-or-create), use the persisted uniqueness constraint to arbitrate concurrent inserts. Preserve the domain's exact organization scope independently of the tenant-wide uniqueness constraint.

## Architecture

- Leave the two JSON fixtures and the example hook in Agent Orchestrator. Resolve `workflowDefinitionAuthoring` before parsing the files. When Workflows is absent, skip both workflow fixtures and continue with the other example work as today. When Workflows is enabled and a legacy authoring override lacks the new method, fall back to an owner-registered example-authoring capability backed by the same Workflows implementation. A missing fallback or a registered capability failure surfaces through existing seed error handling.
- Add an optional owner operation `createExampleDefinitionIfAbsent(em, input)` on the server authoring service. Validate the explicit tenant/org pair, fixture fields and definition using Workflows' existing validators and authorization scope for trusted setup. Return a safe result of `created` or `already_exists`. An existing definition for the workflow ID in the same tenant and organization, including an edited, newer-version or soft-deleted definition the baseline would find, is a no-op. Preserve both fixture IDs, version 1, enabled state, metadata and editable behavior.
- A tenant's unique key includes workflow ID and version. If the key conflicts, use the caller-aware transaction or savepoint and reread within the requested tenant and organization. A concurrent same-scope seed resolves as already present. The any-version no-op applies to rows visible at the scoped existence check. Authors can still publish another version concurrently under existing rules. The seed inserts at most version 1 and never writes another version. A conflict from a different organization in the same tenant fails via the existing seed failure path without reading or revealing the other organization’s definition. Other persistence errors propagate. A different tenant has its own unique key scope.
- Keep the existing create/flush boundary per fixture and the workflow owner responsible for trigger-cache coherence after commit. Skip cache updates when no row was inserted. Persist no generated ownership, synthetic actor or extra execution grants. The consumer sees no workflow ORM entity or database errors containing the fixture contents.

## Data Model

Use existing `workflow_definitions` and its unique constraint on workflow ID, version and tenant ID. The scope lookup always includes organization ID. Preserve setup transaction semantics and allow safe rerun after one fixture succeeds and the second fails. No schema migration, fixture rewrite or backfill is required.

## API Contracts

The new optional service operation and fallback registration are server-only. Keep the existing authoring DI key and method signatures, including overrides that omit the new operation. Example selection follows today's `--no-examples` behavior. Existing workflow list/detail and edit requests keep their APIs, ACL features and editable/demo behavior.

## Migration & Backward Compatibility

No IDs, versions, routes, ACLs or fixture metadata change. Existing definitions and user edits stay intact. Keep process materialization on `upsertOwnedDefinition` and doc-level authoring guidance separate. A binary rollback keeps all rows usable by the prior implementation. Removing a seeded fixture remains an explicit workflow lifecycle operation under existing permissions.

## Risks & Impact Review

| Risk | Mitigation and residual risk |
|---|---|
| High — seed rerun changes a user-edited workflow or grants execution authority. | Use create-if-absent, pin existing row fields and principal behavior, and guard both in repeat-setup tests. |
| Medium — duplicate concurrent seeds or conflicting organization versions. | Honor the existing unique constraint, recover the same-scope race on a fresh read, and surface a sanitized conflict for a different organization. |
| Medium — absent provider aborts all examples. | Resolve before fixture loading and verify that the rest of the demo and non-example startup paths continue. |

## Phasing

Ship one implementation PR for the two existing fixtures. The OSS service can support the operation without requiring Agent Orchestrator or other Enterprise code.

## Implementation Plan

1. Characterize the two enabled fixtures, no-examples, absent Workflows, and rerun over edited definitions. Extend `packages/enterprise/src/modules/agent_orchestrator/__tests__/seeds-optional-peers.test.ts` and create scoped fixtures for the live setup test.
2. Add the owner operation in `workflows/lib/owned-definition.ts` or its existing authoring service support. Cover same-org repeats, concurrent version-1 seeds, a legacy DI override, same-tenant cross-org conflict, unrelated tenants, fixture validation, cache behavior and recovery after a failure that follows a successful first fixture.
3. Cut over `agent_orchestrator/lib/seeds.ts`. Exercise real example/no-example setup with Workflows present and absent. Check fixture visibility through the existing authorized workflow definitions API and edit/rerun behavior. Verify no generated ownership, unexpected grants or direct WorkflowDefinition persistence in the seeder.

## Final Compliance Report

The design keeps fixtures in their source module and scopes writes in the data owner. It preserves existing workflow ownership, avoids any new HTTP or UI contract and calls for self-contained setup and scope coverage in the implementation PR.

## Changelog

- 2026-11-24 — Proposed a Workflows-owned example fixture creation boundary for #10476.
- 2026-11-24 — Added Workflows-owned example authoring and a fallback for legacy DI overrides. Covered concurrent inserts, scoped conflicts, and setup transaction visibility in PostgreSQL tests.
