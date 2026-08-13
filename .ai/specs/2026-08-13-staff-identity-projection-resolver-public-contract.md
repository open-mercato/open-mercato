# Staff Identity Projection Resolver Public Contract

| Field | Value |
|---|---|
| **Status** | Implemented — validated with known unrelated repository baselines |
| **Created** | 2026-08-13 |
| **Target** | Current core `staff` module |
| **Related** | `2026-08-12-staff-identity-resolver-public-contract.md`, `2026-07-15-staff-member-directory.md` |

## TLDR

Add one stable, Staff-owned, request-scoped `staffIdentityProjectionResolver` DI service. It
hydrates at most 100 known Staff UUIDs into minimal display projections, including inactive
non-deleted records, without exposing Staff entities or Auth linkage.

There is no entity, migration, API, UI, ACL, event, cache, worker, dependency, or downstream
consumer change.

## Problem Statement

Server modules that persist Staff UUID references need historical labels without importing Staff
entities. The active-only `staffIdentityResolver` cannot represent inactive historical identities,
and searchable candidate discovery has different filtering and pagination semantics.

The proposed `staffMemberDirectory` is also not a substitute: it accepts Auth user IDs, returns
active scheduling references with Auth and availability metadata, deliberately preserves duplicate
Staff links, and uses different batching semantics. This resolver accepts exact Staff IDs, includes
inactive history, validates a hard bound of 100, and exposes no Auth or scheduling data.

## Proposed Solution

Export types from the exact path
`@open-mercato/core/modules/staff/contracts/identityProjectionResolver`, implement the read inside
Staff with encryption-aware helpers, and register it under the frozen Awilix key
`staffIdentityProjectionResolver`.

The resolver validates exact tenant and organization scope, validates and deduplicates at most 100
input UUIDs before querying, returns active or inactive non-deleted matches, and omits missing,
deleted, and cross-scope rows indistinguishably. Empty input returns without querying. Operational
failures propagate without partial or plaintext fallback.

## Architecture

```ts
export type StaffIdentityProjectionScope = {
  tenantId: string
  organizationId: string
}

export type StaffIdentityProjection = {
  staffMemberId: string
  displayName: string
  isActive: boolean
}

export type StaffIdentityProjectionResolver = {
  resolveByIds(
    scope: StaffIdentityProjectionScope,
    staffMemberIds: string[],
  ): Promise<StaffIdentityProjection[]>
}
```

The service promises neither input ordering nor placeholder rows. Consumers map results by
`staffMemberId`, own authorization, and preserve UUID fallbacks for omitted identities. No Auth
UUID, team, role, contact, description, or ORM object crosses the public boundary.

## Data Models

No schema change. The implementation reads existing `StaffTeamMember` rows through
`findWithDecryption`, repeating tenant and organization scope in the ORM predicate and decryption
scope. It filters `deletedAt: null` but deliberately does not filter `isActive`.

## API Contracts

No HTTP, OpenAPI, MCP, or portal API is added. This is a trusted server-side DI contract only.

## Migration & Backward Compatibility

The contract, exact import path, DI key, method name, required input fields, and projection fields
are additive stable surfaces under `BACKWARD_COMPATIBILITY.md`. Once released, incompatible change
requires deprecation, a working bridge for at least one minor release, and upgrade guidance.

If Staff is extracted, the new package becomes canonical while the core path remains a deprecated,
type-compatible bridge for the required compatibility window. Before release, rollback removes the
contract, implementation, registration, export, documentation, and tests together. No database
rollback is needed.

## Testing Strategy

Focused tests assert pre-query validation and bounds, empty-input short-circuiting, deduplication,
exact scope, inactive inclusion, deleted/missing omission, minimal projection, output deduplication,
failure propagation, exact published type import, CLASSIC injection, and request-scope isolation.

## Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Cross-scope historical identity disclosure | High | Exact scope in predicate and decryption context; negative tests assert the full call. |
| Callers treat output position as authoritative | Medium | No order promise; documentation requires mapping by Staff UUID. |
| Excessive batch size causes broad reads | Medium | Reject more than 100 IDs before querying and deduplicate accepted inputs. |
| KMS/DB failure yields incomplete labels | Medium | Propagate failures; never return partial or plaintext results. |

## Acceptance Criteria

- [x] Exact type path and request-scoped `staffIdentityProjectionResolver` registration exist.
- [x] Scope and at most 100 UUIDs validate before query; empty input performs no query.
- [x] Inputs and outputs are deduplicated and exact-scope non-deleted rows are returned.
- [x] Active and inactive Staff are included; missing, deleted, and cross-scope rows are omitted.
- [x] Output contains only Staff UUID, display name, and active state.
- [x] Database/decryption failures propagate without partial fallback.
- [x] Existing Staff entities, routes, ACLs, events, and public resolvers remain unchanged.
- [x] Focused tests and configured validation gates pass without entity or migration drift.

## Implementation Plan

1. Add the type-only contract and internal Staff resolver.
2. Register the resolver as scoped and document/export the stable surface.
3. Add semantic, isolation, and published-import tests.
4. Run generation, focused tests, package build/typecheck, and the configured review gate.

## Final Compliance Report

Implemented as an additive, type-only public contract backed by a Staff-owned scoped resolver. No
entity, migration, API, UI, ACL, event, or module-structure file changed.

Validation completed on 2026-08-13:

- Projection resolver and Staff DI tests: 2 suites, 19 tests passed.
- Combined identity resolver, projection resolver, and Staff DI tests: 3 suites, 33 tests passed.
- Nearby Planner, Staff, and Customers regressions: 5 suites, 17 tests passed.
- Core typecheck and changed-file ESLint passed; ESLint emitted only the existing Next.js pages
  directory warning.
- `yarn generate` completed with generated outputs unchanged.
- Core build passed, including 3,944 core and 204 generated entry points.
- `yarn build:packages` passed all 22 package tasks.
- The exact built contract subpath resolves; its runtime export is intentionally empty because the
  public module exports types only.

The wider repository baselines already recorded by the related identity-resolver implementation
remain unrelated Windows/environment failures (path casing/absolute-path expectations, POSIX
permission assertions, and environment-state assumptions). They do not touch this resolver's
change surface and are not masked by this implementation.

## Changelog

- 2026-08-13 - Created the upstream implementation specification from the reviewed downstream
  Task & Project Management prerequisite.
- 2026-08-13 - Implemented and validated the public projection contract, scoped resolver, DI
  registration, package export, documentation, and focused regression coverage.
