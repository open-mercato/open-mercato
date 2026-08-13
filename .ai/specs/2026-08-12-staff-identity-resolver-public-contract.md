# Staff Auth Identity Link Resolver Public Contract

| Field | Value |
|---|---|
| **Status** | Implemented - Full Core Gate Has Baseline Failures |
| **Created** | 2026-08-12 |
| **Target** | Current core `staff` module |
| **Related** | `2026-07-15-staff-member-directory.md`, `implemented/2026-05-08-staff-decouple-from-core.md` |

## TLDR

Add one stable, Staff-owned, read-only `staffIdentityResolver` DI service. It resolves the current active Auth↔Staff link from either a known Auth user UUID or Staff member UUID, enforces exact tenant and organization scope, reports duplicate Auth linkage as `ambiguous`, and exposes no Staff entity.

There is no entity, migration, API, UI, ACL, event, cache, worker, dependency, or downstream-consumer change.

## Overview

Staff entities and helpers are intentionally internal because Staff is optional and planned for package extraction. A server-side optional module nevertheless needs a safe way to validate a current Staff identity or map a known authenticated user to Staff without importing `StaffTeamMember`, trusting client linkage, or reusing a workflow-specific HTTP endpoint.

The existing `availabilityAccessResolver` answers planner authorization. The proposed `staffMemberDirectory` batch-maps authorized user IDs to scheduling references and deliberately preserves duplicates. Neither supplies this contract's bidirectional exact current-link semantics or explicit ambiguity result, so this resolver is a separate narrow public surface.

## Problem Statement

`StaffTeamMember.userId` is nullable and not unique. A direct lookup that silently chooses one active row can make authorization depend on database ordering. A safe integration contract must therefore:

- require explicit tenant and organization scope;
- consider only active, non-deleted rows;
- use Staff-owned encryption-aware reads;
- return ambiguity instead of choosing duplicate Auth linkage;
- expose only the minimum identity projection;
- keep database entities and consumer policy private to their owners.

## Proposed Solution

Create the exact public type path `@open-mercato/core/modules/staff/contracts/identityResolver`, implement it in the Staff module, and register a request-scoped resolver under the frozen Awilix key `staffIdentityResolver`.

Trusted server consumers own Auth/RBAC/resource policy and must soft-resolve the service if Staff remains optional. The service validates all UUID inputs before querying and propagates database or decryption failures without plaintext or partial fallback.

## Architecture

### Public Contract

```ts
export type StaffIdentityScope = {
  tenantId: string
  organizationId: string
}

export type StaffIdentity = {
  staffMemberId: string
  userId: string | null
  displayName: string
  isActive: boolean
}

export type StaffIdentityLookupResult =
  | { kind: 'found'; identity: StaffIdentity }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' }

export type StaffIdentityResolver = {
  resolveByUserId(scope: StaffIdentityScope, userId: string): Promise<StaffIdentityLookupResult>
  resolveByStaffMemberId(scope: StaffIdentityScope, staffMemberId: string): Promise<StaffIdentityLookupResult>
}
```

### Lookup Semantics

- All scope and identity values must be non-empty UUIDs and reject before a query otherwise.
- `resolveByUserId` queries active, non-deleted Staff in the exact scope with a limit of two: zero results return `not_found`, one returns `found`, and two return `ambiguous` without exposing duplicate IDs.
- `resolveByStaffMemberId` queries one active, non-deleted row by exact Staff ID and exact scope. It returns only `found` or `not_found`; `ambiguous` is reserved for Auth lookup.
- Returned identity contains only `staffMemberId`, nullable `userId`, decrypted `displayName`, and `isActive`.
- Cross-scope, inactive, and deleted records are indistinguishable from absence.
- No result is cached across requests.

### DI and Module Absence

Staff registers the implementation with `.scoped()` so the current request container supplies its `EntityManager`. Existing `availabilityAccessResolver` registration and behavior remain unchanged. Optional consumers must resolve `staffIdentityResolver` with `allowUnregistered: true` or an equivalent local `tryResolve` helper and own their fallback behavior.

## Data Models

No data-model or migration change is authorized. The implementation reads the existing `StaffTeamMember` fields `id`, `tenantId`, `organizationId`, `userId`, `displayName`, `isActive`, and `deletedAt` through `findWithDecryption` / `findOneWithDecryption`, repeating tenant and organization scope in both the ORM predicate and decryption scope.

## API Contracts

No HTTP, OpenAPI, MCP, or portal API is added. This is a trusted server-side DI contract only. A consumer exposing any result through an API remains responsible for route metadata, authentication, RBAC, validation, and resource authorization.

## UI/UX and Internationalization

N/A. No user-facing surface or copy changes.

## Migration & Backward Compatibility

The change is additive: no existing DI key, exported type, import path, route, event, ACL feature, or schema changes. Once released, `staffIdentityResolver`, the exact contract import path, all required method/property names, and result discriminants are stable under `BACKWARD_COMPATIBILITY.md`. Incompatible evolution requires deprecation, a working bridge for at least one minor release, and upgrade guidance.

If Staff is later extracted, the new package becomes canonical while this core import path remains as a deprecated type-compatible bridge for the required compatibility window. The DI token and semantics remain unchanged.

Before release, rollback removes the additive implementation, registration, export, documentation, and tests together. After release, rollback must retain or deprecate the public surface.

## Implementation Plan

### Phase 1 — Complete Contract

1. Add the public contract file and Staff-owned implementation.
2. Register `staffIdentityResolver` as request-scoped without changing existing registrations.
3. Document the token, import path, authorization boundary, and extraction bridge in Staff's `AGENTS.md`.
4. Add service tests for validation, both lookup directions, active/inactive/deleted behavior, exact scope, ambiguity, minimal projection, nullable linkage, and failure propagation.
5. Extend DI tests for registration, scoped lifetime, request-scope isolation, CLASSIC-compatible injection, and missing-registration behavior.

### Phase 2 — Validation

1. Run generation and verify no entity or migration diff.
2. Run focused Staff tests and package build/typecheck.
3. Run the repository validation gate and review every changed public surface against `BACKWARD_COMPATIBILITY.md`.

## Testing Strategy

Focused tests mock the encryption-aware helpers and assert the complete predicate, query options, decryption scope, output projection, and failure behavior. DI tests use real Awilix scopes with distinct `em` values. No fabricated HTTP or browser integration test is needed because no executable API or UI path changes; the first consumer must add its own staff-disabled integration coverage.

## Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Cross-tenant or cross-organization disclosure | High | Both identifiers are mandatory in the ORM predicate and decryption scope; tests assert the full call. |
| Duplicate active links lead to nondeterministic authorization | High | Query at most two and return `ambiguous`; never choose or expose duplicate rows. |
| Consumer treats DI lookup as authorization | Medium | Public documentation states that consumers own Auth/RBAC/resource policy. |
| Public contract is stranded during Staff extraction | Medium | Preserve the token and provide a type-compatible core import bridge under the deprecation protocol. |
| DB/KMS failure is mistaken for absence | Medium | Only an actual empty query returns `not_found`; execution failures propagate. |

## Acceptance Criteria

- [x] `staffIdentityResolver` is request-scoped and the exact public contract path resolves without exporting entities.
- [x] Every query enforces exact tenant/organization scope in both predicate and decryption scope.
- [x] Auth lookup returns `found | not_found | ambiguous` and never chooses duplicate active linkage.
- [x] Staff-ID lookup returns `found | not_found` for active, non-deleted exact-scope Staff.
- [x] Invalid UUIDs reject before query and DB/KMS failures propagate.
- [x] Results contain only Staff UUID, nullable Auth UUID, display name, and active state.
- [x] Existing Staff entities, routes, ACLs, events, and `availabilityAccessResolver` remain unchanged.
- [x] Tests cover the complete semantic and DI contract.
- [ ] Full validation passes with no entity, migration, API, or UI change. Feature-specific tests and the build, generation, i18n, typecheck, app-build, template-parity, and Docs gates pass with no entity, migration, API, UI, or generated diff. The configured repository test gate remains red from unrelated baseline failures recorded below. Focused tests are supporting evidence, not a substitute for that gate.

## Final Compliance Report

| Rule source | Result |
|---|---|
| Root and core `AGENTS.md` | Compliant: Staff owns the narrow DI port; consumers remain soft-optional. |
| Staff `AGENTS.md` | Compliant: entities remain internal and the new surface is documented as stable. |
| `BACKWARD_COMPATIBILITY.md` | Compliant: all contract additions are additive and future evolution is governed explicitly. |
| `.ai/specs/AGENTS.md` | Compliant: filename, required sections, boundaries, risks, and implementation plan are present. |

## Changelog

- 2026-08-12 - Initial reviewed specification imported from the downstream Task & Project Management design and reconciled with current upstream Staff contracts.
- 2026-08-13 - Implemented the exact contract, encryption-aware Staff resolver, scoped DI registration, stable package export, documentation, and focused tests on `feat/staff-identity-resolver`.
- 2026-08-13 - Revalidated on the current `origin/develop` baseline, recorded the successful bounded gates, and marked the terminated repository-wide test gate as pending instead of carrying forward historical baseline results.
- 2026-08-13 - Completed the Core Jest suite as eight deterministic serial shards: 1,224 suites and 9,524 tests passed; eight unrelated tests failed in three baseline suites.
- 2026-08-13 - Completed the remaining workspace audit serially. Docs passed with process-scoped Git ownership configuration; unrelated Windows/environment/harness baselines remain in CLI, Shared, and create-app.

## Implementation Status

| Phase | Status | Evidence |
|---|---|---|
| Public contract and implementation | Done | Exact type-only package path, Staff-owned resolver, and additive request-scoped `staffIdentityResolver` registration added. |
| Focused resolver and DI tests | Pass | 2 suites, 18 tests. |
| Planner regressions | Pass | 2 suites, 7 tests. |
| Staff assignable and Customer compatibility regressions | Pass | 3 suites, 10 tests. |
| Repository typecheck | Pass | `yarn typecheck`: 22/22 tasks successful when run separately from other resource-heavy gates. |
| Changed-file lint | Pass | Five changed Staff TypeScript files; only the repository's existing Next.js pages-directory warning was emitted. |
| Package build | Pass | Both configured `yarn build:packages` passes completed with 22/22 tasks successful, including core and CLI. |
| Generation | Pass | Configured `yarn generate` completed successfully; no tracked generated diff. |
| i18n validation | Pass | `yarn i18n:check-sync` and `yarn i18n:check-usage` completed successfully; unused-key output remains advisory. |
| Application build | Pass | `yarn build:app` completed successfully; existing queue dynamic-filesystem tracing warnings remain non-fatal. |
| Template parity | Pass | `yarn template:sync` reported source, root-file, and dependency parity. |
| Exact built import | Pass | Node resolved `@open-mercato/core/modules/staff/contracts/identityResolver`; the type-only module correctly has no runtime exports. |
| Complete Core Jest suite | Baseline failures | Eight deterministic serial shards completed: 1,224/1,227 suites and 9,524/9,532 tests passed. Four compact-number assertions fail in `customers/components/__tests__/DealsKpiStrip.test.tsx` and `dashboards/lib/__tests__/formatters.test.ts` because this runtime returns lowercase `k`/`m`; four Windows path assertions fail in `attachments/lib/drivers/__tests__/localDriver.test.ts` because the runtime resolves `/storage/...` to `E:\storage\...`. No changed Staff identity test failed. |
| Remaining workspace Jest suites | Baseline failures | Serialized Turbo runs found two Windows-specific CLI assertions (POSIX `0600` mode comparison in `deploy/railway/__tests__/token.test.ts` and a forward-slash suffix assertion in `deploy/railway/__tests__/state.test.ts`), one Shared environment-state assertion in `lib/encryption/__tests__/likeFilterWarning.test.ts` (172 suites and 1,834 tests passed), and Windows harness failures in `create-mercato-app` including direct `yarn.cmd` spawn `EINVAL`, slash-sensitive output assertions, and Codex app-server fixtures. With Core, CLI, Shared, Docs, and create-app classified separately, the remaining non-Core/CLI/Shared/Docs workspace plan completed 24/25 tasks; only create-app failed. |
| Docs test | Pass | `open-mercato-docs` production build and search-index test passed after supplying process-scoped Git `safe.directory`; an existing broken-anchor warning for `/installation/wsl2` remains advisory. |

No entity file changed, so no migration was generated or applied.
