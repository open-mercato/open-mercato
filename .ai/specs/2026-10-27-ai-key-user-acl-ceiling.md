# AI key user ACL ceiling

## TLDR

Fix #7825 by bounding user-delegated AI keys by their owner's effective ACL. Reuse the existing `sessionUserId` binding for persistent MCP keys; unbound machine keys remain independently role-authorized.

## Problem Statement

Generated keys copy role IDs, while users can have a narrower overriding `UserAcl`. Key authorization currently ignores that override in cached, transactional, and organization projections.

## Proposed Solution

Intersect each bound key's role-derived features and organization visibility with its live owner ACL. Cache entries depend on the owner, and the API-key cache namespace changes to reject previous role-only projections. Keep endpoint and token shapes stable. Independently administered machine keys have no `sessionUserId` and retain existing semantics.

## Overview and Architecture

`loadAcl`, `loadAclWithEntityManager`, and `resolveFeatureOrganizationAccess` apply the same owner ceiling. Resolve the owner in the key's tenant and fail closed for missing owners or mismatched scopes. Intersect wildcard grants using shared matching primitives; authoritative checks continue through the existing feature policy. Transactional authorization reads the owner using the supplied EntityManager. Cache entries carry the owner's invalidation tag. User-bound keys never get a role-only raw super-admin flag in the authentication cache.

Replay authorization locks include the bound owner's user, membership, ACL, and role rows. A binding changed during lock acquisition returns the existing authorization-state drift conflict.

Key-cache invalidation tags use the resolved tenant and organization, including when a caller leaves the tenant unset and RBAC infers it from the key.

The optional Directory organization-scope cache also tags API-key scope entries with the authenticated owner ID. Owner ACL invalidation therefore evicts both the RBAC ceiling and the derived organization filter. API-key scope keys use a new namespace so previous entries without the owner dependency cannot survive an upgrade; exported invalidation-tag formats stay unchanged. Independently administered creator-backed keys may be evicted with their creator's scope cache, without changing their role authority.

## Data Models and API Contracts

No schema migration is required. `CreateApiKeyInput` gains optional `sessionUserId`; `mcp-key` supplies the authenticated user ID. Session issuance already stores that binding. Ordinary machine-key issuance does not set it. Existing routes, response fields, token formats, feature IDs, and DI names remain stable.

The existing user-ACL API clears the override when its feature list is empty, restoring role inheritance. Revocation integration fixtures retain an unrelated feature so they test a persisted restrictive override rather than the reset path.

## Migration & Backward Compatibility

Authorization narrows intentionally for bound keys; a role grant cannot bypass an owner's ACL. Legacy persistent MCP keys cannot be reliably distinguished from machine keys because their names/descriptions are editable. Operators must revoke and regenerate those keys. New MCP keys carry the binding; existing session keys are automatically bounded. No database migration or client payload changes are needed. User-bound keys no longer offer a raw global super-admin scope-override shortcut; feature authorization still uses the intersected ACL.

## Implementation and Coverage

1. Bind MCP issuance and cap the three RBAC projections with owner-tagged, versioned caches.
2. Regress broad roles with narrow `UserAcl` on cold/warm caches, owner invalidation, transaction parity, deleted/foreign owners, and unbound machine keys.
3. Integration coverage: mint through `POST /api/ai_assistant/mcp-key` and `POST /api/ai_assistant/session-key`; verify granted and denied features and organization-scoped customer reads against the user's ACL, then change the ACL and repeat while caches are warm. Create people in allowed/excluded organizations and assert the owner and key both read only the allowed record. Include a tenant-wide MCP key for a floating user, change only the owner's organization allowlist, and verify both switch to the newly allowed record while keeping view permission. The directory options endpoint lists tenant metadata and is not the data-isolation boundary. All fixtures are created and cleaned up by the test.
4. Run the configured gate and record any environmental limitations.

## Risks & Impact Review

High: a missed projection could retain escalation; cover all three and raw authentication flags. High: legacy persistent MCP keys remain unbound; require revocation/regeneration. Medium: cache dependencies could retain stale owner grants; tag owner invalidation and reject previous projection caches. Medium: machine-key regression; explicitly test unchanged unbound behavior.

## Final Compliance Report

Tenant-bound owner lookups, existing schema, no cross-module ORM relations, shared wildcard matcher, and unchanged HTTP/token contracts. Verification is in progress; this document remains outside `implemented/` until deployment evidence exists.

## Changelog

- 2026-10-27: Defined the delegated-key ceiling and explicit legacy-key rotation procedure for #7825.
- 2026-10-27: Added a failing-then-passing regression for role-ACL invalidation when the key tenant is inferred.
- 2026-10-28: Corrected integration organization checks to exercise customer-data scoping instead of tenant directory options.
- 2026-10-28: Added owner-dependent invalidation for the optional organization-scope cache, with a regression for a floating delegated principal.
