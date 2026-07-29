# Scoped Staff Member Directory

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-07-15 |
| **Builds on** | [Staff Decouple from Core](implemented/2026-05-08-staff-decouple-from-core.md) |
| **Related** | `packages/core/src/modules/staff/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` |

## TLDR

**Key Points:**
- Add one narrow, read-only `staffMemberDirectory` DI service owned by the optional `staff` module.
- Let optional backend integrations map trusted user IDs to active staff-member and availability-rule-set references without importing staff entities or adding a hard module dependency.
- Enforce tenant and organization scope in both the ORM predicate and the decryption-helper scope.

**Scope:**
- A stable public DI key, interface, and scheduling-reference result type.
- A request-container-scoped default implementation, DI registration, contract documentation, and focused automated tests.

**Boundaries:**
- No booking workflow, role lookup, API route, UI, schema migration, ACL change, event, cache, or dependency declaration.
- The optional consumer owns authorization, selection of trusted user IDs, and graceful behavior when `staff` is absent.

## Overview

Optional modules sometimes need a small amount of staff-owned scheduling metadata after they
have already selected and authorized a set of application users. The existing staff entity
classes are deliberately internal, while the staff module's assignable-members HTTP route is
customer-flow-specific and carries unrelated RBAC and response semantics. Neither is an
appropriate general-purpose backend integration surface.

This specification adds a narrow directory port to the staff module. It returns only the
identifiers and display label needed to connect an already-authorized user to staff-owned
availability data. The service does not decide who is eligible, who may book, or how a booking
is created.

> **Market reference:** Cal.com's open-source `RegularBookingService` receives booking and user
> repositories as separate dependencies. This supports the limited architectural principle that
> booking orchestration should consume a focused participant lookup instead of an all-purpose user
> model. It does not imply that Cal.com exposes an optional DI contract or uses the tenant and
> identifier semantics proposed here. The exact source is recorded in [References](#references).

## Problem Statement

The staff module currently exposes two safe integration paths:

1. `availabilityAccessResolver`, a narrow DI service for planner write authorization.
2. `GET /api/staff/team-members/assignable`, a customer-flow-oriented HTTP route with
   customer-specific permissions and paging semantics.

An optional backend integration that already has authorized user IDs still cannot obtain the
corresponding staff member IDs and availability rule set IDs without choosing one of these
unsafe or disproportionate approaches:

- importing `StaffTeamMember`, which violates module isolation and would break when staff is
  extracted to `@open-mercato/staff`;
- calling an internal entity query from another module, which bypasses the staff ownership
  boundary;
- reusing the assignable-members API, which couples backend logic to customer-specific RBAC,
  HTTP transport, and a broader response contract;
- adding a hard `requires: ['staff']`, which prevents the consumer from remaining optional.

The missing capability is therefore not a booking engine or a broad staff search. It is one
bounded, tenant-safe translation from trusted user IDs to scheduling references.

## Proposed Solution

Add a public `StaffMemberDirectory` interface and default implementation inside the staff
module, then register it under the stable Awilix key `staffMemberDirectory`.

The only method, `listActiveSchedulingRefs`, accepts a finite set of user IDs plus trusted
tenant and organization identifiers. It returns one entry for each matching active,
non-deleted staff-member row. Results contain no entity instances and no unrelated staff data.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Staff owns the directory implementation and public types | Staff remains the authority for its internal entity and can move the contract with the module during extraction. |
| Optional consumers resolve the service softly | A missing or disabled staff module must not prevent the consumer from loading. |
| Scope is explicit in every method call | The service cannot accidentally inherit or guess a tenant/organization boundary. Callers must derive both values from authenticated request context. |
| User IDs are an allowlist, not a search query | The service cannot enumerate all staff members and does not become a general directory API. |
| Multiple rows for one user are preserved | The current schema does not declare `user_id` unique; the contract must not invent a one-to-one invariant. |
| `availabilityRuleSetId` is nullable | A valid staff member may use fallback availability behavior without a dedicated rule set. |
| Deterministic ordering by display name and ID | Consumers receive stable output while duplicate display names and multiple rows per user remain unambiguous. |
| Request-container-scoped registration | The implementation receives the request's `EntityManager` and must not retain it across request containers. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Import `StaffTeamMember` directly | Entity classes are internal and staff is planned for package extraction. |
| Add a new HTTP endpoint | Adds transport, authentication, authorization, OpenAPI, and data-exposure surface for a server-side lookup that already runs within one request container. |
| Reuse `/api/staff/team-members/assignable` | Its customer-specific permissions and broader workflow semantics are not a reusable backend contract. |
| Publish staff entity types from a shared package | Leaks persistence ownership across modules and makes extraction harder. |
| Event-based request/response | The lookup is synchronous, read-only, and request-bound; event RPC would add correlation, timeout, and failure complexity without a side-effect boundary. |
| Put booking or role resolution in this service | Those decisions belong to consumer workflows and authorization policy, not to a generic staff directory. |

## User Stories / Use Cases

- **An optional module developer** wants to map already-authorized application users to staff
  scheduling references without importing staff entities.
- **An optional integration** wants to remain loadable when staff is disabled and show its own
  fallback state instead of failing module bootstrap.
- **A platform maintainer** wants staff extraction to preserve a small documented contract rather
  than unknown entity-level dependencies.

These are backend integration use cases. There is no end-user UI or public HTTP use case in this
slice.

## Architecture

```text
authenticated request context
        |
        | tenantId + organizationId + authorized userIds
        v
optional consumer-owned adapter
        |
        | tryResolve('staffMemberDirectory')
        v
StaffMemberDirectory (public port)
        |
        | scoped, decrypted ORM read
        v
StaffTeamMember (staff-internal entity)
```

### Ownership and Module-Absence Behavior

- The staff module owns the service, implementation, registration key, and exported result types.
- The optional consumer owns the adapter/glue and MUST NOT be imported or resolved by staff.
- The consumer uses a local `tryResolve` helper that wraps
  `container.resolve('staffMemberDirectory', { allowUnregistered: true })` and returns
  `undefined` when staff is not registered.
- The consumer MUST handle `undefined` explicitly, either by hiding staff-derived scheduling
  behavior or returning its own typed unavailable state.
- The consumer MUST NOT add staff to `requires` solely for this lookup.
- The staff DI test MUST prove that a bare container with no staff registrar returns `undefined`
  for soft resolution. Because this slice contains no consumer, a full staff-disabled consumer
  flow is deferred and becomes mandatory in the first consumer change.

### Public Contract

The implementation and source types live in
`packages/core/src/modules/staff/services/staffMemberDirectory.ts` without re-exporting any
entity class. `packages/core/src/modules/staff/index.ts` re-exports the public types, and
`packages/core/package.json` adds the explicit export below. The explicit mapping is required
because the generic `./*/*` wildcard would otherwise resolve `./modules/staff` to
`dist/modules/staff.js` instead of `dist/modules/staff/index.js`.

```json
"./modules/staff": {
  "types": "./src/modules/staff/index.ts",
  "default": "./dist/modules/staff/index.js"
}
```

This makes the following the only documented consumer import path:

```ts
import type {
  StaffMemberDirectory,
  StaffMemberSchedulingRef,
} from '@open-mercato/core/modules/staff'
```

The source contract is:

```ts
export type StaffMemberSchedulingRef = {
  userId: string
  staffMemberId: string
  availabilityRuleSetId: string | null
  displayName: string
}

export interface StaffMemberDirectory {
  listActiveSchedulingRefs(params: {
    userIds: string[]
    tenantId: string
    organizationId: string
  }): Promise<StaffMemberSchedulingRef[]>
}
```

`staffMemberDirectory`, `StaffMemberDirectory`, `StaffMemberSchedulingRef`, and
`@open-mercato/core/modules/staff` become stable surfaces under `BACKWARD_COMPATIBILITY.md` when
released. Additive optional fields or methods may be introduced later; renaming, removal, field
narrowing, or a semantic change requires the normal deprecation protocol.

### Lookup Semantics

`listActiveSchedulingRefs` MUST:

1. Deduplicate `userIds` by exact string equality before querying. Duplicate input IDs do not
   duplicate result rows.
2. Return `[]` without issuing a query when the deduplicated input is empty.
3. Split deduplicated IDs into deterministic chunks of at most 500 IDs and issue exactly one
   query per non-empty chunk. Query count is therefore `ceil(uniqueUserIds / 500)`.
4. Query `StaffTeamMember` for each chunk with all of these predicates in one ORM criteria object:
   `userId IN userIds`, `tenantId`, `organizationId`, `isActive: true`, and `deletedAt: null`.
5. Use `findWithDecryption` and repeat `tenantId` and `organizationId` in every query's scope
   argument.
6. Merge all chunk results, then sort the final array by `displayName ASC, staffMemberId ASC`.
7. Omit rows whose nullable `userId` is absent, even if a mocked or future query result violates
   the input predicate.
8. Map only `userId`, `id -> staffMemberId`, `availabilityRuleSetId ?? null`, and `displayName`.
9. Preserve multiple matching staff-member rows for the same user.
10. Perform no role lookup, eligibility decision, write, event emission, or cache mutation.

The service accepts internal, typed input rather than raw HTTP input. UUID validation and
authorization remain the consumer boundary's responsibility. A consumer MUST derive tenant and
organization IDs from authenticated request context, never from untrusted request payloads.

### DI Registration

`packages/core/src/modules/staff/di.ts` registers the default implementation as a scoped Awilix
resolver under `staffMemberDirectory`. Awilix treats the root container as a scope, and Open
Mercato creates a fresh root container and `EntityManager` for each request. The scoped lifetime
therefore caches one directory wrapper per request container without retaining `em` across
requests. The implementation uses CLASSIC-compatible constructor or factory injection with an
explicit parameter named `em`, matching the application's injection mode and registration key.

The existing `availabilityAccessResolver` registration is unchanged. Registration is additive and
does not change module bootstrap order.

### Commands, Events, Cache, and Workers

- **Commands:** N/A. The service performs no mutation.
- **Events:** N/A. A synchronous read does not emit or consume events.
- **Cache:** No cache in the initial implementation. The lookup is request-bound, scoped, and
  constrained by caller-provided IDs; avoiding a second scoped data store also removes stale and
  cross-tenant cache-key risk.
- **Workers:** N/A. The query is an interactive bounded lookup and does not create background work.

## Data Models

No data model or migration changes are proposed. The service reads existing `StaffTeamMember`
columns:

| Existing field | Contract use |
|----------------|--------------|
| `id` | Returned as `staffMemberId` |
| `tenantId` | Mandatory scope predicate and decryption scope |
| `organizationId` | Mandatory scope predicate and decryption scope |
| `userId` | Requested-user predicate and returned identifier when non-null |
| `displayName` | Stable display label and primary sort key |
| `availabilityRuleSetId` | Nullable scheduling reference |
| `isActive` | Must be `true` |
| `deletedAt` | Must be `null` |

The existing `staff_team_members_tenant_org_idx` supports the mandatory tenant/organization
restriction. The remaining filter operates inside that scope and is further bounded by explicit
user IDs. No new index is justified for the initial contract. If production query plans show
organization-local scans becoming material, a separate additive index proposal should be based on
measured cardinality and `EXPLAIN` evidence.

Staff-team-member display data is not currently declared in `staff/encryption.ts`, but reads still
use `findWithDecryption` so the contract remains correct if the encryption map expands later.

## API Contracts

No HTTP, OpenAPI, MCP, or portal API is added or modified. Authentication metadata, request Zod
schemas, pagination, route mutation guards, and HTTP error bodies are therefore N/A.

The public integration surface is the typed DI interface in [Public Contract](#public-contract).
Consumer-owned API routes, if any, remain responsible for their own `metadata.requireAuth`, RBAC,
Zod validation, error mapping, and trusted scope derivation.

## Internationalization (i18n)

N/A. No user-facing string is added. `displayName` is existing staff-owned data, not interface copy.

## UI/UX

N/A. No backend or portal screen, widget, dialog, control, or navigation entry is added.

## Migration & Backward Compatibility

This change is additive:

- no database migration or backfill;
- no existing DI key, interface, API route, ACL feature, event ID, or import path changes;
- no new hard module dependency;
- no behavior change for applications that do not resolve the new key;
- no release-time configuration;
- no `UPGRADE_NOTES.md` entry is needed for the addition itself.

Once released, the new DI key, exported types, and documented package import are stable contract
surfaces. Future removal or breaking changes require deprecation, a compatibility bridge for at
least one minor release, and migration guidance under `BACKWARD_COMPATIBILITY.md`.

Staff is planned for extraction to `@open-mercato/staff`. The directory contract moves with the
staff module. At extraction, `@open-mercato/staff` becomes the canonical import, while
`@open-mercato/core/modules/staff` MUST continue to compile as a deprecated type-compatible bridge
for at least one minor release. The bridge may be a type-only re-export or an equivalent
compatibility declaration, but it must expose the same required fields and migration guidance.
The `staffMemberDirectory` DI key and method semantics remain unchanged across the move.

Rollback before release is deletion of the additive registration, service, tests, and contract
documentation. After release, rollback must preserve the registered key or provide a deprecated
compatibility implementation; immediate removal would be breaking.

## Implementation Plan

### Phase 1: Contract and Default Implementation

1. Add `services/staffMemberDirectory.ts` with the public types and default implementation.
2. Add the explicit `./modules/staff` entry to `packages/core/package.json` so both source types
   and built JavaScript resolve to `staff/index`.
3. Re-export the two public types from `staff/index.ts` at
   `@open-mercato/core/modules/staff`.
4. Register `staffMemberDirectory` in `staff/di.ts` as a scoped, CLASSIC-compatible resolver.
5. Document the key, package import, and extraction bridge in `staff/AGENTS.md` as stable public
   surfaces.

### Phase 2: Verification

1. Add focused service tests for the complete scoped predicate, decryption scope, mapping,
   deterministic ordering options, nullable rule set, duplicate-user preservation, omitted null
   user IDs, deduplication, 500-ID chunking, final cross-chunk ordering, and empty-input short
   circuit.
2. Extend `staff/__tests__/di.test.ts` to prove registration, CLASSIC injection, one instance per
   request scope, isolation across scopes, and bare-container `allowUnregistered` behavior without
   the staff registrar.
3. After building `@open-mercato/core`, run a Node import smoke check against
   `@open-mercato/core/modules/staff` and assert that the package export resolves without relying
   on TypeScript path aliases.
4. Run generation, focused tests, typecheck, lint, and package build gates appropriate to the
   changed files.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/staff/services/staffMemberDirectory.ts` | Create | Public contract and staff-owned default implementation |
| `packages/core/src/modules/staff/services/__tests__/staffMemberDirectory.test.ts` | Create | Read-contract and isolation unit coverage |
| `packages/core/package.json` | Modify | Map the stable `./modules/staff` package export to `staff/index` for types and runtime |
| `packages/core/src/modules/staff/index.ts` | Modify | Re-export public directory types from the stable package path |
| `packages/core/src/modules/staff/di.ts` | Modify | Add scoped DI registration |
| `packages/core/src/modules/staff/__tests__/di.test.ts` | Modify | Registration, lifetime, injection, and absence coverage |
| `packages/core/src/modules/staff/AGENTS.md` | Modify | Document stable public key and import path |

### Testing Strategy

| Coverage | Expected proof |
|----------|----------------|
| Service unit tests | Full ORM predicate and decryption scope; exact public mapping; deduplication; 500-ID chunking; deterministic final order; empty input does not query |
| DI unit tests | Stable key registration; CLASSIC `em` injection; request-scope lifetime; bare-container soft resolution without the staff registrar |
| Consumer staff-disabled integration | Deferred to the first consumer change because this slice intentionally contains no consumer; it must prove that consumer bootstrap and its fallback work with staff absent |
| Built-package import smoke | Node resolves `@open-mercato/core/modules/staff` through the explicit export map and exposes the expected runtime module without a path alias |
| Typecheck and package build | Public types and registration compile in the generated application graph |
| API integration | N/A: no route or transport contract is added or modified |
| UI integration/manual QA | N/A: no UI path is added or modified |

The focused service tests mock `findWithDecryption` to assert the complete query contract. A new
Playwright integration route is intentionally not fabricated for an otherwise unreachable
internal service. Any future consumer API or UI must add self-contained integration coverage in
that consumer's change.

## Deferred Consumer Adoption (Out of Scope)

Downstream optional integrations may adopt the contract in their own repositories and reviews.
They must own authorization, trusted scope derivation, user selection, absence handling, and any
booking workflow. No consumer implementation is part of this specification or its implementation
plan. The first consumer change MUST include a self-contained staff-disabled integration test for
its fallback path; the bare-container DI test in this slice proves only the provider-absence
resolution primitive.

## Risks & Impact Review

### Data Integrity Failures

#### Cross-tenant or cross-organization disclosure
- **Scenario**: The directory omits one scope predicate or supplies an incomplete decryption scope and returns a reference from another tenant or organization.
- **Severity**: High
- **Affected area**: Optional consumers of `staffMemberDirectory`
- **Mitigation**: The contract requires both identifiers in the ORM criteria and the `findWithDecryption` scope; focused tests assert the entire call shape; consumers derive scope from authenticated context.
- **Residual risk**: Low after tests and review; a future implementation change could still regress and is guarded by the contract test.

#### Consumer treats user-to-staff mapping as one-to-one
- **Scenario**: A consumer collapses multiple staff-member rows for one user and silently chooses the wrong availability rule set.
- **Severity**: Medium
- **Affected area**: Consumer scheduling behavior
- **Mitigation**: The result is an array, ordering is deterministic, and this specification explicitly preserves duplicate user IDs. Consumer policy must choose or reject ambiguity.
- **Residual risk**: Low; downstream logic remains consumer-owned and must be reviewed independently.

#### Stale read during concurrent staff edits
- **Scenario**: A staff member is deactivated immediately after the directory read but before a consumer acts on the result.
- **Severity**: Medium
- **Affected area**: Consumer workflow using the returned reference
- **Mitigation**: The directory is read-only and returns a point-in-time reference. Any later write or booking operation must revalidate its own invariants and optimistic-lock its owned records.
- **Residual risk**: Expected read/write race for a non-transactional cross-module lookup; no data is mutated by this service.

### Cascading Failures & Side Effects

#### Optional consumer hard-resolves the directory
- **Scenario**: A consumer calls unconditional `container.resolve`, causing request failures when staff is disabled or not installed.
- **Severity**: Medium
- **Affected area**: Optional consumer availability
- **Mitigation**: Contract documentation mandates a local `tryResolve` wrapper with `allowUnregistered: true`; absence behavior is tested and the consumer owns a fallback.
- **Residual risk**: Low; conformance remains a downstream review responsibility.

#### Service becomes a booking-policy catch-all
- **Scenario**: Later callers add role checks, booking eligibility, or workflow state to the directory and couple unrelated products to staff policy.
- **Severity**: Medium
- **Affected area**: Staff public contract and optional integrations
- **Mitigation**: The interface is intentionally read-only and narrowly named; non-goals and ownership boundaries are documented in the staff module guide.
- **Residual risk**: Low while additions require spec and public-contract review.

### Tenant & Data Isolation Risks

#### Caller passes untrusted scope or user IDs
- **Scenario**: A consumer forwards tenant, organization, or user IDs directly from request payload instead of deriving and authorizing them.
- **Severity**: High
- **Affected area**: Consumer API and staff references
- **Mitigation**: The contract explicitly requires authenticated-context scope and an already-authorized user allowlist. Consumer routes remain responsible for auth, RBAC, and Zod validation.
- **Residual risk**: Medium outside this module because consumer authorization cannot be enforced by a generic directory without absorbing consumer policy.

### Migration & Deployment Risks

#### Public contract is stranded during staff extraction
- **Scenario**: Staff moves to `@open-mercato/staff` and consumers retain an internal monorepo import path or the DI registration is omitted.
- **Severity**: Medium
- **Affected area**: Third-party and optional module integrations
- **Mitigation**: The public import path and DI key are documented as stable; extraction must re-export or bridge old paths under the deprecation protocol and carry the registrar with the module.
- **Residual risk**: Low if the extraction follows `BACKWARD_COMPATIBILITY.md`.

### Operational Risks

#### Large user sets cause slow organization-local scans
- **Scenario**: A consumer passes a very large user ID array and an organization has enough staff rows that the existing tenant/organization index is insufficient.
- **Severity**: Low
- **Affected area**: Request latency for the consuming workflow
- **Mitigation**: The implementation deduplicates IDs and issues deterministic chunks of at most 500 IDs, preventing a single oversized `IN` list or parameter-limit failure. The query returns only four fields and uses the existing scope index. Tests assert query count and final ordering across chunk boundaries.
- **Residual risk**: Low; total work still grows linearly with unique IDs, so consumers should pass only candidates needed for the current operation. An additive composite index remains available if measured query plans warrant it.

#### Directory failure is hard to distinguish from absence
- **Scenario**: A consumer catches all resolution or query errors and treats a database failure as if staff were not installed.
- **Severity**: Medium
- **Affected area**: Consumer observability and degraded behavior
- **Mitigation**: `tryResolve` handles only missing registration. Query errors propagate normally and remain visible to request logging and monitoring.
- **Residual risk**: Low if consumers do not swallow execution errors.

## Final Compliance Report - 2026-07-15

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/staff/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | No direct ORM relationships or entity imports between modules | Compliant | Consumers receive plain IDs through a staff-owned DI port. |
| root `AGENTS.md` | Scope tenant-owned reads by tenant and organization | Compliant | Both values are mandatory in the predicate and decryption scope. |
| root `AGENTS.md` | New public code must be wired into the runtime | Conditional on admission | The staff registrar makes the service resolvable by installed modules, while this independently deployable slice intentionally includes no consumer. Maintainers must accept the extension-point use case before implementation. |
| root `AGENTS.md` | New feature specs list affected API and UI integration paths | Compliant | Both are explicitly N/A because the slice has no API or UI; future consumers own their integration coverage. |
| `packages/core/AGENTS.md` | Optional consumer owns glue and resolves peers softly | Compliant | Local `tryResolve` plus `allowUnregistered` and explicit fallback are required. |
| `packages/core/AGENTS.md` | Use `findWithDecryption` with tenant and organization scope | Compliant | Required by lookup semantics and focused tests. |
| `packages/core/AGENTS.md` | Verify optional-module behavior | Compliant for this slice | A bare-container test proves soft DI resolution without the staff registrar. The first real consumer must add a staff-disabled integration test; this spec does not claim the existing module-decoupling suite excludes staff. |
| `packages/core/src/modules/staff/AGENTS.md` | Staff entities are internal; add a narrow DI service for cross-module data | Compliant | The proposal follows the module's documented extension path. |
| `BACKWARD_COMPATIBILITY.md` | DI names and documented public imports are stable | Compliant | The exact current import, extraction-time replacement, and one-minor compatibility bridge are defined. |
| `.ai/qa/AGENTS.md` | Integration tests are self-contained and cover affected paths | N/A | No executable API or UI path exists in this slice; no Playwright-only test hook is introduced. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match public contract | Pass | Every returned field maps to an existing staff-member column and nullability is preserved. |
| API contracts match UI/UX | N/A | Neither surface changes. |
| Risks cover all writes | N/A | The service performs no writes. |
| Commands defined for all mutations | N/A | There are no mutations. |
| Cache strategy covers all reads | Pass | No initial cache; rationale and future measurement trigger are explicit. |
| Module-absence behavior is defined | Pass | Consumer soft-resolves and owns fallback behavior. |
| Backward compatibility is explicit | Pass | Addition and future removal rules are documented. |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved for maintainer review as a specification. Implementation remains
  gated by the repository's contribution admission process.

## References

- [Staff Decouple from Core](implemented/2026-05-08-staff-decouple-from-core.md)
- [`packages/core/src/modules/staff/AGENTS.md`](../../packages/core/src/modules/staff/AGENTS.md)
- [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md)
- [Awilix README - Lifetime management](https://github.com/jeffijoe/awilix/blob/master/README.md#lifetime-management)
- [Awilix README - `container.createScope()`](https://github.com/jeffijoe/awilix/blob/master/README.md#containercreatescope)
- [Awilix README - Injection modes](https://github.com/jeffijoe/awilix/blob/master/README.md#injection-modes)
- [Awilix README - `container.resolve()`](https://github.com/jeffijoe/awilix/blob/master/README.md#containerresolve)
- [Cal.com `RegularBookingService`](https://github.com/calcom/cal.com/blob/main/packages/features/bookings/lib/service/RegularBookingService.ts)

## Changelog

### 2026-07-15
- Initial specification.

### Review - 2026-07-15
- **Reviewer**: Agent, including a fresh-context scope-cohesion pass
- **Security**: Passed; trusted scope derivation, dual scope enforcement, and consumer authorization boundaries are explicit
- **Performance**: Passed; bounded allowlist lookup uses the existing scope index, with a measurement trigger for any future composite index
- **Cache**: Passed; no cache is introduced and the rationale is explicit
- **Commands**: N/A; the service is read-only
- **Risks**: Passed; isolation, absence, extraction, concurrency, and query-size risks have mitigations and residual risk
- **Verdict**: Approved for maintainer review as a specification; implementation remains subject to contribution admission

### Contribution review fixes - 2026-07-15
- Defined `@open-mercato/core/modules/staff` as the only documented public type import and specified the extraction-time compatibility bridge.
- Replaced advisory large-input handling with exact deduplication, 500-ID chunking, query-count, and final-order semantics.
- Corrected the absence-test claim: this slice proves bare-container soft resolution, while the first consumer must add a staff-disabled integration test.
- Completed a live public issue and pull-request collision search; no open overlapping proposal was found.
- Added the explicit `packages/core/package.json` export-map change and built-package import smoke check required for `@open-mercato/core/modules/staff` to resolve to `staff/index`.
