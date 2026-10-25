# MFA emergency bypass administrator notification

## TLDR

Notify users with `security.mfa.manage` when the existing MFA emergency-bypass detection fires in their tenant and organization. Preserve the audit warnings and bypass behavior. Deliver at most one administrator broadcast per scoped UTC day, including across worker retries and process restarts, unless all of that day's notification rows in the scope are deleted.

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

Add `security.mfa.emergency_bypass_detected` as an in-app warning type and an internal persistent security event. An additive asynchronous helper in `lib/security-config.ts` emits that event using server-authenticated tenant and organization IDs. Existing login, enrollment, and sudo bypass branches call it immediately after their unchanged warn call. Emission failures are reported and do not break emergency access. Bound the login and sudo enqueue wait to two seconds, below the login interceptor timeout; enrollment page middleware starts the helper without awaiting it, including enforcement-service-unavailable and compliance-check-failed bypass paths. An unavailable queue must not prevent login, enrollment bypass, or sudo. A timed-out enqueue may still complete later and remains protected by persistent deduplication; late rejections are observed.

A persistent subscriber validates scope and observation time against trusted event context, checks for an existing notification of this type and daily group key in the scope, regardless of read/dismissed state, to avoid repeating daily audience work. If absent, it uses the existing notification feature-recipient resolver for `security.mfa.manage`, checks each candidate with `rbacService.userHasAllFeatures` in the trusted scope, then calls notification-service `createBatch`. This preserves wildcard grants, user overrides, and organization visibility without the existing `createForFeature` 200-candidate cap or its swallowed authorization errors. RBAC errors propagate for persistent retry.

Live verification also exposed a shared enabled-module filtering defect: nested wildcard grants such as `security.mfa.*` were assigned to the nonexistent module `security.mfa`. Resolve their first namespace through the existing declared owning-module map, preserving off-convention aliases, disabled-module denial, exact feature removal, and organization checks. This restores intended wildcard matching across all enabled modules and changes effective permissions for existing role and per-user ACLs; the migration requirements and authorization risk are documented below. Keep this minimal correction bundled in implementation PR #7619 because canonical authorization must honor the promised nested-wildcard administrator audience; an MFA-only matcher would bypass shared policy. The shared change and regression coverage remain identifiable in that PR, with a dedicated operator disclosure in `UPGRADE_NOTES.md`.

The notification service gains an optional trailing `CreateBatchNotificationOptions` argument on `createBatch`, with `skipExistingGroup: true`. This opt-in requires a nonblank group key, acquires strict per-recipient transaction advisory locks in sorted user-ID order, and skips matching tenant/organization/recipient/type/group rows in every status without modifying or re-emitting them. Guard and creation share the existing write transaction, with no subscriber transaction held around RBAC or service forks. Existing two-argument calls keep their behavior. The notification service commits the complete new-recipient batch atomically. If a worker crashes after that commit, the persisted rows suppress replay. Zero recipients leave no marker and can be retried; newly granted administrators after a successful broadcast receive the next day's warning. Notification deletion permits a later broadcast within that day. No cache or new dependency is needed. Scope is passed through event emit options and must exactly match subscriber context. A PostgreSQL lock failure propagates to the persistent worker for retry instead of falling back to unsafe deduplication.

## Data Model and API Contracts

Reuse the existing notifications table, group key, and expiry. The event contains `tenantId`, `organizationId`, and `observedAt` (ISO timestamp), validated with zod; no personal information, credentials, or bypass target details are included. No new entity, migration, API route, request field, or response field. The event is excluded from workflow triggers. Notification side effects are not undoable; normal notification dismissal remains available.

## UI/UX

Use the existing notification center and warning renderer with translated title/body in en/pl/de/es/ko. Explain that the operator must disable `OM_SECURITY_MFA_EMERGENCY_BYPASS`; omit navigation actions because MFA-management permission alone does not guarantee access to administrative pages. No component, client boundary, bundle, layout, or design-system change is required. No custom mockup is needed; runtime visual evidence depends on an available enterprise test environment.

## Edge Cases and Failure Scenarios

- Flag off: existing checks never request the event.
- No concrete tenant/organization: log only; never fan out globally.
- Repeated, concurrent, read, or dismissed notifications: persisted daily guard prevents renewed alerts while the scope retains a notification row for that day.
- UTC boundary: a new observed day permits another warning; retries retain the original observed timestamp.
- No authorized recipients: leave no marker, allowing a later request to retry after grants change.

## Risks & Impact Review

| Concrete failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| An existing nested wildcard begins authorizing access previously denied after enabled-module filtering is corrected. | High | Canonical authorization across all enabled modules; stored role ACLs and per-user ACLs, including users inheriting role grants. | Before upgrading, audit the matching features and affected users, remove unintended nested wildcards or replace them with approved exact feature IDs, and verify scoped access after upgrading. Publish the operator action in `UPGRADE_NOTES.md`; retain disabled-module, removed-feature, and scope-denial regressions. | An unaudited wildcard may widen access even though its stored value is unchanged; reverting the shared correction denies nested-wildcard access again, including intended MFA administrators. |
| A forgotten bypass flag causes one persistent enqueue attempt per scoped login, enrollment-page, or sudo request through a bypass branch, throughout the day; successful attempts each add a job even after the daily warning. | Medium | Persistent event queue, worker throughput, and notification latency. | The subscriber checks persisted daily rows before recipient resolution and ACL fanout. Use the measurement and producer-throttle trigger below; disable the emergency flag when the incident ends. | Daily notification deduplication does not reduce enqueue or worker-dispatch volume; queue load scales with bypass requests and retries until the flag is disabled or a throttle ships. |
| Queue unavailability, enqueue timeout, RBAC error, database lock failure, or worker failure delays the warning. | Medium | Emergency-access requests and administrator notification delivery. | Login and sudo wait at most two seconds; enrollment middleware does not await enqueue. Report enqueue failures, observe late rejections, and retry persistent subscriber failures. Commit recipient creation atomically with its deduplication guard. | A failed enqueue can lose that observation until another request; page-process termination can interrupt its unawaited enqueue. A timed-out enqueue may still complete, with persisted deduplication guarding replay. |
| A delayed event is delivered after the operator disables bypass. | Low | Administrator interpretation of notification copy. | Describe the observed incident and retain its original observation day instead of asserting the current flag state. | Administrators may receive a historical warning and must check current configuration. |
| All notification rows for a scoped day are deleted, then another request or retry observes that day. | Low | Daily warning deduplication. | Keep normal read/dismiss actions from deleting rows; document that deletion removes the durable marker. | Another broadcast that day is allowed after all matching rows are deleted. |

### Deferred producer throttle: measurement and trigger

Keep the request-per-event producer in this implementation. A process-local memo would add suppression state that can outlive failed delivery, zero recipients, or deletion of the durable daily marker; those retry semantics need explicit tests before introducing it. Persisted daily deduplication remains the source of truth.

During a bypass incident or representative load test, measure bypass-event enqueues per minute and per tenant/organization/day, their share of persistent jobs, and queue age plus enqueue-to-notification latency. Revisit a bounded process-local `(tenantId, organizationId, UTC day)` throttle if bypass events account for at least 10% of persistent jobs for 15 consecutive minutes, or if they cause the oldest queued job or p95 notification latency to exceed 60 seconds for five consecutive minutes. These are decision thresholds for follow-up work, not metrics or automatic throttling added by this feature. Any throttle must retain persistent deduplication, bounded memory, retry after enqueue failure, and documented zero-recipient/deletion behavior.

## Migration & Backward Compatibility

Notification contracts are additive: a security notification ID, internal event ID, exported helper/event validator, and optional trailing batch-service options/type. Preserve existing call compatibility, log text/fields, ACL IDs, DI keys, and bypass behavior. No database migration or API payload change is required.

The shared enabled-module correction is an **effective-permission change**, not merely an MFA recipient detail. After the module registry initializes, the previous filter discards nested role and per-user ACL grants such as `sales.order.*`, `catalog.product.*`, `auth.users.*`, and `security.mfa.*`. Resolving the owning module retains those grants for canonical authorization across **all enabled modules**, so existing stored wildcards can grant matching features that were previously denied. Stored grants and public signatures do not change, but authorization outcomes can. Exact grants, module-level wildcards such as `security.*`, and global `*` retain their semantics; disabled modules, removed features, and tenant/organization restrictions still take precedence.

**Operator action BEFORE upgrading:** audit both role ACLs and per-user ACLs for every nested wildcard, enumerate its matching features in each enabled module, and identify users inheriting the role grants. Remove an unintended wildcard or replace it with explicitly approved feature IDs before upgrading. After upgrading, verify representative users in their tenant and organization scopes. Module authors must use canonical scoped authorization and must not rely on nested wildcards being discarded. Implementation PR #7619 includes this disclosure in `UPGRADE_NOTES.md` and the existing enterprise MFA specification; retain it in the release guidance.

Rolling back notification delivery stops new alerts; existing rows can be dismissed normally. Reverting the shared wildcard correction separately returns nested grants to the prior denied behavior and can remove intended access, including MFA-management access. Review the audited ACLs before that rollback; neither rollback removes persisted grants or notification rows.

## Research

[Keycloak's server administration guide](https://www.keycloak.org/docs/26.5.7/server_admin/index.html) separates security event logging from event listeners and notifications. Reuse Open Mercato's event/subscriber and notification facilities for that separation; do not add another delivery framework.

## Integration Coverage

Ship an executable enterprise integration scenario for bypass-enabled login through notification API delivery, repeated login deduplication, ordinary-user exclusion, and notification-center rendering. Fixtures must be self-contained and removed in teardown. Run against an enterprise server with bypass enabled; explicitly skip when that server configuration is unavailable. Unit coverage exercises flag-off and all detection branches, scoped fanout options, duplicate/read/dismissed suppression, concurrency lock use, daily rollover, malformed scope, and retry after failure. Run existing notification recipient/service tests and registered-module policy regressions to verify exact, module, nested, and global wildcard behavior, including disabled modules, off-convention aliases, removed features, and invalid scopes.

## Implementation Plan

### Phase 1: Notification delivery

1.1 Add notification metadata, translations, scoped event and subscriber with durable daily deduplication.

1.2 Wire the existing login, enrollment and sudo bypass branches through the central helper while keeping logs unchanged.

### Phase 2: Verification and documentation

2.1 Add regression and integration coverage; update the enterprise MFA spec changelog.

2.2 Run the configured validation gate using the local runner, review the diff independently, and publish implementation evidence and limitations.

## Final Compliance Report — 2026-10-25

The original design review covered root, enterprise, core (events, notifications, ACL), shared (feature policy), UI (notifications), events, auth, and QA guidance. This revision rechecked the specification checklist, shared feature policy, auth ACL rules, compatibility contract, and #7619's published implementation and upgrade disclosure. No cross-module relationships, new entity, cache, production dependency, or rendering code. Scopes are required; recipients use canonical authorization. Existing UI and translation conventions apply. Risks now include severity, affected area, mitigation, and residual risk. The platform-wide effective-permission change requires the pre-upgrade role and per-user ACL audit above; independent re-review remains required.

## Changelog

- 2026-10-25: Addressed review 5643603760: disclose the shared nested-wildcard effective-permission change, pre-upgrade role/per-user ACL audit and rollback impact; complete the risk checklist, define a measured producer-throttle trigger, qualify the daily broadcast guarantee after deletion, and align enrollment enqueue behavior with implementation PR #7619.

- 2026-10-18: Initial design for issue #5523; independent review confirmed scope cohesion. Implementation review moved strict deduplication into the notification-service write transaction to prevent connection-pool starvation from nested service forks. Resolved delivery-cap and link-permission findings by using canonical recipient resolution plus explicit RBAC and batch delivery, and omitting inaccessible navigation.

- 2026-10-18: Live exact-versus-nested-wildcard testing found an existing shared owning-module resolution defect; include its minimal correction and registered-module regression tests so the promised administrator audience is honored.

- 2026-10-18: Failure-path review added a two-second enqueue deadline and hanging/late-rejection regressions so a reconnecting queue cannot block emergency access.
