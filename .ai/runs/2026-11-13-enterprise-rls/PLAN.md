# Full enterprise PostgreSQL RLS implementation

Source doc: .ai/specs/enterprise/2026-11-12-row-level-security.md
PR: #9424
Engine: om-auto-continue-pr-loop

## Tasks

> Authoritative status table. Status is todo or done. One commit per Step. Exec cells are inline because production scope propagation, pool ownership, policy lifecycle and tests form one tightly coupled change. Independent read-only investigations and final reviews may be dispatched.

| Phase | Step | Title | Exec | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| 0 | 0.1 | Preserve completed isolated connection proof and integration runner | inline | done | 4349cbf789 |
| 1 | 1.1 | Complete activation design and compatibility/security review | inline | todo | — |
| 1 | 1.2 | Add edition-neutral database lifecycle and execution scope hooks | inline | todo | — |
| 1 | 1.3 | Implement enterprise scoped pool ownership and topology guards | inline | todo | — |
| 1 | 1.4 | Implement table manifest, effective policy and runtime role verification | inline | todo | — |
| 1 | 1.5 | Register enterprise enforcement before ORM initialization | inline | todo | — |
| 2 | 2.1 | Propagate trusted API identity before authorization and handler queries | inline | todo | — |
| 2 | 2.2 | Cover page, portal and public-token execution contexts | inline | todo | — |
| 2 | 2.3 | Propagate worker, subscriber and scheduler tenant contexts | inline | todo | — |
| 2 | 2.4 | Separate tenant CLI operations from privileged maintenance | inline | todo | — |
| 2 | 2.5 | Classify and integrate independent search, vector and event pools | inline | todo | — |
| 3 | 3.1 | Reconcile explicit canary policies through migrations with rollback | inline | todo | — |
| 3 | 3.2 | Add self-contained canary CRUD and cross-tenant HTTP integration tests | inline | todo | — |
| 3 | 3.3 | Add dispatcher, job retry and maintenance integration coverage | inline | todo | — |
| 3 | 3.4 | Verify canary browser flow and publish working-app screenshots | inline | todo | — |
| 3 | 3.5 | Benchmark checkout overhead and pool pressure | inline | todo | — |
| 4 | 4.1 | Run full repository and integration validation gates | inline | todo | — |
| 4 | 4.2 | Complete independent code and security review with fixes | inline | todo | — |
| 4 | 4.3 | Publish full implementation results and finalize PR | inline | todo | — |

## Goal

Implement the complete enterprise RLS specification, including production integration and an explicitly reviewed table canary, with real HTTP/worker/database/browser evidence on PR #9424. The user corrected the prior Phase-0-only scope and explicitly selected the PR-loop engine. That authorization supersedes the earlier prototype-only assumption; deployment to production and applying migrations to the user database remain outside scope.

## Scope and compatibility

Keep enterprise behavior in the commercial package. Add only edition-neutral hooks to OSS infrastructure and preserve disabled-mode behavior. Resolve trusted identity before tenant authorization; do not use raw tenant headers or query values as authority. Preserve RBAC, encryption, mutation guards, optimistic locking, short transactions and side effects. Fail closed for invalid topology, roles, policies and escaped connection scopes. Global maintenance uses a separate explicit database role/connection boundary. Maintain reviewed table coverage and justified exclusions; enable only the canary initially.

## Non-goals

No row/team authorization, dependency upgrade, transaction-proxy support, implicit superadmin bypass, global auto-enable of every tenant table, production deployment, local application migration, branch/base merge, or removal of application scoping.

## Implementation Plan

### Step 1.1: Complete activation design and compatibility/security review

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 1.2: Add edition-neutral database lifecycle and execution scope hooks

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 1.3: Implement enterprise scoped pool ownership and topology guards

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 1.4: Implement table manifest, effective policy and runtime role verification

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 1.5: Register enterprise enforcement before ORM initialization

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 2.1: Propagate trusted API identity before authorization and handler queries

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 2.2: Cover page, portal and public-token execution contexts

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 2.3: Propagate worker, subscriber and scheduler tenant contexts

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 2.4: Separate tenant CLI operations from privileged maintenance

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 2.5: Classify and integrate independent search, vector and event pools

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 3.1: Reconcile explicit canary policies through migrations with rollback

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 3.2: Add self-contained canary CRUD and cross-tenant HTTP integration tests

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 3.3: Add dispatcher, job retry and maintenance integration coverage

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 3.4: Verify canary browser flow and publish working-app screenshots

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 3.5: Benchmark checkout overhead and pool pressure

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 4.1: Run full repository and integration validation gates

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 4.2: Complete independent code and security review with fixes

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

### Step 4.3: Publish full implementation results and finalize PR

Implement the corresponding production requirement and ship meaningful unit/integration coverage. Preserve the specification boundaries and publish evidence at the phase checkpoint.

## Verification and checkpoints

Checkpoint after Steps 1.5, 2.5 and 3.5: targeted validation, real database/integration evidence, HANDOFF rewrite and append-only NOTIFY, PR evidence comment. Working-app screenshots at Step 3.4. Final gate: all configured validation.commands, full Playwright integration suite, template integration when synced app surfaces change, independent review. Earlier Phase 0 evidence remains historical and must not be presented as production verification.

## Risks

An unclassified context/pool or missing scope can cause false empty reads or denied writes; activation stays off until the full topology is verified. Privileged roles, widening policies, retained clients and module duplication can defeat isolation and must be rejected. Session mode is incompatible with transaction pooling. Additional checkout round trips need measurement. Migration generation must not touch unrelated tables; apply migrations only in disposable test environments, never the user application database.

## External references

No external skill URLs. Repository spec and installed driver source are the implementation references.
