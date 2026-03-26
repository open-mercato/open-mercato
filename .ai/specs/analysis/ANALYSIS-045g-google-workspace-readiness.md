# Pre-Implementation Analysis: SPEC-045g — Google Workspace Integration

## Executive Summary

The Google Sheets import idea is viable, but SPEC-045g is not implementation-ready in its current form. The draft mixes older SPEC-045a/045b assumptions with the contracts that actually exist in the repo today, most notably around OAuth, package placement, route structure, mapping/schedule ownership, and delta-state persistence.

The narrow Google Sheets import scope can still be implemented as 100% non-core changes, but not by following SPEC-045g literally. To stay non-core, the spec needs to be rewritten around a dedicated provider package, provider-owned OAuth UI/routes, UMES-injected integration tabs, existing `integrations` credential/state storage, and existing `data_sync` schedules/mappings where they already fit.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Auto-discovery conventions | The spec uses outdated module/file layout examples such as `packages/core/src/modules/sync_google_workspace/` and `api/get/...` style routes. | Critical | Rewrite to the current package-backed provider layout with `route.ts` style API files. |
| 2 | Type definitions & interfaces | The spec uses `type: 'oauth'` with nested `oauth: { ... }`, but current shared types only expose flat OAuth field properties (`authUrl`, `tokenUrl`, `scopes`, `clientIdField`, `clientSecretField`). | Critical | Either update the spec to current flat type shape or explicitly make generic OAuth a prerequisite core phase. |
| 3 | Type definitions & interfaces | The spec health check examples return `status: 'error'`, but current health service/state only support `healthy | degraded | unhealthy`. | Critical | Change Google provider health contract to use existing status enum. |
| 4 | Database schema | The spec stores row hashes in `SyncExternalIdMapping.metadata`, but that field does not exist. | Critical | Use a provider-owned row-state table or explicitly add a core schema phase with BC section. |

### Missing BC Section

SPEC-045g has no “Migration & Backward Compatibility” section. That is acceptable only if the work stays strictly additive and non-core. As written, it implicitly depends on core OAuth/type/schema changes, so the BC section is required.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Migration & Backward Compatibility | Required if generic OAuth/contracts/core schema change | Add a section or remove all assumed core changes from scope. |
| Phasing | Hard to separate provider-only work from prerequisite platform work | Add explicit phases: provider-only v1, optional core-generic OAuth later. |
| Implementation Plan | The draft gives examples but not a real execution sequence | Add concrete file/package plan using current package structure. |
| Final Compliance Report | No explicit AGENTS/spec compliance checkpoint | Add checklist results before implementation. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Module Structure | Places provider under core and uses outdated API layout | Model it after `packages/sync-akeneo/`. |
| Data Models | `GoogleSheetsConfig` duplicates existing `sync_mappings` and `sync_schedules`; row hash persistence is unspecified against real schema | Keep only provider-specific spreadsheet/source config and provider-owned row-state if needed. |
| API Contracts | Missing OAuth start/callback/reconnect endpoints, token refresh/error contracts, ACLs, and OpenAPI/auth details | Define provider-owned OAuth endpoints and their auth/error model. |
| Product Mapping | Fields like `basePrice`, `categoryName`, `imageUrl`, `stockQuantity`, `weight`, `barcode` are treated as simple direct mappings, but real catalog import is more complex | Narrow v1 scope and define exact catalog command/entity behavior. |
| Risks | Misses current-platform mismatches and provider-vs-core boundary decisions | Add implementation-architecture risks, not only Google API risks. |
| Test Coverage | Missing key failure-path tests | Add OAuth denial/state mismatch/expired refresh token/header drift/multi-admin config race tests. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| External providers must live in their own workspace package | `SPEC-045g` module structure | Move to `packages/sync-google-workspace/`, not `packages/core/src/modules/sync_google_workspace/`. |
| Use current module conventions | `SPEC-045g` API structure | Use current `route.ts` style files and current provider package pattern. |
| Reuse existing hub contracts instead of duplicating them | `GoogleSheetsConfig.syncSchedule` + embedded mapping in config payload | Reuse `data_sync` schedules and mappings where possible; keep provider entity only for spreadsheet selection/source config. |
| Match existing health/state enums | Health section | Return `healthy`, `degraded`, or `unhealthy`, not `error`. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Generic OAuth path is assumed but not usable in current integrations UI | Spec cannot be implemented as written; core UI currently rejects `oauth` fields | Make OAuth provider-owned in v1: custom injected tab + provider API routes + existing credential/state services. |
| Product import scope is underspecified | High chance of rework once pricing, variants, categories, attachments, and inventory semantics are hit | Narrow v1 to explicit supported product shapes and define exact command flows. |
| Delta detection storage is designed against a non-existent field | Resume/skip logic cannot be implemented as described | Store row hashes in a provider-owned table keyed by integration/source/match key. |
| ANALYSIS-014 overstates readiness | Teams may assume Sheets is “already full” when current platform contracts do not match the spec | Downgrade Sheets from “Full” to “High, after spec rewrite”. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Duplicate scheduling model (`GoogleSheetsConfig.syncSchedule` vs `sync_schedules`) | Two sources of truth and confusing admin UX | Reuse `IntegrationScheduleTab` and `/api/data_sync/schedules`. |
| Spec assumes generic mapping UI while also defining provider config payloads | Ambiguous ownership of mapping persistence and validation | Decide one source of truth: generic `sync_mappings` plus provider spreadsheet/source config. |
| Core sync failure logging is Akeneo-specific today | Google failures may get poor/incorrect log messages | Either keep richer provider batch messages or upstream a small generic fix later. |
| Google OAuth operational friction | Redirect mismatches and app verification delays can block rollout | Document BYO app clearly and keep scopes minimal. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Spreadsheet header drift | Import mismatches or skipped fields | Revalidate headers on preview and run. |
| Google read quotas | Slow or throttled imports on very large sheets | Batch reads, caching of sheet metadata, exponential backoff. |
| Concurrent admin edits | Conflicting source/mapping config | Use `updatedAt` optimistic concurrency on provider config. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- OAuth ownership is undefined: decide whether Google uses unimplemented core-generic OAuth from SPEC-045a or a provider-owned OAuth flow.
- Provider location is wrong: the spec violates the current external-integration package model.
- Delta-state persistence is wrong: `SyncExternalIdMapping.metadata` does not exist.
- Product import scope is not specific enough to code safely.

### Important Gaps (Should Address)

- No decision on whether to reuse `sync_mappings` and `sync_schedules`.
- No exact callback route/auth/session design for OAuth state + PKCE.
- No definition of reconnect UX when `reauthRequired` is set.
- No exact error model for missing spreadsheet, revoked refresh token, or renamed columns.
- No exact command strategy for categories, media, prices/offers, and variants.

### Nice-to-Have Gaps

- No documented bundle-expansion rule for future Sheets customers/orders vs Drive storage.
- No explicit notification plan for sync success/failure and mapping drift.
- No operator CLI for env-driven bootstrap, if that later becomes desirable.

## Workspace 014 Check

`ANALYSIS-014-google-workspace-integration.md` is directionally right about product scope hierarchy:

- Sheets is the best fit in current hubs.
- Drive is limited by the signed-URL gap.
- Docs generation has no clean hub fit today.

But it is too optimistic on implementation readiness:

- It says Sheets feasibility is “Full”.
- It implies OAuth is already present in `sync_google_workspace`.
- It assumes the Google bundle/module already exists.

Recommendation: keep the Drive/Docs conclusions, but revise the Sheets verdict to “High after spec rewrite; not implementation-ready as currently specced”.

## Remediation Plan

### Before Implementation (Must Do)

1. Rewrite the spec to a dedicated provider package: `packages/sync-google-workspace/`.
2. Replace the generic OAuth dependency with a provider-owned v1 OAuth flow using injected integration-detail tabs and provider API routes.
3. Rebase config ownership:
   - provider entity for spreadsheet/source selection
   - `sync_mappings` for field mapping where possible
   - `sync_schedules` for scheduling
   - provider-owned row-state table for hash/delta data if needed
4. Narrow v1 to a clearly defined Google Sheets import scope.

### During Implementation (Add to Spec)

1. Define the exact credential storage keys and whether tokens live on bundle or child integration credentials.
2. Define the exact catalog command flow for create/update and the unsupported cases for v1.
3. Define OAuth error paths: denied consent, invalid state, expired refresh token, revoked app, missing offline refresh token.
4. Add integration tests for OAuth callback security, preview/header drift, cross-tenant isolation, schedule execution, and reconnect flow.

### Post-Implementation (Follow Up)

1. Consider a separate core spec for generic OAuth credential rendering only if multiple providers need the same UI.
2. Generalize `data_sync` import failure logging so it is not Akeneo-specific.
3. Revisit Drive and Docs only after Sheets v1 is proven.

## Recommendation

Needs spec updates first.

Strict answer to the non-core question:

- **No**, SPEC-045g cannot be implemented 100% as non-core changes **as written**.
- **Yes**, the Google Sheets v1 integration can still be implemented 100% as non-core changes **if the spec is rewritten** around the current provider-package pattern, UMES integration-detail tabs, provider-owned OAuth routes/UI, existing `integrations` credential/state storage, and existing `data_sync` schedules/mappings.
