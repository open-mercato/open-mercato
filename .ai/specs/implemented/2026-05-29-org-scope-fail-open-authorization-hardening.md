# Organization-Scope Fail-Open Authorization Hardening

## TLDR
**Key Points:**
- Close a fail-open authorization gap (OWASP A01 — Broken Access Control) where organization-scope checks are **skipped** instead of **denied** when a restricted (non-super-admin) user has no resolvable current organization. Covers the write/command path (#2239) and the read/detail path (#2245), plus every other copy of the same guard surfaced by a full audit.
- Single root cause — *empty allowed-org set ⇒ no check* — fixed once via shared, fail-closed authorization helpers that all call sites consume.

**Scope:**
- Rewrite `ensureOrganizationScope` (`packages/shared/src/lib/commands/scope.ts`) to fail closed using the correct restricted-vs-unrestricted signal (`allowedIds === null` ⇒ unrestricted).
- Add a shared read-path guard (`isOrganizationReadAccessAllowed`) in `packages/core/src/modules/directory` and route all single-record detail guards through it.
- Migrate all 10 audited fail-open detail-route guards (customers) + the shared `entity-roles-factory` guard to the new helper.
- Unit tests in `packages/shared` and `packages/core` proving cross-org read/write within a tenant is denied; integration coverage for affected API paths.

**Concerns:**
- Tightens create/update/read authorization for "floating" restricted users (`auth.orgId = null` + concrete `allowedIds`) — a deliberate behavior change. Must not break legitimate scoped flows; covered by regression tests (Q3 = ship fail-closed immediately).
- Behavior change touches ~30 command call sites indirectly (all benefit from the centralized fix). Requires broad test verification.

---

## Overview
Open Mercato authorizes scoped entities by organization within a tenant. Two distinct guard families enforce this:

- **Read path** — `makeCrudRoute`/query engine constrains list queries to `organizationIds` derived from `OrganizationScope`. Single-record detail routes use bespoke inline guards.
- **Write path** — domain commands call `ensureTenantScope` + `ensureOrganizationScope` after loading the target record.

Both families share a latent fail-open defect: they treat an **empty allowed-org set as "no restriction"** and skip the check, instead of treating it as **deny**. This spec makes both paths fail closed, centralizes the decision into shared helpers, and migrates every audited call site.

> **Market Reference**: This mirrors the canonical "default deny" / "fail-safe defaults" principle (Saltzer & Schroeder; OWASP ASVS V4 Access Control). The fix follows the same pattern enforced by mature multi-tenant frameworks (e.g. Django's object-level permission checks, Rails Pundit's `verify_authorized`) where the *absence* of an authorizing scope is a denial, never a bypass.

## Problem Statement
The distinguishing signal already exists on `OrganizationScope`:
- `allowedIds === null` → **truly unrestricted** (super-admin or global access). This is the *only* legitimate bypass signal.
- `allowedIds` as an array (including `[]`) → **restricted**; non-membership (or empty set) must deny.

Current code incorrectly uses derived proxies (`filterIds?.length`, `currentOrg`, `allowedOrgIds.size`) to decide *whether to check at all*, conflating "unrestricted" with "no resolvable org".

### Attack precondition (both paths)
A restricted, non-super-admin user whose home org resolves to `null` (`user.organizationId IS NULL` ⇒ `auth.orgId = null`), but whose ACL restricts them to a concrete org list. The list/read path hides other orgs' rows correctly (query is constrained to `organizationIds`), but the single-record guards and the command-path guard skip the check, allowing read/update/soft-delete of records in **another organization of the same tenant**. Cross-tenant remains blocked by `ensureTenantScope`, bounding severity to within-tenant (Medium write / Low read).

### Write path (#2239)
`packages/shared/src/lib/commands/scope.ts:91-102` — `ensureOrganizationScope` early-returns when `currentOrg` (`selectedOrganizationId ?? auth.orgId`) is null, never consulting the non-null restricted `allowedIds`.

### Read path (#2245) + audit findings
The fail-open guard `if (allowedOrgIds.size [> 0] && !allowedOrgIds.has(record.org)) deny` appears in **10 sites** (issue named 4; full audit found 10):

| # | File | Line |
|---|------|------|
| 1 | `customers/api/people/[id]/companies/context.ts` | 44 |
| 2 | `customers/api/companies/[id]/route.ts` | 393 |
| 3 | `customers/api/companies/[id]/people/route.ts` | 121 |
| 4 | `customers/api/deals/[id]/route.ts` | 388 |
| 5 | `customers/api/deals/[id]/stats/route.ts` | 108 |
| 6 | `customers/api/deals/[id]/people/route.ts` | 103 |
| 7 | `customers/api/deals/[id]/companies/route.ts` | 103 |
| 8 | `customers/api/people/[id]/route.ts` | 481 |
| 9 | `customers/api/people/[id]/companies/enriched/route.ts` | 180 |
| 10 | `customers/api/entity-roles-factory.ts` (`ensureRouteOrganizationAccess`/`collectAllowedOrganizationIds`) | 88-92 |

**Reference (already correct):** `customers/api/people/check-phone/route.ts:39-56` builds the allowed set, then `if (allowedOrgIds.size === 0) return …` (fail closed) before applying `$in`. The fix generalizes this behavior.

**Out of scope (verified safe):** the ~30 `organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null)` list-query sites are a *different* mechanism. An empty `filterIds` array is not nullish, so `??` does not fall through; `organizationIds = []` constrains the query to nothing (fail-closed). The catalog variant `scope?.filterIds ?? scope?.allowedIds ?? …` behaves identically. These are not changed.

## Proposed Solution

Two fail-closed helpers, one per path, sharing a single primitive decision function.

### 1. Primitive decision (shared, type-decoupled)
A pure predicate decoupled from `OrganizationScope`/core types so it can live in `@open-mercato/shared`:

```typescript
// packages/shared/src/lib/auth/organizationAccess.ts
export function isOrganizationAccessAllowed(args: {
  isSuperAdmin: boolean
  allowedOrganizationIds: readonly string[] | null  // null = unrestricted
  targetOrganizationId: string | null
}): boolean {
  if (args.isSuperAdmin) return true
  if (args.allowedOrganizationIds === null) return true   // truly unrestricted
  if (!args.targetOrganizationId) return false            // restricted + no target ⇒ deny
  return args.allowedOrganizationIds.includes(args.targetOrganizationId)
}
```

Rule: **bypass only for `isSuperAdmin` or `allowedOrganizationIds === null`.** Any array (including empty) is restricted ⇒ membership required ⇒ otherwise deny.

### 2. Write path — `ensureOrganizationScope` (shared)
Reimplement on top of the predicate:
- Bypass for `auth.isSuperAdmin === true` or `organizationScope.allowedIds === null`.
- When `organizationScope.allowedIds` is an array, require membership of `organizationId`; otherwise `throw new CrudHttpError(403)` and log via the existing `logScopeViolation`.
- **Backward-compat guard (Pattern C contract — load-bearing, do NOT remove):** when `ctx.organizationScope` is entirely absent (`null`/`undefined`), preserve the legacy `currentOrg` fallback (`selectedOrganizationId ?? auth.orgId`); deny only when `currentOrg` is non-null and differs from `organizationId`. The new restricted-`allowedIds` deny applies **only when `organizationScope` is present**.

  > ⚠️ This branch is depended on by ~40 command call sites that construct the command context with `organizationScope: null` and a hand-derived `selectedOrganizationId` (referred to here as "Pattern C"). Most are system/worker/non-user contexts with no restriction to enforce: `checkout` (payment subscribers, `transaction-expiry` worker, `pay/.../submit`), `scheduler` (`execute-schedule.worker`, `localSchedulerService`), `messages` (route + commands), `inbox_ops`, `notifications` (`notificationService`), `workflows` (`activity-executor`), `feature_toggles/cli.ts`, `enterprise/security` (`sudo`/`users`/`mfa`/`profile`/`enforcement` shared), `auth/api/profile/route.ts`, plus the user-facing `customers/api/people/[id]/companies[/[linkId]]/route.ts` and `sales/api/quotes/accept/route.ts`. **Switching absent-scope to deny would break payment and scheduled-command flows.** A unit test MUST assert `organizationScope == null` ⇒ legacy `currentOrg` behavior (not deny).

#### Closure scope of the write-path fix (#2239)
The central fix fully closes the cross-org write hole for command paths whose context carries a real `OrganizationScope`:
- **Pattern A** — CRUD-factory routes (`makeCrudRoute`), where `factory.ts` populates `organizationScope` from `resolveOrganizationScopeForRequest`. **This covers the #2239 named example** (customers people update/delete via `customers/api/people/route.ts`).
- **Pattern B** — custom routes that explicitly call `resolveOrganizationScopeForRequest` and pass the result as `organizationScope`.

For **Pattern C** user-facing routes (above), hole-closure continues to rely on the route's existing `selectedOrganizationId` guard (these routes already `return` early when `selectedOrganizationId` is null and scope the command to `organizationIds: [selectedOrganizationId]`, and run the Phase 2 read guard first). Migrating those routes to populate a real `organizationScope` is tracked as a follow-up (see Follow-up issues below), not part of this change.

### 3. Read path — `isOrganizationReadAccessAllowed` (core/directory)
Lives next to `OrganizationScope` (core type + `AuthContext`). **Implemented as a boolean predicate, not a throwing helper** — the 10 call sites use two different deny mechanisms (5 `throw new CrudHttpError(403)`, 4 `return forbidden(...)`), and several return a `Response` rather than throwing. A predicate centralizes the fail-closed *decision* while each call site keeps its exact deny response and i18n key, and avoids leaking a `customers.*` i18n key into the `directory` module:

```typescript
// packages/core/src/modules/directory/utils/organizationScopeGuard.ts
export function isOrganizationReadAccessAllowed(input: {
  scope: OrganizationScope | null | undefined
  auth: AuthContext
  organizationId: string | null
}): boolean
```

Call sites become `if (!isOrganizationReadAccessAllowed({ scope, auth, organizationId: record.organizationId })) <existing deny>`.

Behavior preserves the existing "allowed set" derivation (`filterIds` else `auth.orgId`) — `filterIds` still narrows the active view — but flips the empty-set case to **deny** when the user is restricted:
- `auth.isSuperAdmin` or `scope?.allowedIds === null` ⇒ allow.
- Else derive allowed set; if empty ⇒ deny (we *know* it is restricted because `allowedIds` is a non-null array).
- Else require `organizationId ∈ set`.

### 4. Migration
- Replace all 10 inline guards with `isOrganizationReadAccessAllowed(...)`.
- Refactor `entity-roles-factory.ts` `collectAllowedOrganizationIds`/`ensureRouteOrganizationAccess` to delegate to the shared guard (keeps the entity-role routes consistent).

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Predicate takes primitives, not `OrganizationScope` | Keeps the core decision in `@open-mercato/shared` without importing core/domain types (shared has zero domain deps). |
| Two helpers (write in shared, read in core/directory) | Read guard needs `OrganizationScope` + `AuthContext` (core); write guard already lives in shared. Both call the same primitive predicate, so the *security rule* has one source of truth. |
| Keep `filterIds`-based view narrowing in read guard | Preserves existing UX (selected-org narrows visible records); only the fail-open empty-set branch changes. Avoids unintended behavior change beyond the security fix. |
| Legacy `currentOrg` fallback only when `organizationScope` is absent | Prevents over-denial for contexts that legitimately carry no scope; restricted scopes always populate `allowedIds`. |
| Defer WHERE-clause record-load scoping (Q2-b) | Guard fix alone closes the vulnerability. SQL-level scoping of single-record loads + `findOneWithDecryption` contract changes is a larger hardening pass tracked as a follow-up. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Fix only the 4 sites named in #2245 | Audit found 10 fail-open guards + the shared factory; fixing 4 leaves identical holes (Q1-b). |
| Single mega-helper imported by both paths from core | `@open-mercato/shared` must not import core/domain types; the command guard lives in shared. Split predicate + two thin wrappers instead. |
| Feature-flag the tightening | Q3-a — ship fail-closed immediately; it is a security fix. Tests guard legitimate flows. |

## User Stories / Use Cases
- **A restricted operator with no home org** must **not** be able to open, edit, or delete a record in another org of their tenant — the API returns `403`.
- **A super-admin** continues to operate across all orgs unchanged.
- **A normal scoped user** whose `allowedIds` contains the record's org continues to read/write that record unchanged.
- **A platform engineer** maintaining new detail routes has one shared guard to call, eliminating copy-paste fail-open guards.

## Architecture

No new entities, events, or DB schema. The change is confined to authorization helpers and their call sites.

```
ensureOrganizationScope (shared)  ─┐
                                    ├─→ isOrganizationAccessAllowed (shared, pure predicate)
isOrganizationReadAccessAllowed (core)─┘
```

- Write path: `command.execute` → `ensureTenantScope` → `ensureOrganizationScope` → predicate.
- Read path: detail route → load record → `isOrganizationReadAccessAllowed` → predicate.

### Commands & Events
None. No new commands or events; existing command guards gain correct fail-closed behavior transparently.

## Data Models
No changes. `OrganizationScope` (`{ selectedId, filterIds, allowedIds, tenantId }`) is consumed as-is; `allowedIds === null` is the authoritative unrestricted signal.

## API Contracts
No contract shape changes. Behavioral change only:

| Endpoint family | Before | After |
|-----------------|--------|-------|
| Customers detail GET routes (people/companies/deals + sub-resources, entity-roles) | Restricted user w/ empty allowed set could read cross-org record (`200`) | Returns `403 { error: 'Access denied' }` |
| Domain command update/delete (customers, sales, catalog via `ensureOrganizationScope`) | Restricted user w/ `currentOrg=null` could write cross-org record | `403 { error: 'Forbidden' }` |

Error envelopes reuse existing `CrudHttpError(403)` shapes and i18n keys (`customers.errors.access_denied`). No new keys required.

## Internationalization (i18n)
- Reuses existing `customers.errors.access_denied`. No new keys.
- Internal `throw new CrudHttpError(403, { error: 'Forbidden' })` in shared scope helper is a contract-level denial; keep as-is (matches existing code, not a user-facing translatable surface in `@open-mercato/shared`).

## UI/UX
No UI changes. Affected detail pages already surface `403` via existing `ErrorMessage`/flash handling.

## Configuration
None. (Q3-a: no feature flag; ship fail-closed.)

## Migration & Compatibility
- No DB migration.
- **Behavioral breaking change** for the narrow precondition (restricted user, `auth.orgId = null`). This is the intended security fix. Documented in `RELEASE_NOTES.md` under a "Security" entry referencing #2239 and #2245.
- Contract-surface review (`BACKWARD_COMPATIBILITY.md`): `ensureOrganizationScope` signature is unchanged (STABLE). Behavior tightens — this is an allowed security hardening, not an API break. The two new helpers are additive.

### Follow-up issues (out of scope for this change)
1. **Pattern C user-route scope population** — migrate `customers/api/people/[id]/companies[/[linkId]]/route.ts` and `sales/api/quotes/accept/route.ts` (and any other user-facing Pattern C command routes) to populate a real `organizationScope` from `resolveOrganizationScopeForRequest`, so they too benefit from the `allowedIds` check rather than relying solely on `selectedOrganizationId`.
2. **Defense-in-depth WHERE-clause scoping (Q2-b, deferred)** — scope single-record command/detail loads (`em.findOne({ id })`, `findOneWithDecryption`) by `tenantId` (and ideally the allowed-org set) in the SQL `WHERE` so cross-org rows are never selected/decrypted before the guard runs.
3. **Re-audit `packages/enterprise/**` and provider packages** for the same `size && !has` fail-open guard once the shared helpers exist.

## Implementation Plan

### Phase 1: Shared predicate + write-path fix (#2239)
1. Add `packages/shared/src/lib/auth/organizationAccess.ts` with `isOrganizationAccessAllowed`.
2. Rewrite `ensureOrganizationScope` in `packages/shared/src/lib/commands/scope.ts` to use the predicate; preserve legacy fallback only when `organizationScope` is absent; keep `logScopeViolation`.
3. Unit tests (`packages/shared/src/lib/commands/__tests__/scope.test.ts` + new predicate test) — MUST include all of:
   - `currentOrg=null` + `allowedIds=[orgA]` + `record.org=orgB` ⇒ **403** (the #2239 fix).
   - `allowedIds=null` ⇒ allow (unrestricted); `auth.isSuperAdmin` ⇒ allow.
   - `allowedIds=[orgA]` + `record.org=orgA` ⇒ allow (**allow-path regression** — must not over-deny).
   - `organizationScope=null` ⇒ **legacy `currentOrg` behavior, NOT deny** (Pattern C contract — guards the High-risk over-denial trap).

### Phase 2: Read-path guard + migration (#2245 + audit)
1. Add `packages/core/src/modules/directory/utils/organizationScopeGuard.ts` exporting `isOrganizationReadAccessAllowed`.
2. Migrate the 10 detail-route guards to call it.
3. Refactor `entity-roles-factory.ts` to delegate to the shared guard.
4. Unit test for `isOrganizationReadAccessAllowed` (mirrors predicate cases, incl. empty-set ⇒ deny).

### Phase 3: Integration coverage + verification
1. Integration tests (self-contained fixtures per `.ai/qa/AGENTS.md`):
   - **Deny**: restricted floating user (`auth.orgId=null`, `allowedIds=[orgA]`) denied 403 on representative read (deal GET) and write (person update/delete — Pattern A CRUD-factory path).
   - **Allow-path regression** (per `.ai/lessons.md` "preserve exact RBAC inclusion semantics"): scoped user with matching org succeeds; super-admin succeeds.
   - **Pattern C unaffected**: a Pattern C path (e.g. `sales.quotes.convert_to_order` via `/api/sales/quotes/accept`) continues to work for a valid in-scope user — proves the absent-scope legacy fallback was not broken.
2. Run validation gate: `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/core test`, `yarn typecheck`, `yarn lint`, targeted integration suite.
3. Document the behavioral security change (this spec's Migration & Compatibility section). `RELEASE_NOTES.md` does not exist in this repo; `CHANGELOG.md` is generated at release time by `om-auto-update-changelog` (PR-numbered, house format) — do not hand-edit mid-cycle.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/auth/organizationAccess.ts` | Create | Pure fail-closed predicate |
| `packages/shared/src/lib/commands/scope.ts` | Modify | Rewrite `ensureOrganizationScope` |
| `packages/core/src/modules/directory/utils/organizationScopeGuard.ts` | Create | `isOrganizationReadAccessAllowed` |
| `customers/api/people/[id]/companies/context.ts` | Modify | Use shared guard |
| `customers/api/companies/[id]/route.ts` | Modify | Use shared guard |
| `customers/api/companies/[id]/people/route.ts` | Modify | Use shared guard |
| `customers/api/deals/[id]/route.ts` | Modify | Use shared guard |
| `customers/api/deals/[id]/stats/route.ts` | Modify | Use shared guard |
| `customers/api/deals/[id]/people/route.ts` | Modify | Use shared guard |
| `customers/api/deals/[id]/companies/route.ts` | Modify | Use shared guard |
| `customers/api/people/[id]/route.ts` | Modify | Use shared guard |
| `customers/api/people/[id]/companies/enriched/route.ts` | Modify | Use shared guard |
| `customers/api/entity-roles-factory.ts` | Modify | Delegate to shared guard |
| `packages/shared/.../__tests__/scope.test.ts` | Modify | Fail-closed unit cases |
| `packages/core/src/modules/directory/utils/__tests__/organizationScopeGuard.test.ts` | Create | Read-guard unit cases |

### Testing Strategy
- **Unit**: predicate truth table; `ensureOrganizationScope` (write) and `isOrganizationReadAccessAllowed` (read) across {superadmin, unrestricted, restricted-match, restricted-mismatch, empty-set, absent-scope}.
- **Integration**: floating restricted user (`auth.orgId=null`, `allowedIds=[orgA]`) denied 403 on cross-org read + write; allowed on in-scope org; super-admin allowed. Fixtures created/cleaned in setup/teardown.

## Risks & Impact Review

### Data Integrity Failures
- Pure authorization predicate; no writes, no partial state. No transaction concerns.

### Cascading Failures & Side Effects
- ~30 command call sites use `ensureOrganizationScope` transitively. Risk: over-denial breaking a legitimate flow. Mitigated by: legacy fallback when scope absent, broad unit + integration coverage, and `allowedIds` being correctly populated for restricted users by `resolveOrganizationScopeForRequest`.
- No events emitted; no subscriber impact.

### Tenant & Data Isolation Risks
- This change *strengthens* the org-isolation boundary within a tenant. Cross-tenant was already blocked by `ensureTenantScope`. No shared mutable resource introduced.

### Migration & Deployment Risks
- No DB migration; deployable without downtime. No backfill. Behavioral tightening only.

### Operational Risks
- Existing `logScopeViolation` (`console.warn`) provides detection of denials post-deploy; an unexpected spike flags a legitimate flow regressed. Blast radius bounded to the audited guard sites.

### Risk Register

#### Over-denial of a legitimate floating-but-scoped flow
- **Scenario**: A real user with `auth.orgId=null` but valid `allowedIds` containing the record's org is wrongly denied because a call site passes the wrong `organizationId` or scope is mis-derived.
- **Severity**: Medium
- **Affected area**: Customers detail routes; all command update/delete paths.
- **Mitigation**: Predicate allows when `organizationId ∈ allowedIds`; integration test asserts the in-scope case returns 200/success. Legacy fallback covers truly scope-less contexts.
- **Residual risk**: A call site that passes a wrong org id would deny — acceptable (fails safe, surfaces as 403 in tests).

#### Unaudited fail-open copy outside customers
- **Scenario**: A guard with the same pattern exists in a module not covered by the grep audit.
- **Severity**: Low
- **Affected area**: Unknown modules.
- **Mitigation**: Audit covered `packages/**`, `apps/**`; the only fail-open `size && !has` deny guards found were the 10 listed. Predicate + helpers make future fixes a one-line call.
- **Residual risk**: Low; follow-up WHERE-scoping spec (Q2 deferred) will re-audit single-record loads.

## Final Compliance Report — 2026-05-29

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md` (contract-surface check)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Always filter by `organization_id`; never expose cross-tenant/cross-org data | Compliant | This is the fix's purpose |
| root AGENTS.md | Never bypass mutation guards / RBAC wildcard matching | Compliant | Strengthens existing guards |
| packages/shared/AGENTS.md | No imports from `@open-mercato/core`/domain | Compliant | Predicate takes primitives; read guard lives in core |
| packages/shared/AGENTS.md | Precise types, no `any` | Compliant | Predicate uses explicit types |
| packages/core/AGENTS.md | Writes via Command pattern; guards via shared helpers | Compliant | No new write paths; guards centralized |
| BACKWARD_COMPATIBILITY.md | Signature surfaces FROZEN/STABLE | Compliant | `ensureOrganizationScope` signature unchanged; behavior hardened (security) |
| .ai/specs/AGENTS.md | `{date}-{title}.md` naming, no `SPEC-` prefix | Compliant | `2026-05-29-org-scope-fail-open-authorization-hardening.md` |
| Org instructions | Add "Security impact" section to PR | Compliant | Required in PR description (authorization change) |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No model changes; org-scope semantics consistent |
| API contracts match UI/UX section | Pass | 403 surfaced by existing error UI |
| Risks cover all write operations | Pass | Command path + read path both covered |
| Commands defined for all mutations | Pass | No new mutations introduced |
| Cache strategy covers all read APIs | Pass | No cache changes; guard runs post-load |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Shared predicate + write-path fix (#2239) | Done | 2026-05-29 | `isOrganizationAccessAllowed` + rewritten `ensureOrganizationScope`; 13 unit tests green; shared builds + typechecks |
| Phase 2 — Read-path guard + migration (#2245 + audit) | Done | 2026-05-29 | `isOrganizationReadAccessAllowed` predicate; all 10 fail-open guards migrated incl. `entity-roles-factory`; 6 guard unit tests green; core builds + typechecks |
| Phase 3 — Integration coverage + verification | Partial | 2026-05-29 | Unit coverage complete & green. Fixture infra + `TC-CRM-072.spec.ts` written. Behavioral security change documented in Migration & Compatibility; `CHANGELOG.md` is release-tooling-managed so no manual mid-cycle entry. **Integration spec written but NOT yet validated in a coherent env** — see note below |

### Phase 3 — integration test status
Built reusable fixture infrastructure:
- `packages/core/src/helpers/integration/authFixtures.ts` — `createOrganizationFixture`, `setRoleAclFeatures`, `setUserAclVisibility`, `apiRequestWithSelectedOrg` (sets the `om_selected_org` cookie).
- `packages/core/src/helpers/integration/dbFixtures.ts` — `createOrganizationInDb`, `setUserAclInDb`, `clearUserHomeOrganization` (raw `pg`, since `createUserFixture` requires a non-null `organizationId` and there is no API to null a home org or, on this instance, to create an org as a non-super-admin).
- `packages/core/src/modules/customers/__integration__/TC-CRM-072.spec.ts` — WRITE deny (#2239), WRITE allow-path regression, READ deny (#2245), + an admin control read.

**Validation blocker (environment, not logic):** the spec mixes API fixtures (hit the running app) with raw-`pg` DB fixtures (use `apps/mercato/.env` `DATABASE_URL`). It MUST run under the standard coherent app+DB harness (`yarn test:integration` / `yarn test:integration:ephemeral`). In this session the already-running dev server pointed at a **different** database than `apps/mercato/.env`, so the DB-level fixture writes (org creation, null-home-org) were invisible to the app and the preconditions were never established — the test flaked (200 vs 403 on identical reruns) and is therefore not trustworthy when run against an arbitrary dev server. The corrected WRITE-deny case sends **no** selected org (so legacy `currentOrg` resolves null — the genuine #2239 fail-open precondition; old code → 200, fixed code → 403), rather than the original `selectedOrgId=orgA` which produced a 403 that the OLD code also returned (currentOrg≠target mismatch) and thus did not exercise the fix.

**Action required:** validate `TC-CRM-072.spec.ts` via `yarn test:integration:ephemeral packages/core/src/modules/customers/__integration__/TC-CRM-072.spec.ts` (clean, coherent app+DB). The security logic itself is already fully covered by the 25 green unit tests (predicate, command-path guard incl. the #2239 vector, read-path guard incl. fail-closed empty set + allow-path regression + Pattern C legacy fallback).

### Detailed progress
- [x] `packages/shared/src/lib/auth/organizationAccess.ts` — predicate + truth-table unit test (6 cases)
- [x] `packages/shared/src/lib/commands/scope.ts` — `ensureOrganizationScope` rewritten; scope unit test (7 cases incl. absent-scope-not-deny + allow-path)
- [x] `packages/core/src/modules/directory/utils/organizationScopeGuard.ts` — read predicate + unit test (6 cases)
- [x] 10 fail-open guards migrated (people/companies/deals detail routes + sub-resources + `entity-roles-factory`)
- [x] Behavioral security change documented (spec Migration & Compatibility); CHANGELOG deferred to release tooling
- [x] Integration fixture infra + `TC-CRM-072.spec.ts` written (deny WRITE/READ + allow-path)
- [ ] `TC-CRM-072.spec.ts` validated in a coherent app+DB harness (`yarn test:integration:ephemeral`) — could not validate in-session (dev server DB ≠ fixtures DB)

## Changelog
### 2026-05-29
- Initial specification (post Open-Questions gate: Q1-b full audit, Q2-b WHERE-scoping deferred, Q3-a ship fail-closed, Q4-a single PR closing #2239 + #2245).
- Applied pre-implementation analysis findings (`.ai/specs/analysis/ANALYSIS-2026-05-29-org-scope-fail-open-authorization-hardening.md`): added **G1** Pattern C contract (load-bearing absent-scope legacy fallback; ~40 call sites enumerated), **G2** write-path closure-scope statement (Pattern A/B closed incl. #2239 example; Pattern C user routes deferred), and **G3** follow-up issues (Pattern C scope population, deferred WHERE-clause scoping, enterprise/provider re-audit). Strengthened unit/integration test requirements with the absent-scope-not-deny and allow-path regression assertions.
- Implemented Phases 1–2 and unit coverage. Read-path helper realized as a boolean predicate (`isOrganizationReadAccessAllowed`) rather than a throwing helper, to fit the mixed `throw` / `return forbidden(...)` deny styles across the 10 call sites and keep i18n keys at the call site. 25 new unit tests green; shared + core build and typecheck clean. Phase 3 Playwright tests blocked on missing null-home-org / org-visibility-ACL fixture infrastructure.
