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

Add `security.mfa.emergency_bypass_active` as an in-app warning type and an internal persistent security event. An additive asynchronous helper in `lib/security-config.ts` emits that event using server-authenticated tenant and organization IDs. Existing login, enrollment, and sudo bypass branches call it immediately after their unchanged warn call. Emission failures are reported and do not break emergency access.

A persistent subscriber validates scope and observation time, serializes broadcasts using a PostgreSQL transaction advisory lock keyed by tenant/organization/day, and checks for an existing notification of this type and daily group key, regardless of read/dismissed state. If absent, it calls the existing notification service's `createForFeature` with `security.mfa.manage` and `restrictRecipientsToOrganization: true`. That path applies canonical RBAC, including wildcard grants, user overrides, and organization visibility.

The notification service commits the complete recipient batch atomically. If a worker crashes after that commit, the persisted rows suppress replay. Zero recipients leave no marker and can be retried; newly granted administrators after a successful broadcast receive the next day's warning. Notification deletion permits a later broadcast within that day. No cache or new dependency is needed. A PostgreSQL lock failure propagates to the persistent worker for retry instead of falling back to unsafe deduplication.

## Data Model and API Contracts

Reuse the existing notifications table, group key, and expiry. The event contains `tenantId`, `organizationId`, and `observedAt` (ISO timestamp), validated with zod; no personal information, credentials, or bypass target details are included. No new entity, migration, API route, request field, or response field. The event is excluded from workflow triggers. Notification side effects are not undoable; normal notification dismissal remains available.

## UI/UX

Use the existing notification center and warning renderer with translated title/body in en/pl/de/es/ko. Explain that the operator must disable `OM_SECURITY_MFA_EMERGENCY_BYPASS`; link to the existing MFA administration page. No component, client boundary, bundle, layout, or design-system change is required. No custom mockup is needed; runtime visual evidence depends on an available enterprise test environment.

## Edge Cases and Risks

- Flag off: existing checks never request the event.
- No concrete tenant/organization: log only; never fan out globally.
- Repeated, concurrent, read, or dismissed notifications: persisted daily guard prevents renewed alerts.
- UTC boundary: a new observed day permits another warning; retries retain the original observed timestamp.
- Notification delivery failure: worker retries; request-side enqueue failures are reported without blocking break-glass access.
- Delayed events can describe a bypass since disabled; copy describes the observed incident rather than claiming a live configuration check.
- Per-request persistent events add queue traffic; subscriber short-circuits before ACL fanout after the first daily notification. A producer throttle can be added separately if operational measurements justify it.

## Migration & Backward Compatibility

All contract changes are additive: a security notification ID, internal event ID, and exported helper. Preserve existing exported function signatures, log text/fields, ACL IDs, DI keys, and bypass behavior. Rollback stops new notifications; existing rows can be dismissed normally. No data repair or migration required.

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

- 2026-10-18: Initial design for issue #5523; daily scope deduplication and existing ACL-aware delivery selected as reversible defaults.
