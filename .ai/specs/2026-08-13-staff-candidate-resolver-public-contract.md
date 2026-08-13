# Staff Candidate Resolver Public Contract

| Field | Value |
|---|---|
| **Status** | Implemented — validated with known unrelated repository baselines |
| **Created** | 2026-08-13 |
| **Target** | Current core `staff` module |
| **Related** | `2026-08-12-staff-identity-resolver-public-contract.md`, `2026-08-13-staff-identity-projection-resolver-public-contract.md`, `2026-07-15-staff-member-directory.md` |

## TLDR

Add one stable, Staff-owned, request-scoped `staffCandidateResolver` DI service for bounded,
organization-local Staff selection. It returns only active candidate UUIDs and decrypted display
names, supports linked-only membership selection or linked-and-unlinked assignment selection, and
keeps consumer authorization outside Staff.

This is the final upstream prerequisite for the Task & Project Management C1 module. It adds no
entity, migration, HTTP route, UI, ACL, event, cache, worker, or downstream consumer.

## Problem Statement

Optional modules need reusable Staff candidate discovery without importing Staff entities,
depending on customer-specific endpoints, or copying Staff identity data. Existing identity
resolvers hydrate known IDs or exact Auth links; they do not provide searchable, paginated
candidate discovery with consumer-neutral linkage semantics.

## Proposed Solution

Export types from the exact path
`@open-mercato/core/modules/staff/contracts/candidateResolver`, implement the read inside Staff with
exact tenant and organization scoping, and register it under the frozen Awilix key
`staffCandidateResolver`.

The contract accepts `linkage: 'required' | 'any'`, optional bounded search, and validated page
parameters. It returns a deterministic page containing only `{ staffMemberId, displayName }` plus
pagination metadata. Consumers remain responsible for authentication, RBAC, resource policy, and
soft resolution when Staff is optional.

## Overview

Candidate discovery is a read-only server contract for selectors owned by optional modules. Plane's
official SDK and MCP tooling use lightweight, paginated member endpoints with active-state and
display-name filters to keep selection flows bounded. This contract adopts the same minimal-result
and active-only principles, but retains page-number pagination because that response envelope is
already frozen by the reviewed Projects C1 prerequisite.

The resolver is deliberately distinct from all neighboring Staff surfaces:

- `staffIdentityResolver` verifies one exact active Auth/Staff link.
- `staffIdentityProjectionResolver` hydrates known Staff IDs, including inactive history.
- The proposed `staffMemberDirectory` accepts Auth user allowlists and returns scheduling metadata.
- The existing assignable-Staff HTTP route is customer-authorized and exposes Auth/team fields.
- `staffCandidateResolver` searches active Staff identities without consumer-specific policy or
  profile data.

## Architecture

### Public contract

```ts
export type StaffCandidateScope = {
  tenantId: string
  organizationId: string
}

export type StaffCandidateLinkage = 'required' | 'any'

export type StaffCandidate = {
  staffMemberId: string
  displayName: string
}

export type StaffCandidatePage = {
  items: StaffCandidate[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type StaffCandidateResolver = {
  listCandidates(input: StaffCandidateScope & {
    linkage: StaffCandidateLinkage
    search?: string
    page: number
    pageSize: number
  }): Promise<StaffCandidatePage>
}
```

The exact type-only import path is
`@open-mercato/core/modules/staff/contracts/candidateResolver`. The exact request-scoped Awilix key
is `staffCandidateResolver`. Both become stable backward-compatibility surfaces when released.

### Query semantics

The implementation validates all input before either count or data queries:

- `tenantId` and `organizationId` are UUIDs.
- `linkage` is exactly `required` or `any`.
- `search`, when supplied, is trimmed and limited to 200 characters. Empty-after-trim behaves as
  absent.
- `page` is a positive integer.
- `pageSize` is an integer from 1 through 100.

Every count and read predicate contains exact `tenantId`, exact `organizationId`,
`deletedAt: null`, and `isActive: true`. `linkage: 'required'` additionally requires a non-null
`userId`; `linkage: 'any'` adds no linkage predicate. Search is a case-insensitive escaped substring
match on the Staff-owned `displayName` field. Wildcards supplied by a caller are treated as literal
characters, not query operators.

Results sort by `displayName ASC`, then `id ASC`, before offset/limit pagination. The ID tie-breaker
makes paging deterministic when names match. A page beyond the last returns an empty `items` array
with the requested `page`; `totalPages` is `ceil(total / pageSize)` and is zero when `total` is zero.

The entity page is read through `findWithDecryption` with the same tenant/organization decryption
scope and mapped immediately to the two public fields. The count query returns no entity data and
uses the identical filter. Database and decryption failures propagate; the resolver never returns a
partial or plaintext fallback.

### Authorization and optional-module boundary

This trusted-server resolver performs no authentication, RBAC, resource-policy, or assignment
eligibility decision. Consumers must derive scope from authenticated context, authorize the target
resource before calling, and expose only candidates appropriate to their own workflow. Optional
consumers use `allowUnregistered: true` only to detect module absence; they must not swallow query or
decryption failures as absence.

The Staff module owns the query and entity import. Consumers receive plain data and must not import
`StaffTeamMember`, call customer-specific Staff routes, or persist display names as a projection.

## Data Models

No schema or encryption-map change is required. The resolver reads the existing
`StaffTeamMember.id`, `displayName`, `userId`, `isActive`, `deletedAt`, `tenantId`, and
`organizationId` fields. No ORM object crosses the contract boundary.

## API Contracts

No HTTP, OpenAPI, MCP, portal, CLI, or UI surface is added. The public surface is the type-only
contract and Staff DI service above.

Example linked-only call:

```ts
const result = await resolver.listCandidates({
  tenantId,
  organizationId,
  linkage: 'required',
  search: 'Ada',
  page: 1,
  pageSize: 25,
})
```

Only `{ staffMemberId, displayName }` items are returned. `userId`, email, team, role, description,
contact, availability, and scheduling metadata are excluded in both linkage modes.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
|---|---|
| Invalid scope, linkage, search, page, or page size | Reject before any query. |
| Empty or whitespace-only search | Apply no display-name filter. |
| Search includes `%`, `_`, or `\\` | Escape it and match the literal text. |
| No candidates | Return an empty first or requested page with `total: 0` and `totalPages: 0`. |
| Page exceeds the last page | Return empty items with accurate totals and requested page metadata. |
| Staff is inactive, deleted, or outside either scope dimension | Omit indistinguishably. |
| Linked-only mode sees an unlinked Staff row | Omit it; `any` mode may return it. |
| Equal display names | Order by Staff UUID as the deterministic tie-breaker. |
| Count, database, or decryption failure | Reject; never return a partial page. |

## Migration & Backward Compatibility

The contract, exact import path, DI key, method name, required input fields, linkage literals,
pagination envelope, and item fields are additive stable surfaces under `BACKWARD_COMPATIBILITY.md`.
Once released, incompatible change requires deprecation, a working bridge for at least one minor
release, and upgrade guidance.

If Staff is extracted, the new package becomes canonical while the core path remains a deprecated,
type-compatible bridge for the required compatibility window. Before release, rollback removes the
contract, implementation, registration, export, documentation, and tests together. No database
rollback is needed.

## Testing Strategy

Focused unit tests cover:

- exact minimal mapping, deterministic sort options, pagination metadata, and exact decryption
  scope;
- `required` versus `any` linkage predicates;
- absent, empty, case-normalized, and escaped-wildcard search behavior;
- first page, later page, zero results, beyond-last page, page size 1 and 100;
- invalid scope/linkage/search/page/pageSize rejection before both query helpers;
- inactive, deleted, and cross-scope omission through exact predicate assertions;
- count, database, and decryption error propagation;
- CLASSIC injection, one instance per request scope, distinct EntityManagers across scopes, and
  soft resolution when Staff is absent;
- compile/build resolution of the exact published type path.

No integration or browser test is required because this slice adds no executable API or UI path.
The first consumer must add its own authorized route and Staff-disabled conformance coverage.

## Risks & Impact Review

#### Cross-scope candidate disclosure
- **Scenario**: A predicate or decryption scope omits tenant or organization and exposes a Staff
  identity from another scope.
- **Severity**: High
- **Affected area**: Every optional consumer using candidate selection.
- **Mitigation**: Both scope IDs are mandatory in count criteria, read criteria, and decryption
  scope; tests assert the complete call shapes.
- **Residual risk**: Low after focused isolation tests.

#### Consumer treats discovery as authorization
- **Scenario**: A consumer exposes candidates without authorizing the target resource, or assumes a
  returned candidate may perform an action.
- **Severity**: High
- **Affected area**: Consumer APIs and private resources.
- **Mitigation**: The contract is explicitly consumer-neutral and trusted-server only; consumers
  own authentication, RBAC, and resource policy before calling.
- **Residual risk**: Medium outside Staff because consumer conformance requires separate review.

#### Linkage mode is applied incorrectly
- **Scenario**: Membership selection includes unlinked Staff or assignment unnecessarily excludes
  them.
- **Severity**: Medium
- **Affected area**: Membership and assignment selectors.
- **Mitigation**: Frozen linkage literals have exact predicates and separate tests. Consumer mapping
  remains explicit rather than inferred from route identity.
- **Residual risk**: Low.

#### Non-deterministic or unbounded picker queries
- **Scenario**: Duplicate names move between pages, or a selector loads an entire organization.
- **Severity**: Medium
- **Affected area**: Large-organization request latency and selector stability.
- **Mitigation**: Page size is capped at 100; offset/limit is mandatory; display name plus UUID is
  the deterministic sort; wildcard search is escaped.
- **Residual risk**: Offset pagination may shift under concurrent Staff edits, which is acceptable
  for a transient picker and creates no stored state.

#### Resolver failure is mistaken for module absence
- **Scenario**: A consumer catches a DB/KMS error and shows an empty candidate list.
- **Severity**: Medium
- **Affected area**: User feedback and operational diagnosis.
- **Mitigation**: Only missing DI registration is optional; execution errors propagate unchanged.
- **Residual risk**: Low when consumers follow the documented resolution pattern.

## Phasing

This is one independently deployable read-only capability. Splitting contract, implementation, and
registration would create unusable intermediate public surfaces, so they ship together in one phase.

## Acceptance Criteria

- [x] Exact type-only package path and request-scoped `staffCandidateResolver` registration exist.
- [x] Scope, linkage, search, page, and page size validate before count or data reads.
- [x] Both query paths enforce exact tenant/organization scope, active state, and non-deleted state.
- [x] `required` excludes unlinked Staff while `any` includes linked and unlinked active Staff.
- [x] Search is trimmed, bounded, case-insensitive, and treats wildcard characters literally.
- [x] Pagination is capped, deterministic, and returns accurate zero/beyond-last metadata.
- [x] Results expose only Staff UUID and display name; no ORM/Auth/profile data crosses the boundary.
- [x] Count, database, and decryption failures propagate without partial fallback.
- [x] Existing Staff entities, migrations, APIs, UI, ACLs, events, and public resolvers remain unchanged.
- [x] Focused, combined, nearby, generation, typecheck, lint, core-build, and package-build gates pass.

## Implementation Plan

### Phase A — Candidate discovery contract

1. Add the type-only public contract and exact package export.
2. Implement validated, exact-scope, linked-mode-aware paginated Staff reads and minimal mapping.
3. Register the scoped DI service and document the stable path/key and consumer-owned authorization.
4. Add focused semantic, failure, scope-isolation, DI-lifetime, and exact-import tests.
5. Run generation, focused and nearby tests, core typecheck/lint/build, repository package build, and
   source/migration drift checks.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `.ai/specs/2026-08-13-staff-candidate-resolver-public-contract.md` | Create | Design, compatibility, and validation authority. |
| `packages/core/src/modules/staff/contracts/candidateResolver.ts` | Create | Stable type-only public contract. |
| `packages/core/src/modules/staff/lib/candidateResolver.ts` | Create | Staff-owned implementation. |
| `packages/core/src/modules/staff/lib/__tests__/candidateResolver.test.ts` | Create | Focused behavioral and isolation tests. |
| `packages/core/src/modules/staff/di.ts` | Modify | Add the scoped resolver token. |
| `packages/core/src/modules/staff/__tests__/di.test.ts` | Modify | Add lifetime and CLASSIC-injection coverage. |
| `packages/core/src/modules/staff/AGENTS.md` | Modify | Document the stable contract and boundary. |
| `packages/core/package.json` | Modify | Freeze the exact public export path. |

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase A — Candidate discovery contract | Done | 2026-08-13 | Contract, resolver, scoped DI, export, documentation, and tests complete. |

### Phase A — Detailed Progress

- [x] Add the frozen type-only contract and package export.
- [x] Implement validated, bounded, exact-scope candidate discovery.
- [x] Register and document the request-scoped public DI service.
- [x] Add semantic, isolation, failure, lifetime, and exact-import tests.
- [x] Run the scoped validation and repository package-build gates.

## Final Compliance Report — 2026-08-13

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/staff/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root `AGENTS.md` | No cross-module entity imports | Compliant | Only Staff imports its entity; consumers receive plain types. |
| Root/core `AGENTS.md` | Exact tenant and organization scope | Compliant | Both IDs appear in count, read, and decryption scope. |
| Core `AGENTS.md` | Encrypted reads use framework helpers | Compliant | Candidate entities are read with `findWithDecryption`; no custom crypto. |
| Staff `AGENTS.md` | New cross-module Staff data uses a narrow DI service | Compliant | One candidate-only resolver is added and documented. |
| `BACKWARD_COMPATIBILITY.md` | Public paths and DI names remain stable | Compliant | Exact additive path/key and extraction bridge are defined. |
| Code-review checklist | Validate inputs and bound growing lists | Compliant | Full pre-query validation, 100-item cap, and deterministic paging. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data fields match public contract | Pass | Existing Staff fields map to two output fields. |
| API contracts match UI/UX | N/A | No HTTP or UI surface is added. |
| Risks cover all writes | N/A | Resolver is read-only. |
| Commands defined for mutations | N/A | No mutation exists. |
| Cache strategy covers reads | Pass | No cache; bounded current Staff data is read directly. |
| Module-absence behavior is defined | Pass | Consumers soft-resolve registration only; execution failures propagate. |
| Backward compatibility is explicit | Pass | Additive stable surfaces and extraction bridge are documented. |

### Non-Compliant Items

None.

### Verdict

Fully compliant and ready for implementation. The independent fresh-context scope-cohesion review
reported no Critical, High, Medium, or Low findings: linkage modes are cohesive query variants, and
identity verification, known-ID projection, Auth-user scheduling lookup, customer-authorized HTTP,
and consumer policy remain separate capabilities.

### Implementation Validation

- Final candidate resolver and Staff DI gate: 2 suites, 23 tests passed.
- Combined identity, projection, candidate, and Staff DI gate: 4 suites, 50 tests passed.
- Nearby Planner, Staff, and Customers regressions: 5 suites, 17 tests passed.
- `yarn generate` passed and reported generated outputs unchanged.
- Core typecheck and changed-file ESLint passed; ESLint emitted only the existing Next pages
  directory warning.
- Core build passed with 3,946 core and 204 generated entry points.
- `yarn build:packages` passed all 22 package tasks.
- The exact built contract subpath resolves; runtime exports are intentionally empty because the
  module is type-only.
- No entity or migration file changed.

The wider repository baselines already recorded by the related identity-resolver implementation
remain unrelated Windows/environment failures (path casing/absolute-path expectations, POSIX
permission assertions, and environment-state assumptions). They are outside this resolver's change
surface and are not hidden or suppressed here.

## References

- [Plane Python SDK — lightweight paginated workspace/project members](https://github.com/makeplane/plane-python-sdk)
- [Plane MCP Server — member filters and lightweight pagination](https://github.com/makeplane/plane-mcp-server/releases)
- [Staff decoupling specification](implemented/2026-05-08-staff-decouple-from-core.md)
- [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md)

## Changelog

- 2026-08-13 — Created the skeleton from the reviewed Task & Project Management C1 prerequisite.
- 2026-08-13 — Added market comparison, frozen contract, exact query semantics, failure behavior,
  compatibility rules, risks, tests, implementation plan, and compliance review.
- 2026-08-13 — Passed independent fresh-context scope-cohesion review with no findings; marked ready
  for implementation.
- 2026-08-13 — Implemented the contract, candidate query, scoped DI registration, package export,
  documentation, and focused regression coverage; all scoped and package-build gates passed.
