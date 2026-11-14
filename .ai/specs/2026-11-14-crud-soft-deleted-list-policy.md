# Explicit soft-deleted list visibility

## TLDR

Fixes #9154. List viewers cannot opt themselves into reading deleted rows. A CRUD route must explicitly enable `list.allowWithDeleted` before its `withDeleted` query flag is honored.

## Overview and problem

The CRUD factory previously forwarded a raw query parameter even when the route schema omitted it. Generic entity records exposed the same bypass. This contradicts the documented default that soft-deleted rows remain hidden unless the page explicitly opts in.

## Proposed solution and architecture

Keep the existing factory, query engines, and organization/tenant scope. Add optional `ListConfig.allowWithDeleted?: boolean`, defaulting to false. Only an enabled route interprets a true boolean token as permission to include deleted rows. Apply the same policy to list exports and the ORM fallback. Include the policy in the cache key so permissive or pre-fix entries cannot populate default-hidden responses. The generic records endpoint always passes `withDeleted: false`.

## Data models and API contracts

No database or response-schema changes. No route, method, ACL, event, or dependency changes. The generic records endpoint still accepts its existing query shape. Existing query-engine callers retain their internal `withDeleted` capability.

## Migration & Backward Compatibility

The new optional property is additive. Existing route definitions compile unchanged and enforce the documented default-hidden policy. A route intentionally exposing deleted rows must set `list.allowWithDeleted: true`; its existing authentication and scope checks still apply. A query string alone, including a schema-declared parameter, cannot grant this capability. Operators need no environment, startup, or database changes. Old cache entries expire normally and are unreachable through the new policy-specific keys.

## Risks & Impact Review

Deleted-row recovery routes must explicitly opt in. Cache isolation prevents stale disclosure after rollout. Exports and fallback queries must follow the same policy as ordinary lists; handler-level regression tests cover each path. This change does not grant access to records outside the existing tenant or organization scope.

## Coverage and final compliance

`crud-factory.test.ts` exercises real factory GET handlers for default-denied and opted-in reads, boolean tokens, schema-only declarations, exports, ORM fallback, and cache isolation. `records.get.custom-entity.test.ts` exercises generic lists and full exports, asserting false deletion visibility and retained tenant scope. No UI rendering changes require browser evidence.

## Changelog

- 2026-11-14: Implemented route-owned deletion visibility and regression coverage; deployment and required CI remain subject to PR gates.
