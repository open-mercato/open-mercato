# SPEC-035: Mutation Guard Mechanism

- Date: 2026-02-22
- Status: Implemented (backfilled)
- Scope: OSS

## TLDR
A generic mutation guard contract is now part of `@open-mercato/shared` and is executed by the CRUD factory and selected custom mutation routes before and after write operations. The mechanism is neutral (not record-lock specific) and allows any package to enforce cross-cutting mutation rules through DI via `crudMutationGuardService`.

## Overview
Open Mercato needed a reusable way to pre-validate writes (for example lock checks, workflow guards, future policy checks) without hard-coding domain-specific behavior into shared CRUD internals.

The implemented mechanism introduces:
- a shared guard interface in `packages/shared/src/lib/crud/mutation-guard.ts`
- guard hooks in `packages/shared/src/lib/crud/factory.ts` for update/delete mutations
- explicit use in non-CRUD custom mutation routes (`sales.quotes.convert`, `sales.quotes.send`)
- fail-safe behavior when no guard service is registered

## Problem Statement
Before this mechanism, write guard behavior was tied to specific module implementations and could leak package-specific logic into generic CRUD paths.

That caused three issues:
1. Shared CRUD internals could become coupled to one feature implementation.
2. Non-CRUD mutation routes had no consistent way to run the same protection rules.
3. Future guard-style policies would require repeated ad hoc route logic.

## Proposed Solution
Define a DI-resolved mutation guard contract and execute it in write paths.

### Contract
`crudMutationGuardService` must expose:
- `validateMutation(input) => Promise<CrudMutationGuardValidationResult>`
- `afterMutationSuccess(input) => Promise<void>`

`validateMutation` returns either:
- success: `{ ok: true, shouldRunAfterSuccess, metadata? }`
- failure: `{ ok: false, status, body }`

### Execution Model
1. Before mutation:
- call `validateCrudMutationGuard(container, input)`
- if result is failure, return `status/body` immediately

2. After successful mutation:
- if result was success and `shouldRunAfterSuccess === true`, call `runCrudMutationGuardAfterSuccess`
- after-success errors are logged and swallowed so business mutations stay successful

### Neutral Design
The shared layer only knows the generic contract and DI token. It does not reference any domain module, lock service, or feature-specific headers.

## Architecture

### Shared Components
- `packages/shared/src/lib/crud/mutation-guard.ts`
  - guard types and DI resolution
  - `validateCrudMutationGuard`
  - `runCrudMutationGuardAfterSuccess`

- `packages/shared/src/lib/crud/factory.ts`
  - runs guard for `PUT`/`DELETE` write paths in both CRUD and command-backed CRUD updates/deletes
  - converts guard failures into HTTP responses

### Current Custom Route Integrations
- `packages/core/src/modules/sales/api/quotes/convert/route.ts`
- `packages/core/src/modules/sales/api/quotes/send/route.ts`

Both routes:
- call `validateCrudMutationGuard` before mutation logic
- return guard failure response when validation fails
- call `runCrudMutationGuardAfterSuccess` after successful mutation when requested

### Runtime Behavior Without an Adapter
If `crudMutationGuardService` is not registered or invalid:
- validation returns `null`
- route proceeds normally
- after-success hook is skipped

This keeps OSS behavior stable by default.

## Data Models
No database schema changes are required for the mechanism itself.

The guard contract passes runtime context only:
- tenancy (`tenantId`, `organizationId`)
- actor (`userId`)
- mutation target (`resourceKind`, `resourceId`)
- operation metadata (`operation`, `requestMethod`, `requestHeaders`, optional `mutationPayload`)

## API Contracts
No new API endpoints are introduced by this mechanism.

### Contract Impact On Existing APIs
Guard-aware routes can now return module-provided validation errors (for example `409`, `423`) in addition to route-native errors.

### Affected API Paths
- All update/delete endpoints built with `makeCrudRoute` (`PUT` and `DELETE`)
- `POST /api/sales/quotes/convert`
- `POST /api/sales/quotes/send`

### Error Propagation Contract
Guard failure response is always passed through exactly as returned by the adapter:
- HTTP status: `validation.status`
- JSON body: `validation.body`

## Integration Coverage

### API Coverage
1. CRUD `PUT` route with guard success should proceed and run after-success when enabled.
2. CRUD `PUT`/`DELETE` route with guard failure should short-circuit with adapter status/body.
3. `POST /api/sales/quotes/convert` should short-circuit on guard failure and execute after-success on success.
4. `POST /api/sales/quotes/send` should short-circuit on guard failure and execute after-success on success.

### Key UI Path Coverage
1. Any backend edit form using CRUD update/delete (`CrudForm` + CRUD API) should surface returned guard errors consistently.
2. Custom Sales document mutation flow (`/backend/sales/documents/[id]`) should surface guard failures from `convert`/`send` operations.

### Existing Automated Coverage
- `packages/shared/src/lib/crud/__tests__/crud-factory.test.ts`
- `packages/enterprise/src/modules/record_locks/__tests__/crudMutationGuardService.test.ts`
- record-lock integration tests that verify guard behavior through guarded mutations

## Risks & Impact Review

#### Guard Adapter Returns Invalid Payload
- Scenario: Adapter returns malformed `status/body`, causing inconsistent HTTP responses.
- Severity: Medium
- Affected area: All guarded mutation endpoints
- Mitigation: Shared contract typing, adapter tests, route-level defensive handling through structured result types
- Residual risk: Low

#### After-Success Hook Failure
- Scenario: Adapter cleanup/notification logic fails after mutation commit.
- Severity: Medium
- Affected area: Post-write side effects (not the write itself)
- Mitigation: `runCrudMutationGuardAfterSuccess` catches and logs errors without failing the mutation response
- Residual risk: Medium (side effect may be skipped)

#### Custom Mutation Route Drift
- Scenario: New custom write routes forget to call the guard.
- Severity: Medium
- Affected area: Non-CRUD write endpoints
- Mitigation: This spec formalizes required integration points; existing Sales custom routes already wired
- Residual risk: Medium

#### Adapter Coupling Leaks Into Shared
- Scenario: Future changes re-introduce domain-specific logic into `@open-mercato/shared`.
- Severity: High
- Affected area: Package isolation and maintainability
- Mitigation: Generic DI contract with no domain imports in shared layer
- Residual risk: Low

## Final Compliance Report - 2026-02-22

### AGENTS.md Files Reviewed
- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | Keep modules isolated and avoid cross-module coupling | Compliant | Shared guard is generic and DI-based |
| `packages/shared/AGENTS.md` | Shared MUST NOT include domain-specific logic | Compliant | Guard contract contains no domain imports |
| `packages/core/AGENTS.md` | API routes MUST export `openApi` | Compliant | Covered custom routes export `openApi` |
| `.ai/specs/AGENTS.md` | Include required sections in non-trivial specs | Compliant | All required sections included |
| `AGENTS.md` | Spec must list integration coverage for affected API and key UI paths | Compliant | Explicit API and UI coverage sections included |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | Runtime-only contract, no schema additions |
| API contracts match architecture section | Pass | Affected routes and behavior align |
| Risks cover write paths | Pass | Guard validation and after-success risks documented |
| Extensibility mechanism is scope-correct | Pass | OSS generic contract; adapters live outside shared |

### Non-Compliant Items
- None.

### Verdict
Fully compliant. Approved.

## Changelog
### 2026-02-22
- Added OSS specification for the generic mutation guard mechanism.
- Documented current integrations in CRUD factory and Sales custom mutation routes.
- Defined coverage and risk model for future guard adapters.
