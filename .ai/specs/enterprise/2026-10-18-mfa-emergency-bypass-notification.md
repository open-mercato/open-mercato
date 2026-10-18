# MFA emergency bypass administrator notification

## TLDR

Notify users with `security.mfa.manage` when the existing MFA emergency-bypass detection fires in their tenant and organization. Preserve the audit warnings and bypass behavior. Deliver at most one administrator broadcast per scoped UTC day, including across worker retries and process restarts.

Refs #5523. Extends `implemented/SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md`.

## Problem Statement

A forgotten `OM_SECURITY_MFA_EMERGENCY_BYPASS` disables MFA while administrators see only logs. The notification center must surface the condition to authorized administrators without request-by-request alerts.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Reason |
|---|---|---|
| Deduplication window | One broadcast per tenant, organization, and UTC day of observation | Durable notification rows survive restarts; a daily reminder surfaces an ongoing incident. |
| Audience | Only `security.mfa.manage`, with effective wildcard grants | Matches the acceptance criteria; `security.admin.manage` alone is insufficient. |
| Missing scope | Keep the log, skip notification until a scoped request observes bypass | Startup cannot safely infer a tenant/organization; no global tenant scan. |

## Proposed Solution and Architecture

Add `security.mfa.emergency_bypass_detected` as an in-app warning type and an internal persistent security event. An additive asynchronous helper in `lib/security-config.ts` emits that event using server-authenticated tenant and organization IDs. Existing login, enrollment, and sudo bypass branches call it immediately after their unchanged warn call. Emission failures are reported and do not break emergency access.

A persistent subscriber validates scope and observation time against trusted event context, checks for an existing notification of this type and daily group key in the scope, regardless of read/dismissed state, to avoid repeating daily audience work. If absent, it uses the existing notification feature-recipient resolver for `security.mfa.manage`, checks each candidate with `rbacService.userHasAllFeatures` in the trusted scope, then calls notification-service `createBatch`. This preserves wildcard grants, user overrides, and organization visibility without the existing `createForFeature` 200-candidate cap or its swallowed authorization errors. RBAC errors propagate for persistent retry.

The notification service gains an optional trailing `CreateBatchNotificationOptions` argument on `createBatch`, with `skipExistingGroup: true`. This opt-in requires a nonblank group key, acquires strict per-recipient transaction advisory locks in sorted user-ID order, and skips matching tenant/organization/recipient/type/group rows in every status without modifying or re-emitting them. Guard and creation share the existing write transaction, with no subscriber transaction held around RBAC or service forks. Existing two-argument calls keep their behavior. The notification service commits the complete new-recipient batch atomically. If a worker crashes after that commit, the persisted rows suppress replay. Zero recipients leave no marker and can be retried; newly granted administrators after a successful broadcast receive the next day's warning. Notification deletion permits a later broadcast within that day. No cache or new dependency is needed. Scope is passed through event emit options and must exactly match subscriber context. A PostgreSQL lock failure propagates to the persistent worker for retry instead of falling back to unsafe deduplication.

## Data Model and API Contracts

Reuse the existing notifications table, group key, and expiry. The event contains `tenantId`, `organizationId`, and `observedAt` (ISO timestamp), validated with zod; no personal information, credentials, or bypass target details are included. No new entity, migration, API route, request field, or response field. The event is excluded from workflow triggers. Notification side effects are not undoable; normal notification dismissal remains available.

## UI/UX

Use the existing notification center and warning renderer with translated title/body in en/pl/de/es/ko. Explain that the operator must disable `OM_SECURITY_MFA_EMERGENCY_BYPASS`; omit navigation actions because MFA-management permission alone does not guarantee access to administrative pages. No component, client boundary, bundle, layout, or design-system change is required. No custom mockup is needed; runtime visual evidence depends on an available enterprise test environment.

## Edge Cases and Risks

- Flag off: existing checks never request the event.
- No concrete tenant/organization: log only; never fan out globally.
- Repeated, concurrent, read, or dismissed notifications: persisted daily guard prevents renewed alerts.
- UTC boundary: a new observed day permits another warning; retries retain the original observed timestamp.
- Notification delivery failure: worker retries; request-side enqueue failures are reported without blocking break-glass access.
- Delayed events can describe a bypass since disabled; copy describes the observed incident rather than claiming a live configuration check.
- Per-request persistent events add queue traffic; subscriber short-circuits before ACL fanout after the first daily notification. A producer throttle can be added separately if operational measurements justify it.

## Migration & Backward Compatibility

All contract changes are additive: a security notification ID, internal event ID, exported helper/event validator, and optional trailing batch-service options/type. Preserve existing call compatibility, log text/fields, ACL IDs, DI keys, and bypass behavior. Rollback stops new notifications; existing rows can be dismissed normally. No data repair or migration required.

## Research

[Keycloak's server administration guide](https://www.keycloak.org/docs/26.5.7/server_admin/index.html) separates security event logging from event listeners and notifications. Reuse Open Mercato's event/subscriber and notification facilities for that separation; do not add another delivery framework.

## Integration Coverage

Ship an executable enterprise integration scenario for bypass-enabled login through notification API delivery, repeated login deduplication, ordinary-user exclusion, and notification-center rendering. Fixtures must be self-contained and removed in teardown. Run against an enterprise server with bypass enabled; explicitly skip when that server configuration is unavailable. Unit coverage exercises flag-off and all detection branches, scoped fanout options, duplicate/read/dismissed suppression, concurrency lock use, daily rollover, malformed scope, and retry after failure. Run existing notification recipient/service tests to verify canonical wildcard ACL behavior.

## Implementation Plan

### Phase 1: Notification delivery

1.1 Add notification metadata, translations, scoped event and subscriber with durable daily deduplication.

1.2 Wire the existing login, enrollment and sudo bypass branches through the central helper while keeping logs unchanged.

### Phase 2: Verification and documentation

2.1 Add regression and integration coverage; update the enterprise MFA spec changelog.

2.2 Run the configured validation gate using the local runner, review the diff independently, and publish implementation evidence and limitations.

## Final Compliance Report — 2026-10-18

Reviewed root, enterprise, core (events, notifications, ACL), shared (feature policy), UI (notifications), events, auth, and QA guidance. No cross-module relationships, new entity, cache, production dependency, or rendering code. Scopes are required; recipients use canonical authorization. Existing UI and translation conventions apply. Security/performance/compatibility review: approved subject to executable validation and independent scope review.

## Changelog

- 2026-10-18: Initial design for issue #5523; independent review confirmed scope cohesion. Implementation review moved strict deduplication into the notification-service write transaction to prevent connection-pool starvation from nested service forks. Resolved delivery-cap and link-permission findings by using canonical recipient resolution plus explicit RBAC and batch delivery, and omitting inaccessible navigation.
