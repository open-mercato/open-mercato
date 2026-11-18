# Notification delivery tenant isolation (#9136)

## Status and scope

Implemented in this change; local validation and live-environment limits are recorded on the PR. Applies to notification settings, notification delivery, and the existing checkout email consumer. No startup, dependency, schema, migration, or provider configuration changes.

## Problem and solution

Authenticated tenant administrators with `notifications.manage` could overwrite the instance-global `notifications / delivery_strategies` module-config row. Notification links, email sender/reply-to, prefixes and channel switches for unrelated tenants consequently changed.

Use the existing module-config service's tenant scope for settings GET/POST and writes. Its existing tenant-first, instance-fallback reader and tenant-keyed cache provide inheritance without copying or mutating the global record. Resolve a missing selected tenant from the trusted actor tenant, preserving the existing superadmin fallback; reject an unresolved tenant with the existing `403 tenant_scope_required`, including superadmins. Request bodies, URLs, hosts and query strings cannot select a tenant. This endpoint never writes instance defaults, even for superadmins; existing trusted operator/server configuration remains the instance-default writer.

Pass the loaded notification's tenant to subscriber configuration resolution, after the scoped notification lookup succeeds. Pass the loaded checkout transaction's tenant to its existing email-settings read. The strategies continue using their existing channel gates and sender resolution.

Tenant `appUrl` must have the same HTTP(S) origin as the operator's existing instance configuration (or existing environment fallback), with no embedded credentials. A missing operator origin rejects supplied tenant appUrl. Neither Host nor forwarded headers authorize an origin. No tenant-domain verification registry exists in this change, so the explicitly allowed operator-origin option is used. On reads, omit unsafe previously stored tenant origins and inherit the instance appUrl when omitted, preserving usable links after sender-only edits. Instance settings are trusted operator defaults; operators must audit any previously compromised global record.

## Migration & Backward Compatibility

Keep the config key, serialized shape, ACL IDs, routes, events, DI keys and import paths unchanged. `resolveNotificationDeliveryConfig` adds optional `tenantId` to its existing options; `saveNotificationDeliveryConfig` adds an optional trailing existing `ConfigScope`. Existing unscoped trusted server calls preserve global behavior. All first-party tenant-facing and delivery callers use tenant scope.

Intentional security restrictions: HTTP settings writes affect the authenticated tenant only; arbitrary external tenant appUrl is rejected with the existing invalid-settings 400 response. Tenantless GET now returns 403. Retaining the old HTTP behavior as a bridge would retain the cross-tenant vulnerability. No automatic data migration is performed: existing global values remain read-only inherited defaults. See UPGRADE_NOTES.md for audit and client actions.

## Regression coverage

- Route/module-config/cache integration-style Jest tests: two tenants, cached inheritance, spoofed body tenant ignored, sender/reply-to/prefix/switch isolation, global-row immutability, scoped server-write origin enforcement, legacy global helper calls, actor fallback, unauthenticated and tenantless requests, unsafe stored origins and missing operator origin.
- Existing mutation-guard regressions continue to exercise settings writes and guard rejections.
- Subscriber tests assert configuration uses the persisted notification tenant and is not read when the scoped notification is absent.
- Checkout worker regression asserts sender/reply-to and the loaded transaction's tenant passed to configuration resolution.
- Self-contained HTTP integration: `TC-NOTIF-9136.spec.ts` creates two tenants, organizations, notification-admin roles and users, proves GET/POST isolation, rejected phishing origins and unchanged instance row, then removes fixtures/configuration. Requires a running integration app/database; execution limits belong in validation evidence.
- No UI rendering changes. Existing settings form retains its payload/response shape; verify saving delivery settings in two tenant sessions in manual QA if live evidence is unavailable.

## Risks and validation

Legacy global values may already be attacker-controlled; audit appUrl/from/replyTo/switches before deployment. Third-party tenant consumers must adopt the optional scope argument. The read-only fallback intentionally remains visible to tenants as their effective defaults. No new transport or secret storage is introduced.

Configured validation gate: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app, in that order. Targeted core/checkout tests and integration discovery accompany it. Local environment failures must be reported without treating them as passed checks.

## Changelog

- 2026-11-18: Implement tenant-scoped delivery configuration and trusted-origin enforcement for issue #9136; add regression and HTTP integration coverage.
