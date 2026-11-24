# Customer user detail follows the organization switcher (#5577)

Status: implementation candidate in PR #9089; awaiting re-review, CI authorization and human QA.

## TLDR and Overview

The admin customer-user list already follows the organization switcher (#5574), but the detail page and its actions stayed pinned to the caller's home organization, so a user listed under another selected organization or under "All organizations" answered 404 when opened. Detail, update, delete and the per-user actions now resolve the same request organization scope as the list and re-check the required feature in the user's own organization. No schema, migration, configuration or dependency changes.

## Problem Statement

`GET/PUT/DELETE /api/customer_accounts/admin/users/[id]` and the `verify-email`, `send-reset-link`, `reset-password` and session-revoke routes looked users up by `auth.orgId`. A staff user who could see a customer user in the list could not open or manage it. The detail page also loaded role options from the staff home organization instead of the edited user's organization.

## Proposed Solution and Architecture

A shared helper, `lib/adminCustomerUserLookup.ts`, loads the customer user for every detail route:

1. Resolve the request scope with `resolveOrganizationScopeForRequest` (tenant + selected organization and descendants, or every accessible organization under "All organizations").
2. Write routes pass `mutation: true`. When the resolver flags `selectionRejected` (an explicit selection the caller may not use), a write answers 403 before any record lookup instead of running within the resolver fallback scope. Reads keep the fallback, following `.ai/lessons/organization-scoped-routes-must-resolve-request-selection.md`.
3. Look the user up by id, tenant and `organizationId $in filterIds` with a typed `FilterQuery<CustomerUser>`. A user outside the scope answers 404, so routes do not reveal organizations the caller cannot access.
4. When the user belongs to an organization other than the caller's home organization, re-check the route's feature (`customer_accounts.view` for reads, `customer_accounts.manage` for writes) in the user's organization through the staff RBAC service; a missing grant answers 403 before any write.

Writes, events, cache invalidation and role resolution use the user's own tenant and organization, never the caller's home organization. The detail page loads role options for the user's organization, keys them to that organization, and shows loading, successful-empty and retryable error states separately.

## Data Models and API Contracts

No entity changes.

- `GET /api/customer_accounts/admin/users/[id]` response gains an additive `organizationId` field. The OpenAPI schema declares it optional, so existing generated clients keep validating.
- List and detail responses return the creation timestamp as `updatedAt` when a record was never updated (previously `null`), so the first edit can send an optimistic-lock version.
- New error outcomes on write routes: 403 for a rejected organization selection and for a missing `customer_accounts.manage` grant in the target organization. Read routes answer 403 for a missing `customer_accounts.view` grant in the target organization. Out-of-scope users keep answering 404.
- Route URLs, methods, request bodies and success payloads are unchanged.

## Migration & Backward Compatibility

- Additive response field (`organizationId`): optional in the public schema; clients that ignore unknown fields are unaffected. Covered by `BACKWARD_COMPATIBILITY.md` §7 (stable API routes, additive fields only).
- `updatedAt` fallback: a previously `null` value now carries the creation timestamp. Clients that treated `null` as "never updated" should compare `updatedAt` with `createdAt` instead. No stored data is rewritten.
- Behavior change for callers whose organization selection was previously ignored: requests now act within the selected organization scope. A request that relied on the home organization while a different organization was selected now acts on the selected scope, or answers 404 for users outside it.
- No database migration, no data backfill, no feature flag. Rollback is a code revert.
- Backport: the affected route exists on `release/v0.10.x`; a `backport release/v0.10.x` label is requested on the PR.

## Implementation and Coverage

1. `lib/adminCustomerUserLookup.ts` – shared scoped lookup, rejected-selection guard, target-organization feature re-check.
2. Detail, update, delete, verify-email, send-reset-link, reset-password and session-revoke routes use the helper; writes pass `mutation: true`.
3. `PortalUserDetailPageClient.tsx` – role options from the target organization with loading/empty/error states and retry.
4. Unit coverage: route tests for out-of-scope 404, selected/All-organizations access, missing view/manage grants (403, no writes), rejected selection (403 before lookup, no writes; reads keep the fallback); component tests for role failure, thrown request, successful-empty and organization change.
5. Integration coverage:
   - `TC-CACC-ORGSCOPE-002` – detail follows the switcher.
   - `TC-CACC-ORGSCOPE-003` – real staff RBAC: manage in home, view only in a visible target organization; writes denied and record unchanged; rejected selection denied.
   - `TC-CACC-ORGSCOPE-004` – a user of another tenant stays invisible and unchanged under "All organizations" and with a forged selection.
   - `TC-CACC-ORGSCOPE-UI-001` – browser: All organizations → list → detail, target-organization roles, stale first save refused with 409 twice preserving the typed value, invalid-role save refused with 400 leaving the record unchanged.

Out of scope: hiding write controls for view-only roles on the detail page (pre-existing on the base; tracked in #10528).

## Risks & Impact Review

- High: a write running in a fallback scope after a rejected selection; mitigated by the 403 guard before lookup, unit and integration regressions.
- High: cross-organization or cross-tenant access through the switcher; mitigated by the scoped lookup, target-organization feature re-check and the ORGSCOPE-003/004 regressions.
- Medium: clients relying on `updatedAt: null`; documented above, no stored data changes.
- Low: additional RBAC lookup for cross-organization requests; measured statement counts are listed in the PR description.

## Final Compliance Report

Focused `customer_accounts` change; no schema migration, dependency, DI registration or configuration change. Tenant isolation is preserved by the tenant predicate and covered by ORGSCOPE-004. i18n: new keys for the rejected-selection error and role loading/error states in all five locales. Unit, typecheck and i18n checks pass locally; ORGSCOPE-001…004 and UI-001 pass in the ephemeral environment. CI and human QA remain separate gates.

## Changelog

- 2026-11-24: Documented scope resolution, rejected-selection guard, additive `organizationId`, `updatedAt` fallback, role-loader states, compatibility notes and regression coverage after the PR #9089 re-review.
