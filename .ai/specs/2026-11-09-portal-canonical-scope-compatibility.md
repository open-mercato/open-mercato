# Portal canonical scope compatibility

## TLDR

Restore compatibility for existing `UserValidationResult` consumers while retaining the portal scope repair from #7176. Authentication accepts scope only from the persisted customer user and refuses a mismatched token.

## Overview and Problem Statement

The successful public result previously required only `valid`, `resolvedFeatures`, and `isPortalAdmin`. Making four canonical-scope fields required breaks existing TypeScript consumers before the security correction can ship. The inherited review demonstrates TS2322 for the previous successful value.

## Proposed Solution

Add `tenantId`, `organizationId`, `customerEntityId`, and `personEntityId` as optional public fields. The real validator supplies them from the database. Request and cookie authentication explicitly require canonical tenant and organization fields before building a context; optional CRM links normalize to null. They never fall back to token scope or CRM links.

## Architecture

The customer_accounts module retains ownership of validation, live-session checks, and customer RBAC. Both existing authentication entry points call the same validator. Staff authentication and cross-module relationships are unchanged.

## Data Models

No entity, stored-data shape, migration, token format, or session lifetime changes.

## API Contracts

Existing authentication function names and parameters remain. Existing valid public result objects remain assignable. Authenticated contexts continue to expose their existing required tenant and organization fields. Tokens whose scope differs from the stored user are rejected before ACL lookup.

## Migration & Backward Compatibility

The new result properties are optional and additive. No consumer migration or deprecation is required. A successful legacy-shaped object remains valid at the public type boundary; it cannot authorize a request without canonical scope. There is no alias, fallback to untrusted token fields, or widening of permissions.

## Risks & Impact Review

- High: optional scope could accidentally be trusted as missing. Both entry points return unauthenticated without canonical tenant and organization fields.
- High: a token could claim a different organization in the same tenant. Both dimensions have separate request/cookie negative regressions, with ACL lookup forbidden after rejection.
- Medium: public compatibility could regress later. A real TypeScript semantic compilation checks the previously supported successful value against the exported type declaration.
- Residual: personal CLA and required CI remain independent merge gates. This specification grants no approval or baseline waiver.

## Validation and Integration Coverage

Existing request and cookie suites exercise signed customer tokens, session binding, persisted CRM identity, and rejection before RBAC. Extend both suites for tenant and organization mismatches and add a compiler consumer regression. `TC-PORTAL-013-canonical-auth-scope.spec.ts` uses self-contained API fixtures in the isolated CLI environment: a stale company claim must follow the persisted company in GET /api/customer_accounts/portal/users; tenant and organization changes must return 401 from GET /api/customer_accounts/portal/profile and redirect the protected /[orgSlug]/portal/profile page to login. Each fixture restores moved scope and deletes temporary users, roles, companies, organizations and tenant. Execution and the full gate remain pending until recorded below.

## Implementation Plan

1. Keep new public fields optional and fail closed at both context constructors.
2. Add compiler compatibility and both scope-dimension regressions.
3. Run focused tests/static checks and the full configured gate, then review before publishing a credited replacement.

## Final Compliance Report

The public type is additive and both context constructors require canonical scope. No entity, schema, session lifetime, route or permission grant changes; generated files are produced by the generator. Validation outcomes belong in the linked PR review and QA reports. This document grants no source, QA or CI signal.

## Changelog

- 2026-11-09: Documented additive public-type repair and canonical-scope refusal checks for the inherited #7176 finding.
