# Security event alerting

> **Program:** package G2 of [`../../GDPR/2026-11-15-gdpr-ready-deployments-program.md`](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-13-sign-in-activity.md`](../2026-11-13-sign-in-activity.md) (#8106), which is specified and not implemented, and on the OSS spec [`../../GDPR/2026-11-16-export-audit-event.md`](../../GDPR/2026-11-16-export-audit-event.md). The 11-13 spec already covers the notice a user gets about their own sign-in from a new device, and decides that sign-ins refused by the rate limit stay silent; this spec keeps both.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/enterprise/2026-11-13-sign-in-activity.md
Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Nothing in the product tells a tenant's administrators that something may be wrong: a hundred failed sign-ins against one account, a wave of locked portal accounts, a user exporting fifty thousand customer records, a new API key, MFA switched off for an administrator. For most of these there is not even an event to build a signal from — two events that look as if they exist are declared and never emitted. **Proposed (future):** four small additions to OSS so that these things can be seen at all, and an enterprise feature that turns them into alerts: a list for administrators, a notification, and one event a tenant can forward to its own monitoring through the existing webhooks. Protected producers also commit a minimal owner receipt with their change. Enterprise evaluates recoverable occurrences even when queue publication is interrupted.

An alert is a prompt to look. Under GDPR Art. 33 the 72 hours run from the controller becoming aware of a breach with reasonable certainty, not from an alert; the alert is what starts the assessment.

**Not in this spec:** the sign-in log and the new-device notice (the 11-13 spec); sign-ins refused by the rate limit, which that spec keeps silent so that a flood cannot turn into database writes; blocking or locking anything; anomaly detection beyond fixed thresholds; alerting the operator of an installation, as opposed to a tenant.

## 📝 Overview

> **Market reference.** GitLab, Okta and Google Workspace ship the same short list of administrator alerts — repeated failed sign-ins, suspicious sign-in, bulk export or download, privilege changes — each a fixed rule with a threshold an administrator can change, delivered by email and available to an external monitoring system. Adopted: that list, fixed rules, adjustable thresholds, one outward event. Rejected: scoring and machine-learned anomaly detection, which need data this product does not collect.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Edition | Enterprise, in the `security` module, with additive seams in OSS | The program places it there, beside the sign-in log. The seams are events; they are useful to anyone. |
| 2 | Who is told | Users of the organization who hold the alerts feature | Role names can be changed; a feature cannot be faked. In practice administrators already hold it through the `security.*` wildcard. |
| 3 | Delivery | A list page and a notification. One persistent event per alert for webhooks | Every channel exists already. A webhook is the route to an external monitoring system. |
| 4 | Thresholds | Per tenant, with defaults; each rule can be switched off | Decided: the rule table's defaults. They err towards fewer alerts: ten failures in ten minutes is well above mistyping, five distinct accounts locked in an hour is a wave rather than one forgetful customer or one account under repeated guessing, and 5,000 rows of one kind in an hour is beyond routine work. Every rule starts on, so a tenant that never opens settings is still covered; a tenant can change any threshold or switch a rule off. |
| 5 | Sign-ins refused by the rate limit, and attempts with an email that matches no user | No rule | The limiter runs before the user is looked up, so there is nobody to attribute them to, and the 11-13 spec keeps refusals silent on purpose. Stated as a limit. |
| 6 | Does an alert do anything | No | Locking an account on a threshold is a way to lock out the real owner. |
| 7 | What an alert stores | Counts, ids, the rule and times. No address, no email, no exported data | The sign-in log and the audit log hold the detail, under their own access rules. |
| 8 | How long one condition stays one alert | Until someone acknowledges it | Fixed time buckets either split one burst across a boundary or raise an alert per bucket for hours. |
| 9 | Who sees an alert with no organization, and where it goes | Holders of the alerts feature whose organization scope is every organization of the tenant. It is forwarded to no webhook | Decided. A webhook belongs to one organization, and an event with no organization reaches every organization's webhooks, so not forwarding is the only choice that sends nothing to an organization that would not see the alert. Unrestricted holders still see the alert in the list and are notified of it. |
| 10 | How long signals and alerts are kept | Signals 7 days, never less than 2. Alerts 365 days after acknowledgement, or after their last signal while open | Decided. A signal is of no use once it lies outside every window, and a window is at most 24 hours, so a week is ample and two days is the floor. An alert is evidence for an investigation that may start months later; 365 days is also the program's default age for privacy evidence. Both ages are operator settings. |
| 11 | Default privileged features | `auth.acl.manage`, `auth.roles.manage`, `auth.users.create`, `auth.users.edit`, `api_keys.create`, `security.admin.manage`, `security.sudo.manage`, `security.alerts.manage` | Decided. These can grant access, mint credentials, or weaken monitoring, security policies or step-up protection. The default applies until a tenant replaces it, so the MFA and privileged-change rules work without setup. |
| 12 | Holds over alert history | The declared retention sets use the shared runner and skip a tenant with any active subject hold | Decided. Counts grouped by organization cannot be attributed to every person they concern, so both sets take DEC-C's conservative `hold_not_honourable` skip, and no unguarded deletion path exists. Without a guard, expiry runs only for a positively clear never-protected OSS baseline; required/unknown protection refuses through D3's latch. |

## 📝 Problem Statement

| Signal | Today | Evidence |
|---|---|---|
| Failed staff sign-in | A legacy event with the submitted email and reason. The 11-13 spec adds a separate scoped failure receipt and an optional attempt-id-only history wake-up | `auth/api/login.ts:162, 198` |
| Portal account locked after five failures | The event is declared and never emitted. The lock is a blind SQL update that returns nothing | `customer_accounts/events.ts:7`; `services/customerUserService.ts:91-105`; `api/login.ts:111` |
| A role or user gains or loses features | Nothing is emitted by the two commands that change them; the role-updated event carries no feature change | `auth/commands/acl.ts:403-487` |
| MFA changes, emergency bypass, failed step-up | Events. `security.mfa.removed` carries only the user, the method and its type, with no tenant or organization. Neither it nor `security.mfa.reset` is emitted persistent, so both are delivered inline at most once. Only the bypass event is persistent and scoped | `enterprise/…/security/events.ts:5-37`; `services/MfaService.ts:209-213`; `services/MfaAdminService.ts:117-126`; `lib/security-config.ts:197-201` |
| API key created | No event; the module declares none. Keys are also minted by the assistant, by agents, and per session | `api_keys/`; `ai_assistant/api/mcp-key/route.ts:46`; `agent_orchestrator/lib/identity/agentTokenService.ts:75`; `apiKeyService.ts:248` |
| A list exported | Nothing; the export-audit spec adds an entry and an event | — |

- **Persistent events are delivered at least once**, so a subscriber may see one twice (`packages/events/src/bus.ts:681-695`).
- **A subscriber is given no occurrence id by the bus.** Its context holds the resolver, the event name, the tenant and the organization (`packages/events/src/bus.ts:442-447`). A redelivery can be recognised only by an id that the payload carries.
- **An event with no organization is sent to every organization's webhooks in the tenant** (`packages/webhooks/…/subscribers/outbound-dispatch.ts:68-107`). The dispatcher filters by organization only when the payload has one (`:96-103`). A webhook always belongs to one organization (`webhooks/data/entities.ts:71-72`); there is no tenant-level webhook.
- **Roles have no organization.** Roles and role ACLs carry a tenant only (`auth/data/entities.ts:76-84, 279-288`), so a change to a role's features belongs to no organization.
- **Telling administrators is possible.** The `security` module already has a subscriber that notifies by feature, using `createBatch` with a group key because `createForFeature` cannot skip an existing group (`security/subscribers/mfa-emergency-bypass-notification.ts:49-66`; `notifications/lib/notificationService.ts:279`).
- **A notification type is opt-out-able or not as a whole**, not per channel.
- **Module configuration is last-write-wins** (`configs/lib/module-config-service.ts:176-204`).
- **Feature matching must understand wildcards**: administrators hold `security.*` (`security/setup.ts:5-6`).

## 📝 Proposed Solution

### OSS seams (additive)

1. **`customer_accounts.user.locked`** is actually emitted. The lock update returns a transition only when `locked_until` was null or not future before this update and is future after it. The same tenant-scoped, row-locked statement reads the old value and performs the update; reaching five is not the test, since the failure counter survives expiry. Extensions of an already active lock do not emit. The result includes the committed transition time, and the account owner commits the matching receipt with the lock transition and its dispatcher emits the event with the tenant, the organization, the user id, the time and an `occurrenceId`. **In the same change its declaration loses `portalBroadcast: true`**, and so does that of `customer_accounts.user.unlocked`, which carries the same flag and is also never emitted (`customer_accounts/events.ts:7-8`).
   - **Why.** The portal event bridge sends a broadcast event whose payload names no recipient to every portal session of the tenant and organization (`customer_accounts/api/portal/events/stream.ts:140-149, 192-198`).
   - **The leak.** Emitted as declared, every connected customer would see other customers' ids and lockout times. Anyone holding a portal account could also fail five sign-ins on a guessed email and watch the stream to learn whether that email has an account.
   - **What it defeats.** The login route gives one response and equal timing on every failure branch so that this cannot be learned (`customer_accounts/api/login.ts:97-112`).
   - **What remains.** The two events stay server-side events for subscribers such as this module's rule.
2. **`auth.acl.changed`** — emitted by the two commands that change features, for a role or for a user, with the features added and removed, whether super-administrator status changed, the tenant, the user's organization for a user (a role has none), and an `occurrenceId`. A user being given or losing a role emits the same event with role ids and the effective concrete features gained and lost. The auth-owned helper takes authorization snapshots before and after the mutation under the existing authorization-state locks, using the uncached policy calculation on the transaction manager. It preserves the exclusive per-user ACL override, disabled-feature and wildcard rules of `rbacService`; subtracting raw role grants is insufficient. It also computes the old and new effective super-administrator flag. Commit the matching authorization receipt in that same outer transaction. Dispatch only after commit. Rollback leaves neither the change nor an occurrence.

   All writers use this helper: `auth/commands/{acl,users,roles}.ts` including undo/redo and restore paths; `auth/cli.ts`; `auth/lib/{setup-app,executionPrincipal}.ts`; SSO `services/accountLinkingService.ts`; agent orchestration `lib/identity/agentPrincipalService.ts`. The latter two call an auth-owned DI service, `authorizationChangeService`, without new cross-module table reads. Role ACL changes emit one role delta; user-role or user-ACL changes emit one effective user delta. No-op provisioning emits nothing. Each event carries `origin`: `bootstrap` from `auth/lib/setup-app.ts` while it initializes a tenant (its first roles and administrator, before any alert recipient exists); `provisioning` from `auth/lib/executionPrincipal.ts` and `agent_orchestrator/lib/identity/agentPrincipalService.ts` when they create or re-scope a machine identity; `change` from every other writer. The privileged-change rule ignores `bootstrap`, since the installer is the only actor and nobody could act on the alert. It treats `provisioning` like `change`: a machine identity that gains a listed feature or super-administrator status is a privileged change, so provisioning one raises one high alert per principal, and principals whose scoped role ACL holds no listed feature raise nothing. Missing alert settings use the defaults below.
3. **`api_keys.key.created`** and **`api_keys.key.deleted`**, emitted by the service that every path uses, with ids, the tenant, the key's organization when it has one, and a kind specified by the caller, as the caller table below defines. `CreateApiKeyInput` gains optional `creationKind`; omitted means `unknown`, never inferred from the key name. Known in-tree callers always pass it. Session creation in the service emits `session`; deletion carries the stored kind. A nullable `creation_kind` column preserves it; existing rows and old callers map to `unknown`. The key id identifies the occurrence: a key is created once and deleted once. **Volume.** `session` keys are minted per assistant chat session (`apiKeyService.ts:248`) and `one_time` keys per `withOnetimeApiKey` call (`:475-485`), so persistent emission would add two queue jobs per such key on hot paths that no rule alerts on. Events of kind `session` and `one_time` are therefore emitted with `{ persistent: false, tenantId, organizationId }`: no queue job, inline delivery only, and the rule subscriber returns on kind before any database work. Every other kind uses the persistent options below. Expected persistent volume is then one job per deliberate, assistant, agent or unknown key creation or deletion. Alertable user-key events use an API-keys-owned receipt in the same transaction as the persisted key mutation. Preserve the existing hot-path exclusions.
4. **`audit_logs.export.completed`** — from the export-audit spec. Its `id` is the export's own generated id. The audit owner commits it with the action-log entry before protected response delivery. Consume its pending-receipt feed as well as its event.

**Emission.** All OSS seam event declarations have `excludeFromTriggers: true`: internal subscribers still consume them, but workflow triggers and outbound webhooks do not. The export spec owns that declaration for `audit_logs.export.completed`. Each seam is emitted with `{ persistent: true, tenantId, organizationId, skipPersistentSubscribersInline: true }`, except the `session` and `one_time` key events of seam 3, which are non-persistent. Persistence and trusted scope follow the bypass event (`security/lib/security-config.ts:197-201`); skipping inline persistent subscribers is added explicitly, so the worker handles retries even with single delivery off. For the portal-lock and ACL seams, `occurrenceId` is a UUID generated once before the first emit. The API-key seam instead uses the key's `id`; the export seam uses the export's `id`, exactly as its API Contracts specifies. No consumer invents another occurrence field. The key travels in the payload and survives queue retries. Each seam carries `occurredAt`: the producer's occurrence time (the committed lock transition for portal lockouts), never subscriber processing time. Every field is additive.

**Durable source receipt.** The module committing a protected transition stores the scoped occurrence under the same active transaction manager and before the outer commit. Lockout transitions, effective ACL changes, tracked user-key lifecycle, and MFA removals and resets each use their own transaction owner. A transaction-aware owner adapter also records each alertable bypass observation in a short scope-bound transaction before marking it captured. Keep the G1b lifecycle receipt as the single occurrence when it represents the same MFA transition and has the exact tenant/organization, identity, timestamp and failure semantics. A transient publisher callback, queue job id, caller claim and notification delivery are insufficient.

Each owner keeps a bounded batch of pending occurrences queryable through registered owner DI services. The adapter is `SecuritySignalReceiptSource`: `pagePendingTenants({ after?, limit }): Promise<{ tenantIds: string[]; next?: string }>`, followed by `pagePending({ tenantId, after?, limit }): Promise<{ occurrences: SecuritySignalReceipt[]; next?: string }>` and `getPendingOccurrence({ tenantId, organizationId, eventName, occurrenceId }): Promise<SecuritySignalReceipt | null>` for wake-ups. Call `acknowledge({ tenantId, organizationId, eventName, occurrenceId, consumer: 'security.alerting' }): Promise<void>` only after the scoped evaluation/decision commits. Limit is 1–100; tenant enumeration is a privileged system-worker capability returning only the owner's tenants with pending receipts, including soft-deleted tenants, never receipt values. Tenant cursors bind the owner; occurrence cursors additionally bind the verified tenant. No security settings/alert row or prior event is required for discovery. Persist a fair owner/tenant turn in the security worker and resume it after every bounded page; failed tenants do not starve later tenants. Tenant-specific callers cannot invoke the system enumerator. Each source validates its own payload and scope and rejects unregistered consumer adapters, stale or wrong-scope acknowledgements and unknown occurrence identities. Use module-prefixed DI keys `customerAccountsSignalReceiptSource`, `authSignalReceiptSource`, `apiKeysSignalReceiptSource`, `securitySignalReceiptSource` and the export carrier’s audit-owned receipt service via its adapter. Enterprise calls these APIs and never reads or mutates producer tables. A facade can reuse an owner’s existing outbox when it implements these semantics. At activation enumerate every required installed producer. Missing adapters or missing registered recovery are an explicit unavailable rule and block a protected readiness claim.

The shared internal `SecuritySignalReceipt` envelope has `tenantId: string`, `organizationId: string | null`, `occurrenceId: string`, `occurredAt: string` and a closed `eventName` discriminant. Its event-specific `facts` are the corresponding alert rule’s validated inputs projected to only the required values. Use the identities in the idempotency table, including the organization/day key for emergency bypass. Validate the discriminator, facts, scoped identities and ISO occurrence time before commit and again before handing the receipt to the worker. The sign-in failure projection carries the canonical user id and closed reason. The export projection carries the trusted actor, record kind, scope and row count. The envelope carries no address, network identifier, credential, exported content or free text.

The durable collection worker discovers tenants through each owner's `pagePendingTenants` and pages sources per tenant with bounded work on the existing security delivery schedule. Protected events only wake an exact-scope source read. For staff failures, use the minimal `authSignalReceiptSource` with the trusted event scope and `attemptId` when the optional G1 wake-up arrives. The failure result, user and occurrence time come from the verified G2 receipt. The worker does not read the separate G1 history receipt. They cannot create an evaluation or a decision marker when the source is absent, terminal or unavailable. The scheduled path recovers a pending source even if no wake-up arrives. Evaluate and commit once under the original occurrence id/time before acknowledging, including disabled-rule and outside-window decisions. If acknowledge fails after the transaction commits, the durable decision marker covers the repeated acknowledgement even without a signal or alert. Pending evidence remains available for owner repair and aggregate age diagnostics. An outage can delay detection without losing a committed occurrence.

**Decision settlement and expiry.** The source adapter also provides exact-scope `readDecisionSettlement({ tenantId, organizationId, eventName, occurrenceId, consumer: 'security.alerting' })`, yielding `{ status: 'terminal', settlementId, settledAt, retryNotAfter }` only after it has durably closed the consumer obligation and can state the last admissible producer retry. Other results are pending, absent or unknown. Require explicit `observeDecisionSettlement({ tenantId, organizationId, eventName, occurrenceId, settlementId, consumer: 'security.alerting' })` acknowledgement for that exact terminal proof before the source may discard the terminal record needed by the marker. These are idempotent owner-only operations. Copy the terminal timestamps and computed expiry durably into the security marker before observing settlement. Revalidate source scope, identity and clocks. A missing, wrong-scope or unreadable source can never prove terminal status. Compute `delete_after` as the latest of the source retry deadline, 24 hours after source settlement and 48 hours after occurrence (the maximum rule window plus one day). The existing security delivery sweep reserves bounded pages of at most 100 each for unobserved settlement and eligible marker expiry, rotates fairly by tenant and coalesces continuations. Persist observation after the idempotent owner confirmation. Delete exactly the scoped marker under its row lock only after terminal proof and observation are persisted and the deadline has passed. A crash before observation retries the exact handshake; retained completed markers do not depend on a source row after observation. Source-pending, malformed or unreconciled markers are preserved and reported. Delayed wake-ups beyond expiry still require a live pending source, so they cannot regenerate a decision.

`OM_SECURITY_SIGNAL_RECEIPTS=report|require` controls the new receipt precondition for covered owner transitions, distinct from the export carrier’s release policy. Introduce additive storage and equivalent reporting for one compatibility minor with default `report`. Explicit `require` refuses/rolls back a covered mutation if its receipt cannot be committed, using the owning route’s sanitized unavailable handling. Portal lockout is the security-first exception to rolling back the covered mutation: never roll back a lock transition merely because a separate receipt destination fails. In require mode the account owner first persists the transition plus immutable occurrence id/time and a pending-receipt flag in its own locked user state in one transaction. The owner migration adds nullable `lockout_receipt_occurrence_id` and `lockout_receipt_occurred_at` plus `lockout_receipt_pending` (default false) to its user record, advances `updated_at` with the transition and indexes pending rows by tenant/id. The occurrence contains no credential, address or failure text. That minimal state is itself the durable recovery source; its adapter can page it even when the normal receipt table is unavailable. A savepoint isolates optional outbox insertion failure from the required lock/pending-state commit. Do not overwrite pending transition facts; acknowledge only after durable evaluation, and preserve the required pending denial state across correct-password attempts, reset-counter writes and retries until recovery settles. Before clearing or reusing pending fields, transfer the exact occurrence to a durable owner terminal proof for the settlement protocol. Failure to commit that transfer keeps the pending flag. Clearing the flag cannot shorten `locked_until`. If even that owner transaction cannot commit, return the existing sanitized authentication-unavailable/refusal outcome and mint no session; unavailable owner state also denies subsequent authentication. This pending denial is set only for a transition admitted in require mode. In report mode commit the existing lock state and attempt the receipt best-effort using the savepoint. A separate receipt outage creates no admission flag or extended lock. Once the original locked_until expires, the legacy credential/session decision applies even if report-only evidence was unavailable. Report mode never clears a pending obligation created under require. Report sanitized degraded coverage. Both modes still refuse when the account owner itself cannot establish current state. Test a receipt-table failure at the locking attempt followed by a correct password, recovery, and another correct password before the original lock expires: none issues a session. This owner-local pending state receives C5 runtime-state classification and C8 exclusion, bounded settled cleanup and no secret payload. If a surface needs a different safety response, its owner and maintainer must supply and test an explicit disposition before that installation can claim coverage for it. A post-commit queue outage never causes a committed mutation to be undone or repeated. After the compatibility minor and protected owner tests, a separate rollout gate enables require for production installations claiming protected G2. Report mode can keep legacy behavior with an explicit incomplete-audit diagnostic. No optional event consumer is required for business deployments outside claimed protected G2. An absent active receipt/sweep rejects that protection claim. The 11-13 sign-in carrier must prove a committed minimal G2 receipt and an independent sweep before its rule counts as durable. Unmatched accounts produce no receipt and use the common generic-refusal budget when the protected mode is active. Rate-limited requests remain outside that budget.

### Security-module events (additive)

5. **MFA removal and reset evidence.** Declare `security.mfa.removal_recorded` and `security.mfa.reset_recorded` as internal, `excludeFromTriggers: true`, with no client or portal broadcast. Their trusted scope comes from the removed method or reset target, including a canonical null organization. Their validated facts carry the owner occurrence id/time, target id, and nullable `targetPrivileged` computed with the uncached RBAC helper and the effective tenant rules before owner commit. A privilege check failure records null without blocking the credential operation. Capture the tenant/organization and immutable facts in the owner transaction. When G1b represents the same mutation, its single committed receipt serves this G2 projection through the adapter. The post-commit wake-up is persistent with `skipPersistentSubscribersInline: true`. Both old `security.mfa.removed` and `security.mfa.reset` preserve their payload, producer-derived dispatch scope and delivery options. The legacy removal remains unscoped. Previously deliverable raw reset routing remains unchanged, including the existing tenant-wide fan-out when a legacy reset contains a tenant and null organization. No newly resolved scope, privilege decision, occurrence correlation or notice facts are added to either raw event. Prior to the separately approved first-party notice cutover, keep the existing notice subscriber on the legacy reset and do not create a notice from the internal event. For cutover, pause MFA writes, drain earlier first-party reset notifications and deploy the switch to one internal notice subscription on every active worker before re-enabling writes. The new subscriber uses the exact scoped reset occurrence, validates the target and deduplicates by occurrence id. Keep the bounded existing reset-notice reason on the internal reset envelope for the notice subscriber only. Never copy it into the G2 signal receipt, decision marker, alert or outward payload. Ordinary raw event consumers keep their old event. An email accepted before a transport failure may repeat. Obtain the existing delivery-policy approval before changing the first-party reset notice path.

### Rules (enterprise)

| Rule | Fires when | Default | Subject (`subject_kind`, `subject_id`) | Qualifier | Severity | Depends on |
|---|---|---|---|---|---|---|
| MFA weakened | MFA removed or reset for a privileged user; emergency bypass detected | Each occurrence | `auth:user`, target user; bypass uses `directory:organization`, organization id | Empty | high | Scoped, persistent MFA events in Phase 1 |
| Privileged change | A role or user gains a listed effective feature or super-administrator status | Each occurrence | `auth:role` or `auth:user`, changed target id | Empty | high | Seam 2 |
| Portal lockouts | Distinct accounts become locked in one organization | 5 distinct accounts in 1 hour | `directory:organization`, organization id; distinct locked users share this group, and each user counts once per window however often it re-locks | Empty | warning | Seam 1 |
| API key created | A key of kind `user` is created | Each occurrence | `api_keys:key`, key id | Empty | warning | Seam 3 |
| Large export | Rows of one kind exported by one actor within a window | 5,000 in 1 hour | `auth:user` or `api_keys:key`, actor id | Exported `resourceKind` | warning | Seam 4; audit owner receipt required and G2 recovery enabled |
| Repeated failures | Failed sign-ins for one user | 10 in 10 minutes | `auth:user`, failed user id | Empty | warning | The 11-13 spec's minimal `authSignalReceiptSource`; a G1 wake-up is optional |

**When the MFA rule decides “privileged”.** Apply the decision table after validating the event scope. A known privileged emission remains alertable after later access revocation. When the event is legacy or its check failed, a successful delivery check can still prove the target non-privileged. A deleted target or failed delivery check raises for every emission state. The producer still never blocks the MFA operation on a privilege lookup.

| Privileged at emission | Privileged at delivery | Confirmed non-privileged at delivery | Target deleted, missing or RBAC check failed |
|---|---|---|---|
| `true` | Alert | Alert | Alert |
| `false` | Alert | No alert | Alert |
| `null` or absent | Alert | No alert | Alert |

Severity is the closed set `warning | high`, mapped to `status-warning-*` and `status-error-*` tokens respectively. Feature tests use the server RBAC policy, including wildcard expansion and disabled features. A configured pattern matches active concrete feature ids with the shared matcher; `*` and `<module>.*` are supported. Super-administrator gains always count. An empty list is valid, explicitly warned about in settings, and disables feature-based matching but not super-administrator gains or bypass detection. A rule's window is one minute to 24 hours.

`security_alert_settings` is seeded idempotently by `setup.seedDefaults` and `onTenantCreated`, with all rule switches on and the table's thresholds and assumption 11's list. A missing row is created with the same defaults by the settings service using a tenant-unique upsert, so existing tenants are covered too. Never overwrite a tenant's saved list. Read `rule_settings` by merging each missing known-rule key with that release's shipped enabled/threshold/window defaults; preserve explicit saved false, zero where valid, thresholds and windows. Validate merged known keys and reject malformed saved values rather than treating them as missing. Newly delivered rules therefore activate with their declared defaults without rewriting existing choices. `alert-settings.test.ts` upgrades an earlier-phase partial object, preserves disabled/edited existing rules and verifies each later rule is enabled with defaults. Both settings reads and writes require unrestricted organization scope. A registered non-undoable settings command audits the old/new thresholds, switches and feature list; disabling a rule or raising a threshold is visible in that entry. A new rule about settings changes is outside this packet.

### How a rule counts

Each rule is a persistent subscriber. For each event it runs one database transaction:

1. it takes a transaction-scoped advisory lock on the tenant, the null-safe organization, the rule, the subject kind/id and the qualifier (empty unless an export resource kind), with `pg_advisory_xact_lock(hashtextextended(key, 0))` as `packages/core/src/modules/resources/lib/resourceTypeLock.ts:3` does, so that two workers cannot evaluate at once;
2. it inserts a signal — tenant, organization, rule, subject, quantity, the optional counting id, time, and the source key from the table below — with `on conflict do nothing`. The counting id is set only by the portal-lockout rule, to the locked user's id. If no row is inserted, the event was seen before, and the transaction ends there;
3. it reads the latest `acknowledged_at` for that full group under the same lock. Only signals whose `occurred_at` is strictly after that cutoff are eligible; delayed pre-acknowledgement events stay deduplicated but cannot reopen an alert. For a signal at time `t`, evaluate windows ending at `t` and at every stored eligible signal time in `[t, t + window]`. Each sum uses `[end - window, end]` and the acknowledgement cutoff. A window's value is the sum of `quantity`, except for a rule whose signals carry a counting id, where it is the number of distinct counting ids in the window: a portal account that re-locks every fifteen minutes (`customer_accounts/services/customerUserService.ts:8-9`) counts once, so one account under sustained guessing never reaches a five-account threshold. This finds crossings even when earlier events arrive late;
4. if the greatest sum reaches the threshold, update or insert the group's open alert. `count` is the peak: the highest window value (sum or distinct count) observed since the last acknowledgement. It never decreases, rises only when a window exceeds every earlier one, and a tie leaves it unchanged; two disjoint windows of equal size therefore leave it equal. A signal is *qualifying* when it lies in at least one evaluated window whose value reaches the threshold. `first_seen_at` is the earliest qualifying signal time since the alert opened and never moves later; `last_seen_at` is the latest qualifying signal time and never moves earlier, so a late-arriving earlier signal cannot lower it, while continued activity at or above the threshold keeps advancing it. Different export kinds never share a lock, sum or alert.

A failure at any step rolls the whole transaction back, the signal included. The subscriber rethrows, the queue redelivers the event, and the redelivery is evaluated as if it were the first. Nothing is sent from inside the transaction.

The organization is compared null-safely. An event with no organization counts towards the tenant-wide value only, never towards an organization's, and an organization's events never count towards another's.

| Rule | Event | Source key |
|---|---|---|
| MFA weakened | Internal `security.mfa.removal_recorded`, `security.mfa.reset_recorded` | The committed owner `occurrenceId` |
| MFA weakened | `security.mfa.emergency_bypass_detected` | The organization and the UTC day of `observedAt`: one signal per organization and day, the grouping the existing bypass notice uses |
| Privileged change | `auth.acl.changed` | Its `occurrenceId` |
| Portal lockouts | `customer_accounts.user.locked` | Its `occurrenceId` |
| API key created | `api_keys.key.created` | The key id |
| Large export | `audit_logs.export.completed` | The export's `id` |
| Repeated failures | Scoped failure receipt from `authSignalReceiptSource`; optional id-only `auth.login.attempted` wake-up | The 11-13 spec's owner `attemptId` |

The stored key is prefixed with the event id. An event that lacks its key is skipped, with a warning that holds no personal data and a `reportError`, as the 11-13 spec does for a legacy payload; no key is invented from ids or times. An event whose own time is older than the signal retention creates no signal or alert. A verified still-pending durable source may commit only its terminal outside-window decision marker before acknowledgement; an absent or terminal source wake-up performs no writes. A replay cannot recreate a pruned signal or raise a stale alert.

There is at most one open alert per tenant, organization, rule, subject and qualifier, enforced by a partial unique index. It stays open until someone acknowledges it: `last_seen_at` advances with every qualifying signal and `count` never decreases, rising when a busier window occurs. Acknowledgement and evaluation take the same group lock. After acknowledgement only fresh occurrences count towards the next crossing; at threshold two the first fresh signal opens nothing and the second opens one. The cutoff is read from retained acknowledged alerts; it outlives every retained signal, so no separate cursor table is needed.

### An alert

- A row: rule, severity, organization, subject, count, first and last time seen, state, and a notification time.
- **Its organization** is the event's: the portal account's, the user's, the key's or the export's. An alert with none is *tenant-wide*. Every privileged change to a role is tenant-wide, because a role has no organization; so is an alert about a user, a key or an export that has none.
- A notification to users in the alert's organization who hold the alerts feature. For a tenant-wide alert, only holders whose organization scope is every organization of the tenant are notified: `rbacService.loadAcl` returns `organizations: null` for them (`auth/services/rbacService.ts:518-521`). It is sent by a small worker that picks up alerts with no notification time, so that a retry after the insert cannot lose it or send it twice. The worker runs after each commit and on a schedule, and uses the alert id as the group key with `skipExistingGroup`. The type cannot be opted out of.
- A persistent event, `security.alert.raised`, with the typed payload in API Contracts, including `tenantId`, rule, subject, qualifier and count. The same worker emits it before it sets the notification time, so a retry may emit it twice and a consumer recognises the repeat by the alert id. A tenant-wide alert emits none (assumption 9).
- A page, Security › Alerts, with a link to the sign-in log or the audit log filtered to the same subject and time. Acknowledging records who and when.
- A settings section for thresholds and switches.

### Design decisions

| Decision | Rationale |
|---|---|
| Signals in the module's own table, each with a key from its event | Counting must not query another module's tables, and redelivery must not double-count. |
| A key that the producer generates, defined per rule | A subscriber gets no occurrence id from the bus, and a key built from ids and times either merges distinct events or splits one. |
| Signal, sum and alert in one transaction | A failure after the signal insert would otherwise mark the event as seen and lose its crossing. |
| One open alert per tenant, organization, rule, subject and qualifier | See assumption 8. |
| A transaction-scoped lock per tenant, organization, rule, subject and qualifier | Two workers evaluating one burst would otherwise both insert; a transaction lock is released on rollback. |
| The organization in every counting lock, sum and open-alert index | A subject active in two organizations would otherwise have its activity merged into one alert owned by one of them. |
| Tenant-wide alerts are not forwarded | See assumption 9. |
| Signals and alerts pruned by age from Phase 1 | Each row names a subject. See assumptions 10 and 12; holds can delay expiry. |
| Notification by a worker from the alert row | The same pattern the 11-13 spec uses for its new-device notice. |
| Rows carry the organization | So that the list, the recipients and the webhook dispatch all respect it. |
| Settings in a table of their own | Module configuration cannot detect a concurrent edit. |
| Nothing is blocked | See assumption 6. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Counting from the sign-in log and the audit log directly | Cross-module table reads. |
| Fixed time buckets with a unique index | See assumption 8. |
| An event for every refused sign-in | See assumption 5. |
| A built-in connector to a monitoring product | The webhook is the connector. |
| Lock accounts automatically | See assumption 6. |
| Counting and privilege rules off until a tenant sets its own thresholds or feature list | A tenant that never opens settings would have no detection; defaults that err high, with per-rule switches, cover it (assumptions 4 and 11). |
| A tenant-wide alert forwarded as one event per organization, with `tenantWide: true` | Sends tenant-level activity, such as a role change, to the endpoint of every organization, including those whose administrators cannot see the alert (assumption 9). |
| Alerts kept 90 days, the sign-in log's window | Too short for an investigation that starts months after the alert (assumption 10). |

### Known limits

- Attempts with an email that matches no user, and sign-ins refused by the rate limit, raise nothing.
- A slow attack under every threshold is not seen.
- An export through direct database access or an API client paging JSON is outside the route-based rule. The protected rule requires the audit owner’s durable release receipt and a ready recovery consumer. Missing audit wiring and report-only deployments are shown as unavailable or unprotected, and a committed receipt survives lost enqueue.
- Nothing here tells the operator of an installation. A host that is a processor for its tenants has its own duty to notify them and needs its own monitoring.
- A tenant-wide alert, such as a privileged change to a role, reaches no webhook (assumption 9).
- An alert is eligible at its declared age; holds or unavailable scheduling/runner can delay expiry. The logs it links to may have gone sooner.

## 📝 Delta

### Capability: security-event-alerting

#### ADDED Requirement: Alerts for administrators
The system SHALL raise an alert to an organization's authorized users when a configured threshold is crossed, and SHALL keep one open alert, not many, while the same condition continues.

##### Scenario: Portal lockouts
- WHEN the threshold number of portal accounts are locked within the window
- THEN one alert is listed and authorized users are notified once

##### Scenario: The condition continues
- WHEN more qualifying lockouts follow while the alert is open
- THEN `last_seen_at` advances, `count` never decreases and rises only if a window now holds more distinct accounts than any earlier one, and no second alert or notification is produced

##### Scenario: After acknowledgement
- WHEN the alert is acknowledged and the threshold is crossed again
- THEN a new alert is raised using only signals after acknowledgement; with threshold two the first new signal raises nothing and the second raises one

##### Scenario: The same event delivered twice
- WHEN an event is redelivered
- THEN it is counted once

##### Scenario: Evaluation fails after the signal is written
- WHEN the evaluation fails after inserting the signal and the event is redelivered
- THEN the event is counted once, and a crossing it causes raises the alert

##### Scenario: Earlier occurrence delivered late
- WHEN two signals within one window arrive in reverse time order at threshold two
- THEN the second insertion finds their common window and raises one alert

##### Scenario: Separate export kinds
- WHEN one actor exports two kinds and neither kind reaches its threshold
- THEN their counts are not combined and neither raises an alert

##### Scenario: MFA removed by its owner
- WHEN a user who holds a privileged feature removes one of their MFA methods
- THEN an alert is raised in the organization of that method

##### Scenario: Large export
- WHEN a user exports more rows of one kind than the threshold within the window
- THEN an alert names the user, the kind and the count

##### Scenario: One subject in two organizations
- WHEN a user exports rows in two organizations and only one organization's rows reach the threshold
- THEN one alert is raised in that organization, counting only its rows, and the other organization has none

##### Scenario: Rule switched off
- WHEN a tenant has switched a rule off
- THEN nothing is raised for it

##### Scenario: Another organization
- WHEN an alert is raised in one organization
- THEN users of another organization in the tenant neither see it nor are notified

##### Scenario: A tenant-wide alert
- WHEN a feature on the privileged list is granted to a role
- THEN the alert has no organization, and only holders whose organization scope is every organization see it and are notified

#### ADDED Requirement: Durable capture of protected security occurrences
The owner SHALL commit its protected occurrence with the mutation that generated it. The consuming worker SHALL recover pending receipts after lost publication and deduplicate by trusted occurrence key. A source that cannot prove or recover its mandatory receipt SHALL report unavailable or unprotected.

##### Scenario: Consumer and publisher failure
- WHEN a guarded ACL change commits and the process dies before publishing its event
- THEN the owner receipt survives, and a scheduled recovery pass commits and acknowledges one scoped decision
- WHEN the protected receipt fails before owner commit
- THEN the mutation rolls back without an event and the owner returns its closed error outcome

#### ADDED Requirement: Forwarding
The system SHALL emit one event per alert that has an organization, which that organization can subscribe a webhook to, and SHALL forward no alert that has none.

##### Scenario: Webhook
- WHEN an alert is raised and its organization has a webhook for the alert event
- THEN that webhook, and no other organization's, receives the rule, the subject's id and the count

##### Scenario: Raw seam subscribed by a webhook
- WHEN a webhook subscribes to an OSS seam, including a tenant-wide role grant
- THEN no delivery is created because the seam is excluded from triggers

##### Scenario: A tenant-wide alert is not forwarded
- WHEN an alert with no organization is raised in a tenant whose organizations have webhooks for the alert event
- THEN none of those webhooks receives it

#### ADDED Requirement: Bounded retention
The system SHALL delete eligible signals and alerts through their declared retention sets at the configured ages, subject to DEC-C holds and the acknowledged-alert safety cutoff below. A missing runner or skipped held set SHALL remain visible, not count as successful expiry.

##### Scenario: Restricted settings editor
- WHEN a feature holder restricted to one organization reads or changes tenant-wide settings
- THEN the route returns 403 and nothing changes

##### Scenario: Concurrent acknowledgement
- WHEN two acknowledge commands submit the same open alert version
- THEN one changes the row and emits the acknowledgement event and the other receives a version conflict

##### Scenario: Old signals
- WHEN the retention job runs
- THEN signals older than the signal retention are gone and newer ones remain

##### Scenario: An open alert still active
- WHEN an open alert had a signal within the alert retention
- THEN it is kept

##### Scenario: An old event replayed
- WHEN an event older than the signal retention is delivered again
- THEN nothing is written

#### MODIFIED Requirement: Portal lockout event
The system SHALL emit the declared lockout event when a failed sign-in locks a portal account.

##### Scenario: Fifth failure
- WHEN the fifth consecutive failure locks the account
- THEN the event is emitted once, with the tenant, the organization and the user

##### Scenario: Other portal users
- WHEN a portal account is locked while other portal users of the same organization are connected to the portal event stream
- THEN none of them receives the lockout event, because neither lockout event is declared for portal broadcast

Frozen by: `packages/core/src/modules/customer_accounts/__tests__/login-lockout-event.characterization.test.ts`

## 📝 Architecture

- **OSS**: `customer_accounts`, `auth` and `api_keys` own their transition and transactional signal receipt and expose their bounded recovery adapter. The independent audit owner supplies export receipts. The same trigger-excluded events wake subscribers. The established `session` and `one_time` key exclusions remain.
- **Enterprise `security`**: `data/` — signals, alerts, settings; `subscribers/` — one per rule; `lib/alerting/` — the transaction, the lock, the idempotent signal, the window sum, the open-alert rule, the shared retention predicates and the bound handler; `services/MfaService.ts` and `services/MfaAdminService.ts` — scoped internal persistent MFA evidence and frozen legacy emissions; `workers/` — notification delivery with the outward event, and retention; `api/alerts`, `api/alert-settings`; the backend page; `notifications.ts`; `events.ts`; `privacy.ts` — the table declarations.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| OSS → `security` | Events plus owner-registered scoped receipt adapters and bounded acknowledgement. | An absent protected source or recovery schedule makes its rule unavailable. |
| `security` → administrators | `notificationService.createBatch` with a group key | Notifications module absent: the list page still shows alerts |
| `security` → external monitoring | `security.alert.raised` through webhooks, for an alert that has an organization | No webhook, or a tenant-wide alert: nothing leaves |
| `security` → scheduler | Retention, pending-receipt recovery and the delivery sweep, through the soft-optional `schedulerService` | No scheduler: automatic pruning and the sweeps do not run; explicit retention commands remain available; settings says so |
| `security` → retention runner | `privacyRetentionService.run`, the record-retention spec's API Contracts and Implementation Plan steps 1–2 | Missing runner: no private delete loop; report retention unavailable |
| A seam not yet shipped | Both its event and required owner receipt capability govern protected readiness. | That rule is listed in settings as unavailable. |

### Frontend architecture contract

| Route | Server root | Client islands | Data owner |
|---|---|---|---|
| `/backend/security/alerts` | `page.tsx` | `AlertsTable`, `AlertRuleSettings` | `api/alerts`, `api/alert-settings` |

| Budget | Value |
|---|---|
| New page-root client files | 0 |
| Client files over 300 lines | 0 |
| Heavy browser libraries | 0 |
| Hydration and interaction test | TC-SEC-ALERT-001 |

`DataTable` for the list, `CrudForm` for settings, `useGuardedMutation` for acknowledge, semantic status tokens for severity, locale keys in the enterprise locales.

## 📝 Data Models

All four security-owned tables carry UUID `id`, `tenant_id` and `created_at`. Signals, alerts and receipt-decision markers carry nullable `organization_id`; settings has no organization column because it is strictly tenant-wide. A null organization is the tenant-wide value. Every lock key, index and unique index that includes the organization uses `coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)`, as `entity_index_jobs_scope_unique` does (`packages/core/src/modules/query_index/data/entities.ts:100`), so that two tenant-wide rows collide and an organization's rows never match another's or the tenant-wide ones.

Producer receipt rows are owned by the module whose mutation commits them. Reuse an equivalent owner outbox or add a scoped runtime-state table with tenant and nullable organization, event kind and immutable occurrence id, committed occurrence time, minimal validated event facts and pending/ack timestamps. Uniqueness is tenant, event kind and occurrence id, with exact organization stored and rechecked on every read and transition. The G2 worker commits a scoped receipt-decision marker in the evaluation transaction for every durable-source decision, including decisions that create no signal. The exact source uniqueness serializes retries and recovers commit-before-ack outcomes. Shared G1b occurrences freeze both required consumers at commit. The same owner terminal proof may support each independent observation, and cannot be removed before every required projection has observed it. Neither table stores credential values, addresses or exported contents. Include owner registration/cleanup and C5/C8 runtime-state coverage in the carrier that adds each table.

| Table | Columns |
|---|---|
| `security_alert_signals` | `rule`, `subject_kind`, `subject_id`, `qualifier` (non-null text, default empty), `quantity`, `counted_id` (nullable UUID; the locked portal user for the lockout rule, null otherwise), `occurred_at`, `source_key`. Unique on tenant, rule and `source_key`: producer UUIDs/key ids are globally unique, and the bypass key already includes organization. Indexed on tenant, organization, rule, subject, qualifier and `occurred_at`, and on `occurred_at` for retention |
| `security_alerts` | `rule`, `severity`, `subject_kind`, `subject_id`, `qualifier` (same normalization as signals), `count`, `first_seen_at`, `last_seen_at`, `state` (`open` \| `acknowledged`), `notified_at?`, nullable `notification_completed_at` and `event_completed_at`, nullable `notification_outcome` (`delivered\|suppressed`) and `event_outcome` (`published\|not_applicable`), `acknowledged_by?`, `acknowledged_at?`, `updated_at`. Unique on tenant, rule, null-safe organization, subject kind/id and qualifier where state is open. A check constraint pairs each completion timestamp with its terminal outcome and allows `not_applicable` only on a tenant-wide alert. Indexed on the full group plus `acknowledged_at` for the cutoff, on `acknowledged_at` and on `last_seen_at` for retention |
| `security_alert_settings` | One row per tenant, unique `tenant_id`, no `organization_id`: `rule_settings` JSONB with a switch, threshold and window of one minute to 24 hours per known rule, `privileged_features` JSONB with the validated list of feature IDs, and `updated_at` |
| `security_alert_receipt_decisions` | `source_owner`, closed `event_name`, UUID `occurrence_id`, `occurred_at`, `decided_at` and closed `decision` (`counted\|disabled\|outside_window`), nullable `source_settlement_id`, `source_settled_at`, `source_retry_not_after`, `delete_after` and `settlement_observed_at`. Uniqueness on tenant, null-safe organization, source owner, event name and occurrence id. Index pending observation by `(tenant_id, id) WHERE settlement_observed_at IS NULL` and terminal expiry by `(tenant_id, delete_after, id)`. Use exact scope and a row lock at deletion. No sensitive event facts. |

**Retention.** The security module owns two sets under the [record-retention spec](../../GDPR/2026-11-16-privacy-record-retention.md), API Contracts. The whole-object registry and member validation follow **R3-2 — The registry carries the whole `privacy.ts` default export** in the contract spec. A job runs them through `privacyRetentionService.run`; there is no separate destructive path for those two sets. They delete:

- signals whose `occurred_at` is older than `OM_SECURITY_ALERT_SIGNAL_RETENTION_DAYS` (default 7; a value under 2, the longest window plus a day, is raised to 2);
- acknowledged alerts whose `acknowledged_at`, and open alerts whose `last_seen_at`, is older than `OM_SECURITY_ALERT_RETENTION_DAYS` (default 365; the effective window for acknowledged rows is at least the signal-retention window plus one day, so their cutoff cannot disappear while an old signal can still be counted).

| Set | Declaration | Eligibility |
|---|---|---|
| `security.alert_signals` | `minimumDays: 2`, `targets: ['records']`, `excludableSubjectKinds: []`, `unmatchedHoldsOptOut: 'forbidden'`, `handlerService: 'securityAlertSignalRetentionHandler'` | `occurred_at` before the fixed cutoff at the configured effective signal age |
| `security.alerts` | `minimumDays: 1`, `targets: ['records']`, `excludableSubjectKinds: []`, `unmatchedHoldsOptOut: 'forbidden'`, `handlerService: 'securityAlertRetentionHandler'` | Open: `last_seen_at` before the fixed cutoff. Acknowledged: `acknowledged_at` before the composed cutoff of the greater of alert age and signal age plus one day. Both require terminal notification and outward-event delivery; pending or unknown delivery is ineligible regardless of age |

Both declare locale-key `title` and `ageBasis` and implement the owner's exact `pruneRecords` input/result. The shared parser used by replay rejection and both handlers reads the existing environment settings; invalid values fall back with a safe diagnostic. Alert age is a positive integer, minimum one day. A handler refuses a caller window shorter than its configured age; a longer window is valid. It applies the service's fixed `cutoff` once and orders keysets by immutable `(created_at, id)`. For the acknowledged-row safety predicate, reconstruct the same fixed run-start time as `cutoff + olderThanDays`, then subtract the effective signal window plus one day; this additional cutoff can only keep an entry longer. It never uses the batch's current clock. Bind the effective windows to the continuation; changed windows require a fresh preview. Return `matched`, `deleted`, `next`, `done` and `filesPending: 0`. Each batch is at most 100, as the shared handler contract requires.

Under **DEC-C — Retention sets and holds**, a registered `privacyRetentionGuard` is checked before preview and each apply batch. With either set's empty `excludableSubjectKinds`, any subject exclusion skips the set with `hold_not_honourable`; a failing registered guard refuses. Both handlers also refuse nonempty `excludeSubjects` if an engine policy permits unmatched holds; both sets also declare `unmatchedHoldsOptOut: 'forbidden'`, so the DSR engine's policy validation refuses the opt-out before a pass runs. Assumption 12 does not offer that opt-out for these unattributable counts. Held entries keep their original ages and expire after release. The automatic job supplies no unmatched-hold opt-out. Holds exist only with the enterprise engine, as **R3-5 — Holds, honestly** states in the program's Known limits; without its guard only explicit command exclusions apply. These are subject-linked security records, not an unguarded expired-token prune. The existing sign-in-retention worker remains owned by the 11-13 spec; this change makes no claim to alter its hold behavior. The shared driver's post-commit rule remains **R3-8 — Retention drains its own pending file deletions**; these handlers produce no pending files and add no drain of their own.

The daily system schedule has a stable UUID derived from `security:alert-retention`, following the 11-13 spec's stable-UUID schedule pattern. It discovers tenant ids from the security module's own two tables and calls the shared runner with `{ tenantId }`, never with null tenant scope; it caps total examined work at 5,000 rows per invocation and persists a round-robin `(tenantId, setId)` turn plus each lane's keyset cursor. Reserve one page of at most 100 per runnable lane, alternating signals and alerts; after each page advance the durable turn even when that lane remains backlogged. Exhaustion of the invocation budget enqueues one coalesced continuation with the next turn. New tenants join the next cycle; errored/held lanes report their state and yield to others. Duplicate workers use a fenced compare-and-set on the coordinator cursor. The daily job reports `backlog_growing` if prior work remains. Tests sustain more than 5,000 newly eligible signals per day and prove alert and second-tenant progress across crash/resume. No database batch exceeds 100. No scheduler means no automatic run; the operator may use `mercato privacy retention` for either set. A missing runner reports retention unavailable and deletes nothing. It takes no counting lock: eligible signals lie outside every window, and an event that old creates no signal or alert. Only a verified still-pending durable source may commit its outside-window decision marker through the separate settlement protocol; absent or terminal source wake-ups perform no writes. The tables are new, so deletion starts with the first configured run, subject to holds.

The tables store ids, counts, timestamps and validated rule and configuration fields. They add no encryption-map entries. The module declares its four tables using the [table-coverage spec](../../GDPR/2026-11-16-privacy-table-coverage.md), API Contracts: `tables.security_alert_signals = { personalData: { kind: 'retention_bounded', boundedBy: 'security.alert_signals' } }`, `tables.security_alerts = { personalData: { kind: 'retention_bounded', boundedBy: 'security.alerts' } }`, and settings as `tenant_configuration` with a required reason and per-column review of its rule/feature configuration. A bare environment-variable name cannot satisfy `boundedBy`. Preserve the existing `dataClasses` and other members when adding `retentionSets` and `tables` to `privacy.ts`. Declare `tables.security_alert_receipt_decisions = { personalData: { kind: 'runtime_state', note: 'Scoped acknowledgement deduplication through confirmed source settlement and retry expiry' } }`; review any rule-5 column individually with the snapshot. These markers use the bounded security-owned cleanup above, independent of both subject-linked retention sets. Alerts are not `reference_only`, because they hold counts about a named user. The acknowledgement cutoff survives at least the signal-retention window plus one day; deleting an old acknowledged row cannot reactivate retained signals. A hold can keep it longer. Neither table is erased with a subject: a user's signals and alerts are security records, kept until the declared retention set removes them, with hold delays and unavailable scheduling stated.

**C8 tenant exit.** In Phase 1, register or extend the helper-built `securityPrivacyTableReader` through the security module’s DI and add `tableExports` entries for `security_alert_signals`, `security_alerts`, `security_alert_settings` and `security_alert_receipt_decisions` in the same `privacy.ts` declaration. Supply `count` and paged reads in both export and scan modes using the same scope predicate. Require the exact tenant for every row. The C8 reader takes `tenantId` and includes that tenant’s signals and alerts from its organizations and its tenant-wide null-organization rows. Settings are tenant-wide. Organization ids never substitute for tenant attribution. Keep the existing enterprise security registrations and coverage. These declarations follow [C8’s reader contract](../../GDPR/2026-11-16-tenant-exit-export.md) and are delivery prerequisites for G6.

- `security_alert_signals` uses that reader with `redact: [{ columns: ['source_key'], reason: 'may_embed_secrets' }]`. The internal source-deduplication key adds no value to the portability artifact. Keep scoped typed ids, validated rule and qualifier, quantities and times.
- `security_alerts` uses the same reader, with the scoped typed ids, validated status, severity, rule and qualifier, counts and times, including both nullable delivery completion timestamps and their closed outcome fields. The reader projects the full inventory without reconstructing delivery from `notified_at`. The schema accepts registered subject kinds and UUID subject ids. It stores no raw identifiers or lookup keys in these columns.
- `security_alert_settings` uses the same reader with explicit `json` export decisions for `rule_settings` and `privileged_features`. The former contains only validated rule codes, flags and numeric bounds. The latter contains configured ACL feature IDs, which convey no access on their own. Each decision records that rationale in the declaration. If a later schema stores another text or JSON column, supply its reviewed decision in the same change.
- `security_alert_receipt_decisions` declares `exclude: { reason: 'runtime_state' }` with the same exact-tenant owner reader and scoped scan/attribution. No marker row enters the portable export.


**Retention bounds.** The set references alone do not satisfy the table-coverage spec's **Retention bounds for independent verification** or the record-retention spec's **The handler**, so `privacy.ts.retentionBounds` gains two `PrivacyRetentionBoundDefinition` entries of `kind: 'retention_set'`. Each bound id equals its `retentionSetId`, `handlerService` is `securityAlertRetentionBounds`, and each has one whole-table target. The rule ids name the shared predicates in `lib/alerting/retention.ts` that the deleting handlers also use. The columns are the complete reviewed allowlist for each new table; a later column needs its own review.

| Bound id / `retentionSetId` | Table | Exact permitted columns | `ageAnchor` | `eligibility` |
|---|---|---|---|---|
| `security.alert_signals` | `security_alert_signals` | `counted_id`, `created_at`, `id`, `occurred_at`, `organization_id`, `qualifier`, `quantity`, `rule`, `source_key`, `subject_id`, `subject_kind`, `tenant_id` | columns `occurred_at`; rule `security.alert_signal.occurred` | `security.alert_signal.any` |
| `security.alerts` | `security_alerts` | `acknowledged_at`, `acknowledged_by`, `count`, `created_at`, `event_completed_at`, `event_outcome`, `first_seen_at`, `id`, `last_seen_at`, `notification_completed_at`, `notification_outcome`, `notified_at`, `organization_id`, `qualifier`, `rule`, `severity`, `state`, `subject_id`, `subject_kind`, `tenant_id`, `updated_at` | columns `state`, `last_seen_at`, `acknowledged_at`; rule `security.alert.state_anchor`: `last_seen_at` while open, `acknowledged_at` once acknowledged | `security.alert.expired_with_signal_floor` |

`securityAlertRetentionBounds` is registered in `security/di.ts` and implements C5's `PrivacyRetentionBoundHandler` read-only, on the supplied manager, with no write, enqueue or foreign table read. `resolve({ scope, boundId, now, em })` returns the declared target exactly, with:
- `effectiveWindow: { value, unit: 'days' }` from the shared parser: the effective signal age for signals, or `max(alertAge, signalAge + 1)` for alerts (the conservative set-wide envelope); exact row evaluation below distinguishes the shorter open-alert lifetime;
- `mode: 'delete'`, or `'pending'` while the system job holds an outstanding continuation for the tenant and set; `countingGraceEndsAt: null`, since the tables are new and have no counting period;
- `enabled: false`, `mode: 'off'` and `unboundedReason: 'retention_runner_unavailable'` when `privacyRetentionService` is not registered;
- `scheduled: true` only when the soft-optional `schedulerService` reports the `security:alert-retention` schedule registered and enabled;
- `workerState` as the scheduler reports it, otherwise `'unknown'`, never inferred from the schedule;
- `unboundedReason: 'hold_not_honourable'` when a registered `privacyRetentionGuard` returns any subject for the scope. A failing guard makes `resolve` throw, which is a verification gate, never an exemption.

`evaluateFixtureRow` reads the row by id within the scope. It returns `not_found` for a missing or out-of-scope row, and `unbounded` with the projection's reason when there is one. For an alert with either delivery obligation pending/unknown, return `unbounded` with reason `delivery_pending`, matching deletion ineligibility. Otherwise it returns `within_window` or `expired`, with `anchorAt` and `expiresAt`: a signal expires at `occurred_at` plus the signal age; an open alert at `last_seen_at` plus the alert age; an acknowledged alert at `acknowledged_at` plus the greater of the alert age and the signal age plus one day. `reason` is the rule id, and no row value is returned. Adding the entries preserves the default object's other members under R3-2. `alert-retention-bounds.test.ts` sets alert age below signal age plus one and checks the conservative envelope, exact open/acknowledged expiry and deletion parity; it also preserves undelivered expired alerts until both obligations settle.

## 📝 API Contracts

| Route | Feature | Notes |
|---|---|---|
| `GET /api/security/alerts` | `security.alerts.view` | Scoped to the selected organization. A tenant-wide alert is included only for a caller whose organization scope is every organization, which is stricter than the 11-13 list's treatment of rows with no organization. Filters by rule, state, time; page size at most 100 |
| `POST /api/security/alerts/:id/acknowledge` | `security.alerts.manage` | Zod UUID; registered command `security.alert.acknowledge`; tenant and selected/allowed organization predicate on the row; a tenant-wide row requires unrestricted organization scope; otherwise 404. Returns the row including `updatedAt` |
| `GET`, `PUT /api/security/alert-settings` | `security.alerts.manage` plus unrestricted organization scope | Both return 403 for a restricted principal. PUT runs `security.alert_settings.update` with mutation guards, audit log and optimistic locking; GET and PUT return `updatedAt`; zod validates switches, thresholds, windows and patterns |

**Acknowledge command.** Route and command resolve trusted auth scope and run mutation guards before and after. The command first resolves the scoped row's group without locking the row, takes the counting group advisory lock, then reloads the scoped row with a row lock. Evaluation uses the same group-then-row order. The command calls `enforceCommandOptimisticLock` with the expected header and `updated_at`. A stale version returns the shared 409 body, including on a second concurrent acknowledgement. With the current version, acknowledging an already acknowledged row returns it unchanged: no extra audit entry, cutoff advance or event. A real transition updates `acknowledged_by`, `acknowledged_at` and `updated_at`, writes one non-undoable action-log entry, and emits `security.alert.acknowledged` after commit for an organization-scoped row. List and mutation responses include `updatedAt`. The UI uses `useGuardedMutation`, `withScopedApiRequestHeaders(buildOptimisticLockHeader(record.updatedAt), ...)` and `surfaceRecordConflict`; settings use `CrudForm` with `initialValues.updatedAt`.

**Typed seam payloads.** The producing module validates each with zod; UUID ids, ISO times and nonnegative integer counts are required. `organizationId: string | null` is the persisted object's scope, not client input. The OSS seam events are persistent, skip persistent inline delivery, and declare `excludeFromTriggers: true`; `session` and `one_time` key events are the non-persistent exception under seam 3.

```ts
type Occurrence = { tenantId: string; organizationId: string | null; occurrenceId: string; occurredAt: string }
type PortalLocked = Occurrence & { userId: string }
type MfaRemovalRecorded = Occurrence & { targetUserId: string; targetPrivileged: boolean | null }
type MfaResetRecorded = MfaRemovalRecorded & { noticeReason: string }
type AclChanged = Occurrence & {
  subjectKind: 'auth:user' | 'auth:role'; subjectId: string
  featuresAdded: string[]; featuresRemoved: string[]
  roleIdsAdded: string[]; roleIdsRemoved: string[]
  wasSuperAdmin: boolean; isSuperAdmin: boolean
  origin: 'bootstrap' | 'provisioning' | 'change'
}
type ApiKeyCreationKind = 'user' | 'assistant' | 'agent' | 'session' | 'one_time' | 'unknown'
type KeyLifecycle = {
  id: string; tenantId: string | null; organizationId: string | null
  createdBy: string | null; kind: ApiKeyCreationKind; occurredAt: string
}
type AlertEvent = {
  alertId: string; tenantId: string; organizationId: string
  rule: string; severity: 'warning' | 'high'; subjectKind: string; subjectId: string
  qualifier: string; count: number; firstSeenAt: string; lastSeenAt: string
}
type AlertAcknowledged = AlertEvent & { acknowledgedBy: string; acknowledgedAt: string }
```

`PortalLocked` is `customer_accounts.user.locked`; `AclChanged` is `auth.acl.changed`; `KeyLifecycle` is used by both key events, with the key's `id` as occurrence key. A system key without tenant is ignored by tenant rules. The export payload is owned by the export-audit spec's API Contracts. The internal `security.mfa.removal_recorded` and `security.mfa.reset_recorded` use the typed owner payloads above, with persistence, skip-inline and trigger exclusion. The G2 source adapter projects only the typed alert facts, never `noticeReason`. The legacy MFA payloads retain their existing fields and delivery. Both alert events use `{ persistent: true, tenantId, organizationId, skipPersistentSubscribersInline: true }`; `security.alert.raised` uses `AlertEvent`, and acknowledged uses `AlertAcknowledged`. Neither emits for a tenant-wide alert. `count` is the peak window value defined under How a rule counts, not a running total. Raised delivery is at least once, deduplicated by `alertId`; acknowledgement publishes from the command. Counts and ids contain no exported content.

| API-key caller (verified current file) | New explicit kind | Creation alert |
|---|---|---|
| `api_keys/commands/keys.ts` and `api_keys/cli.ts` | `user` | Yes; CLI counts as deliberate operator creation |
| `ai_assistant/api/mcp-key/route.ts` | `user` | Yes; explicit user request for an MCP key |
| `ai_assistant/lib/mcp-ensure-api-key.ts` | `assistant` | No; automatic provisioning and rotation |
| `agent_orchestrator/lib/identity/agentTokenService.ts` | `agent` | No |
| `apiKeyService.ts` session-key creation | `session` | No |
| `apiKeyService.ts` `withOnetimeApiKey` | `one_time` | No |
| External callers omitting `creationKind`, and existing rows | `unknown` | No; documented compatibility limit |

**Notification type** `security.alert.raised`, in-app and email, not opt-out-able.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Two workers evaluate the same burst | The transaction-scoped lock serialises them; the partial unique index is the second guard |
| A redelivered event | Its source key already exists; nothing is added |
| The evaluation fails after the signal insert | The transaction rolls back with the signal; the redelivered event is evaluated afresh |
| An event without its source key, from a producer older than its seam | Skipped and reported; never counted under an invented key |
| An event redelivered after its signal was pruned | No signal or alert is recreated. A verified still-pending source may commit only its outside-window decision marker before acknowledgement; absent or terminal source wake-ups perform no writes |
| One user or key active in two organizations | Each organization has its own lock, sum and open alert |
| A user removes their own MFA method | The internal evidence carries the method's tenant and organization; the rule verifies that scope through the owner receipt without a user lookup |
| A privileged target's features are revoked before the MFA event is delivered | `targetPrivileged: true` from emission raises the alert anyway |
| The MFA target is deleted before delivery, or RBAC cannot be read at delivery | Raise for every emission state under the MFA decision table. |
| The transaction commits and the delivery worker fails | The alert has no notification time; the next run or the sweep sends the notification and emits the event |
| An attack that continues for days with nobody acknowledging | One open alert whose last-seen time keeps advancing and whose count shows the busiest window |
| No user holds the alerts feature | The alert is listed; the page says nobody will be notified |
| The acting user is the one being alerted about | They are notified like anyone else who holds the feature; the alert names them |
| An export or a key by an API key | The actor is the key; the alert names it |
| An event with no organization | The alert is tenant-wide: listed and notified only to holders whose organization scope is every organization, and not forwarded |
| An OSS seam event with no organization, such as a role's `auth.acl.changed` | Internal subscribers receive it; `excludeFromTriggers` prevents webhook delivery for both scoped and unscoped raw seams |
| No scheduler | Automatic pruning and the delivery sweep do not run; explicit shared retention commands remain usable, and settings says so |
| A subject hold, an explicit exclusion or a failed registered guard | The shared runner skips with `hold_not_honourable` or refuses; no private prune bypasses it |
| A seam's event is not declared in this installation | The rule is shown as unavailable |
| Thresholds changed while an alert is open | Applied to the next evaluation; only an unrestricted holder can change them; the settings command audits the change |
| A delayed pre-acknowledgement signal | Stored once but excluded by the group cutoff; cannot reopen the alert |
| Two export kinds from one actor | Qualifier keeps their sums and alerts separate |
| An export with several or all organizations selected | The export event carries `organizationId: null` (export-audit spec, the effective filter's single id or null), so the alert is tenant-wide and reaches only holders whose scope is every organization; a one-organization export alerts within that organization |
| Audit receipts unavailable or collector interrupted | The rule shows unavailable for missing required audit wiring. A committed receipt remains recoverable, including when bus enqueue fails or its job disappears. |

### Delivery and bounded retention invariants

Record each delivery obligation independently and durably under its stable occurrence id. Set `notification_completed_at` with outcome `delivered` only after the notification owner confirms durable acceptance, or with `suppressed` after proving there are no eligible recipients/channels under the current policy. Set `event_completed_at` with `published` only after confirmed outward publication for an authorized concrete organization, or with `not_applicable` for a tenant-wide alert, which never publishes. A lookup failure, unknown acceptance or unproven organization is not a terminal outcome. A retry reads both markers and acts only on pending work. Set `notified_at` when notification was delivered and the outward raised-event obligation is terminal. Preserve a null value for a suppressed notification. Deletion and `evaluateFixtureRow` share one terminal predicate checking both timestamp/outcome pairs, including the valid tenant-wide not-applicable state. An unresolved alert returns `delivery_pending` with age and remains ineligible regardless of cutoff. After both obligations settle, the normal age predicates apply.

Declare `(tenant_id, created_at, id)` indexes on both alert tables for the immutable keyset paths, plus `(tenant_id, occurred_at, id)` on signals and `(tenant_id, last_seen_at, id)` / `(tenant_id, acknowledged_at, id)` on alerts for scoped age selection. Keep the existing group/dedup indexes. Migration/query-plan acceptance uses a large two-tenant fixture and verifies bounded indexed pages without repeated full-tenant sorts.

## 📝 Migration & Backward Compatibility

- Three new OSS events and one declared event that starts being emitted; four tables, three routes, two features, one notification type, one page: additive.
- `customer_accounts.user.locked` was declared and silent. A subscriber written against the declaration starts receiving it; the dated entry says so.
- `portalBroadcast` is removed from the `customer_accounts.user.locked` and `customer_accounts.user.unlocked` declarations (`customer_accounts/events.ts:7-8`). This narrows an optional delivery flag on two declared-but-never-emitted events; it is not an event-id or payload change. `BACKWARD_COMPATIBILITY.md` §5 freezes event ids and payload fields, not `EventDefinition` delivery flags, and no in-tree emitter exists (the ids are reused only as notification-type registrations), so no portal client has ever received either event and nothing that works today changes. No bridge is owed, because there is no delivered behavior to bridge, and the Emergency Security Exception is not invoked. Should maintainers treat the flag as contract, the exception applies instead: emitting the event with the flag is itself the account-enumeration vulnerability (Risks, "A lockout reaches other portal users"), and the PR then carries its dated entry and named security-maintainer approval. The `UPGRADE_NOTES.md` entry tells a portal that listens for them to watch its own account state instead.
- The new seam events carry an occurrence key and are emitted persistent with `skipPersistentSubscribersInline: true` from their first release, except `session` and `one_time` API-key events, which are non-persistent so hot paths enqueue nothing. They are internal trigger-excluded declarations; use organization-scoped `security.alert.raised` for forwarding. This applies even with single delivery disabled: persistent alert subscribers stay off the request path. Existing `auth.role.*` events keep their contracts.
- Existing raw MFA event names, payloads and delivery conditions remain stable. Document the two new trigger-excluded internal events and the separately approved first-party reset notice cutover. Existing concrete-organization reset webhook delivery is preserved. No newly resolved organization or tenant/unknown-scope evidence is published to a raw webhook. The G1 handoff similarly preserves raw login events. Its only new wake-up carries an opaque attempt id and trusted scope. G2 reads its own minimal failure receipt and does not enable G1 history capture or load its client evidence.
- The alert, signal and decision tables are new and are pruned under their declared respective lifecycles; nothing that exists today is deleted. `api_keys.creation_kind` is an additive nullable column, generated migration and snapshot; old input signatures stay valid with `unknown`. No existing key is reclassified.
- The owner receipt tables and adapters are additive. Failing an existing protected mutation on loss of its required receipt is a compatibility change. Keep the report-only bridge for at least one minor, followed by the named approved require-mode activation with real scoped fault tests and `UPGRADE_NOTES.md`. Existing event ids, payload fields and trigger rules still apply. No exception is assumed.
- Features: administrators hold both new features through the existing `security.*` wildcard; nothing is added to role defaults.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Signals, alerts, settings, delivery, retention, list page; the MFA rule with scoped, trigger-excluded MFA evidence | Contract Phase 1 for R3-2 and C5's retention-bound contract, which ships with it; record-retention Implementation Plan steps 1–2 for the declared sets and guarded driver  C8 shared reader helper and the existing or same-phase security DI registration |
| 2 | Lockout, ACL and API-key seams in OSS, their owner receipts and three rules | Phase 1 recovery and written DEC-2 carrier approvals for OSS changes |
| 3 | The large-export rule with idempotent receipt acknowledgement | The export-audit spec’s protected release and pending-receipt adapter |
| 4 | The repeated-failures rule | The 11-13 spec’s Phase 1 with independent durable failed-attempt evidence and verified receipt-only recovery. G1 history remains optional. |

## 📋 Implementation Plan

### Phase 1
1. Entities, migration with the null-safe organization indexes, features; merge table classifications and retention sets into the existing `privacy.ts` default object under R3-2. The C5 coverage fixture resolves both `boundedBy` ids through the real sets and requires their owner-local `retentionBounds` metadata; reject missing exact targets, allowed columns, anchors or eligibility identifiers, a bare environment name and unresolved references, while preserving existing classes. Add the two `retentionBounds` entries from Data Models; a set-only declaration fails this gate.
2. The alerting library, with named unit suite `alert-counting.test.ts`: reverse delivery t2 then t1 at threshold two; three out-of-order signals with an intermediate crossing; separate export qualifiers; first and second fresh post-acknowledgement signals; a late pre-acknowledgement event; and under, at and over a threshold; a redelivered event; a failure after the signal insert, then the event redelivered, counted once and the alert raised; two concurrent evaluations; one subject in two organizations and a tenant-wide event, with separate sums and alerts; an event without its source key; an event older than the signal retention; an open alert updated, not duplicated; a new alert after acknowledgement. Count semantics: two disjoint equal-sized windows leave `count` unchanged while `last_seen_at` advances; a busier later window raises it; a late earlier signal never lowers `last_seen_at` or moves `first_seen_at` later. Distinct counting: one portal account re-locking four times in an hour stays at a value of one and never reaches a threshold of five, five distinct accounts reach it, and the same account in two organizations counts in each.
3. Settings defaults, idempotent seeding/upsert, registered update command, route and section. `alert-settings.test.ts`: default privileged list matches wildcard grants; empty/custom replacement list; restricted GET/PUT 403; audit entry; conflicting edit; window over 24 hours refused.
4. The notification type and the delivery worker, which also emits the outward event; the list route and page; acknowledge command. `alert-acknowledge.test.ts`: two concurrent acknowledgements, stale 409, current-version idempotent retry, cross-organization 404, tenant-wide scope, one audit/event on transition and guards; delivery tests: delivery after a failed subscriber; a retry that finds the notification already sent; a tenant-wide alert notified only to holders whose scope is every organization, listed only for them, and settling its outward obligation as not_applicable without emitting an event. Stop after committing only one obligation, restart and verify that just the pending obligation retries and age-based expiry waits. Prove confirmed suppression and intentional event absence settle, while unknown scope or delivery does not.
5. The two `pruneRecords` handlers, the bound handler, their DI keys and the system schedule through the shared runner. `alert-retention.test.ts`: batch limit at most 100, fixed-cutoff/keyset continuation, effective-window changes, minimum signal age, open alert with a recent signal kept, acknowledged safety cutoff, old row deleted and idempotent rerun, and both set declarations carrying `unmatchedHoldsOptOut: 'forbidden'`. `alert-retention-bounds.test.ts` verifies `securityAlertRetentionBounds`: its real DI registration and `resolve`/`evaluateFixtureRow` methods, effective-window/parser and eligibility parity with deletion for each table/state, exact captured row/column and scope matching, read-only enforcement, the hold, missing-runner and pending projections, and unavailable or unknown scheduling/worker states without a finite-bound claim. Missing or throwing projection/evaluation must block verification. With a registered guard, a subject hold skips both sets even under an engine unmatched-hold policy, failure refuses, and release permits expiry at the original age; no scheduler leaves explicit commands usable, no runner deletes nothing. TC-SEC-ALERT-005 covers the real shared-service path.
6. Add the internal MFA projections, source receipt and scoped decision marker with settlement and expiry. Test reset-notice deduplication after email failure and queue dispatch with single delivery off. Drive real MFA removal of a canonical null-organization method with exact and wildcard subscriptions in two organizations: internal recovery occurs and neither receives the evidence. Exercise concrete-organization removal/reset and legacy reset forwarding equivalence. Require maintainer approval for the first-party reset-notice cutover. Inject receipt failures before commit and lost wake-up after commit. In a disabled-rule and outside-window case lose the acknowledgement, restart and verify one marker. Test unknown/missing/wrong-scope settlement, durable terminal proof before observation, owner cleanup after observation, expiry under the 100-row cap, and old wake-up after marker deletion creating no new decision. Register the real recovery schedule before activating coverage.
7. The MFA rule, with wildcard-aware matching and the emission/delivery privilege rule. `mfa-rule.test.ts` covers delayed delivery: privileged at emission then revoked before delivery (raises), non-privileged at emission then granted before delivery (raises), non-privileged at both times (nothing), all emission states against deleted, missing and RBAC read failure (each raises), and a null or absent flag with a confirmed non-privileged target (no alert), and the producer's check failing without blocking the MFA operation. Integration test TC-SEC-ALERT-001. Re-run `yarn generate` after changing declarations and commands; update module snapshots for the new columns/tables.
8. `alert-tenant-export.test.ts` asserts owner DI registration and declaration coverage for the four owner tables, count/read parity, keyset pagination and exact tenant attribution in export and scan modes. Test foreign tenant rejection across organizations, included tenant-wide null-organization rows, signal `source_key` redaction with count unchanged, and reviewed settings JSON. Run TC-SEC-ALERT-006 through the Enterprise handover path.

### Phase 2
1. **Characterize** that a fifth failed portal sign-in locks the account and emits no lockout event. Commit alone.
2. OSS: the lock transition and its event, with `portalBroadcast` removed from both lockout declarations; `auth.acl.changed`; the API-key events with a kind. Each is emitted persistent with its scope and carries its occurrence key. `seam-events.test.ts` and per-writer tests: every listed ACL writer (including undo/redo, SSO synchronization, CLI and both principal provisioners), effective wildcard gain under a per-user override, rollback and no-op; one test per API-key caller and legacy `unknown`, asserting that `session` and `one_time` events enqueue no job and that the rule ignores them without a database read; re-lock after expiry versus active-lock extension. Assert each emits once after commit with those options and carries no email, and that neither lockout declaration is a portal-broadcast event (`isPortalBroadcastEvent` returns false for both). Update the characterization test. Co-ship the same-transaction receipt for each applicable owner and its approved DI reader/ack adapter in the writer’s rollout slice. Run TC-SEC-ALERT-007 before reporting each rule as protected.
3. The three rules. Unit tests per rule, including a role change that raises a tenant-wide alert, tenant bootstrap through `setup-app` emitting `origin: 'bootstrap'` and raising nothing, and execution-principal and agent-principal provisioning with a listed feature raising one alert per principal while a principal scoped below the list raises none. Integration test TC-SEC-ALERT-002; its seam subcases cover the real role/user ACL routes, user create/update/undo role assignment, SSO callback, API-key create/delete, explicit MCP-key creation and session-key creation.

### Phase 3
1. Implement the large-export rule with durable owner acknowledgement and both wake/recovery paths. Run TC-SEC-ALERT-003, TC-SEC-ALERT-007 and the export carrier’s TC-AUD-EXPORT-004, including its protected production setting.

### Phase 4
1. The repeated-failures rule, keyed by the attempt id. TC-SEC-ALERT-004 drives the real staff login route below the limiter and recovers through the committed G2 owner source with G1 disabled and no event job. Repeat with G1 enabled and verify optional id-only wake-ups use the same occurrence and decision with no cross-scope reads or client data access. Require the committed receipt and healthy recovery schedule before reporting protected coverage.
2. The outward event's docs with the webhook recipe, stating that tenant-wide alerts are not forwarded and naming the two retention variables; the breach-response page's reference to this list.
3. Archive this Delta into `.ai/specs/capabilities/security-event-alerting.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/customer_accounts/{services/customerUserService.ts,api/login.ts}`, `packages/core/src/modules/auth/{commands/acl.ts,commands/users.ts,commands/roles.ts,cli.ts,lib/setup-app.ts,lib/executionPrincipal.ts,lib/authorization-change.ts,di.ts,events.ts}`, `packages/core/src/modules/api_keys/{events.ts,services/apiKeyService.ts,commands/keys.ts,cli.ts,data/entities.ts,migrations}` | Modify / create |
| `packages/enterprise/src/modules/security/{data,subscribers,lib/alerting,api/alerts,api/alert-settings,backend/security/alerts,workers,notifications.ts,events.ts,acl.ts,setup.ts,di.ts,privacy.ts,i18n}` | Create / modify |
| `packages/enterprise/src/modules/security/services/{MfaService.ts,MfaAdminService.ts}`, `subscribers/mfa-reset-notification.ts`, new `commands/{alerts,alert-settings}.ts` and tests | Modify / create |
| `packages/enterprise/src/modules/sso/services/accountLinkingService.ts`, `packages/enterprise/src/modules/agent_orchestrator/lib/identity/{agentPrincipalService,agentTokenService}.ts` and tests | Modify — ACL helper and key kind |
| `packages/ai-assistant/src/modules/ai_assistant/{api/mcp-key/route.ts,lib/mcp-ensure-api-key.ts}` and tests | Modify — explicit key kinds |
| `packages/enterprise/src/modules/security/__integration__/TC-SEC-ALERT-00{1,2,3,4,5,6,7}.spec.ts` | Create |

## 🧪 Integration Coverage

In the Enterprise test environment with the security module enabled. The receipt-only staff test has a dedicated lane with G1 capture disabled and G2 protected collection active. Thresholds are set through the settings route, which exists from Phase 1, and restored afterwards. Each test creates its own organizations, users, roles and webhooks through the API and removes them in `finally`, because counts and alerts are per organization. Drain the test queue with its integration helper; capture delivery rows rather than sending to external services. Remove test notifications, signals, alerts and webhook deliveries as well as fixture records, and restore the tenant settings even on failure. SSO tests own a local identity-provider fixture and its configuration.

| Test | Covers |
|---|---|
| TC-SEC-ALERT-001 | MFA is reset by an administrator for a user who holds a privileged feature, and another such user removes one of their own MFA methods; each raises one alert in that user's organization; an administrator has one notification per alert; a user without the feature gets 403; the default privileged list raises the alerts without manual list setup; an unrestricted administrator can replace the list; the page loads, lists the alerts, acknowledges one and saves a threshold. A second organization has a feature holder: no list row or notification, and GET/list plus acknowledge-by-id cannot expose or change the first organization's alert (acknowledge returns 404). A restricted holder gets 403 for settings GET/PUT; verify the unchanged settings and command audit entries |
| TC-SEC-ALERT-002 | With the lockout threshold set to two, two portal users are locked by failed sign-ins while a third portal user of the same organization holds the portal event stream open; that stream receives no `customer_accounts.user.locked` frame; one alert is listed; a third distinct user's lockout inside the window raises its count to three and adds no alert or notification; after acknowledgement two further distinct users raise a new one. Two organizations each have a webhook subscribed to `security.alert.raised`: the webhook-deliveries list shows a delivery of the lockout alert for the first organization's webhook only. Create/delete a key through `/api/api_keys/keys`; assert the typed key lifecycle event and creation alert. Explicit `/api/ai_assistant/mcp-key` creation alerts, while `/api/ai_assistant/session-key` creation emits kind session and adds no key alert. Exercise `/api/auth/roles/acl`, `/api/auth/users/acl` and user create/update/undo role assignment; each emits the documented delta, only effective gains alert, and no-op/rollback emits none. Assign a role carrying a listed feature to a user through both the user update route and the real `/api/sso/callback/oidc` flow against the local fixture identity provider: each effective gain raises its user alert. Granting a listed feature to a role raises a tenant-wide alert: no delivery for either webhook; it is listed for an administrator whose scope is every organization and not for one restricted to the second organization. Both organizations also subscribe to `auth.acl.changed`; the role grant creates no raw-seam delivery. The first post-acknowledgement user's lockout creates no alert; a second distinct user's creates one |
| TC-SEC-ALERT-003 | With the export threshold lowered to a few rows, one user exports in two organizations: the organization whose rows reach the threshold has one alert naming the user, the kind and its own count; the other has none. Export two kinds below their individual thresholds and assert they are not combined; then cross one kind and assert the qualifier and payload tenant, organization, actor, rule and count. Add a user allowed two of three organizations who exports with all organizations selected: the event carries `organizationId: null`, the alert is tenant-wide and notifies only holders whose organization scope is every organization; a one-organization export alerts within that organization |
| TC-SEC-ALERT-004 | Create staff users in two organizations and a threshold of two. With history off, drive the real failed-login route and recover two minimal G2 receipts with no history receipt or job. With history enabled, drop one wake-up and redeliver another after recovery. Assert zero alerts after one attempt, one after two, correct `attemptId` deduplication and no row or notification in the other organization. A malformed, conflicting-scope or plausible id-only wake-up without a pending G2 receipt creates no decision. Assert owner, alert and notification evidence contain no copied email, IP or UA from G1. Stay below the real limiter. Restore settings and remove fixture users, roles, receipts, jobs, signals, alerts and notices in `finally`. |
| TC-SEC-ALERT-005 | Own tenants and backdated signal/open/acknowledged fixtures; invoke both declared sets through `privacyRetentionService.run` and the registered job. Correct ages expire, recent rows and the acknowledged safety cutoff remain, another tenant is untouched. With `data_erasure` enabled, create an own subject hold through its API, assert both sets skip, release it and assert original-age expiry. Remove holds, signals, alerts, schedules, jobs and summaries in `finally` |
| TC-SEC-ALERT-006 | Create two tenants, multiple organizations for the export tenant, one organization-scoped and one tenant-wide alert/signal, and settings for both tenants. Run the real Enterprise C8 tenant handover in count, scan and export modes. The four owner table declarations resolve via DI and the manifest names no `reader_unavailable` gap for them. Verify scoped counts, exported alert rows with both completion timestamp/outcome pairs, reviewed settings JSON and marker exclusion with scoped owner scan, null signal `source_key` in the export, and no other-tenant sentinel in any artifact. Withhold one registration in a negative fixture and require the named gap and incomplete result. Clean database fixtures and artifacts. |
| TC-SEC-ALERT-007 | Drive protected real portal lockout, ACL/role, tracked key and MFA owner paths with two tenant fixtures; inject receipt failure before commit, publisher failure/crash after commit, duplicate wake-ups and loss before acknowledgement. Verify atomic owner state, one scoped committed decision per occurrence, no cross-tenant read/ack, successful scheduled recovery with the event queue unavailable, missing adapter/schedule diagnostics and unchanged compatibility responses in report mode. Exercise disabled-rule and outside-window decisions with an interrupted acknowledgement. Verify the equivalent G1b MFA occurrence is reused and the protected export receipt reaches a single large-export decision. Remove all owned user/state/receipt/alert/schedule fixtures in teardown. |

Phase 4 ships only with TC-SEC-ALERT-004 passing in both the receipt-only lane and the independently enabled G1 lane. TC-SEC-ALERT-007 additionally starts with only a producer receipt, no event job, settings or alert rows, and proves scheduled discovery and recovery. Use a valid password after the original lock expires while only the separate receipt store is unavailable. Report mode follows legacy admission and has no extended denial flag. Require mode keeps denying until the pending transition is acknowledged, and acknowledgement cannot shorten the original interval. TC-SEC-ALERT-007 drives deterministic post-commit recovery with an owner-scoped fixture fault. The counting unit tests cover additional cutoff and re-lock boundaries. TC-SEC-ALERT-005 uses backdated owned fixtures for shared-runner retention and holds.

## 📝 Risks & Impact Review

#### Alerts are noise
- **Scenario**: Thresholds are too low for a busy tenant, and administrators stop reading them.
- **Severity**: High
- **Affected area**: the value of the whole feature
- **Mitigation**: One open alert per condition until it is acknowledged; adjustable thresholds; rules can be switched off; defaults err high. Tenant bootstrap (`origin: 'bootstrap'`) raises no privileged-change alert. Expected provisioning noise is stated: an execution principal or agent principal provisioned with a listed feature raises one high alert per principal, which is intended, since a machine identity that can grant access or mint credentials is a privileged change; principals scoped below the list raise none.
- **Residual risk**: A busy tenant may still need to raise a default; until it does, the one open alert per condition limits the noise. A tenant that provisions many privileged agents sees one alert each and may narrow the privileged list.

#### An attack is not reported
- **Scenario**: Attempts use addresses that match no user, are refused by the rate limit, or stay under every threshold.
- **Severity**: High
- **Affected area**: detection
- **Mitigation**: The limits are stated in the docs and on the page.
- **Residual risk**: This is threshold alerting, not intrusion detection, and it has no view of traffic the rate limit turned away.

#### An alert is raised and nobody is told
- **Scenario**: The subscriber fails between the alert and the notification.
- **Severity**: Medium
- **Affected area**: delivery
- **Mitigation**: Delivery and the outward event are a separate worker driven by the alert row, with a scheduled sweep.
- **Residual risk**: A stopped worker; the list page still shows the alert.

#### Counting loses or doubles an occurrence
- **Scenario**: A producer dies after committing a mutation, a queue drops the event, or an event is delivered again after processing.
- **Severity**: High
- **Affected area**: detection; alert counts
- **Mitigation**: The owner commits the occurrence atomically with the change. An owner-registered recovery sweep reads pending state and retries the same occurrence. Counting uses the original time and a durable deduplication marker. Acknowledgement follows commit, so missed delivery and lost acknowledgement have bounded retry semantics.
- **Residual risk**: Historical or compatibility report-mode actions can have no receipt and are disclosed as unprotected. A stopped worker delays alerts and leaves a diagnosable pending age. A bypass detected repeatedly in one UTC day still contributes one occurrence.

#### An alert reaches another organization
- **Scenario**: A tenant-wide alert, or one subject's activity in two organizations, is shown, notified or forwarded to an organization it does not belong to.
- **Severity**: High
- **Affected area**: staff privacy across organizations; external monitoring endpoints
- **Mitigation**: The organization is part of every counting lock, sum and open-alert unique index; global occurrence keys make it redundant in the signal deduplication index. A tenant-wide alert is shown and notified only to holders whose scope is every organization, and is not forwarded. TC-SEC-ALERT-002 and TC-SEC-ALERT-003 use two organizations.
- **Residual risk**: Tenant-wide alerts reach no external monitoring (assumption 9); unrestricted holders see them in the list and are notified. Raw OSS seams are excluded from triggers; existing role events retain their prior delivery contract.

#### Tenant monitoring is weakened
- **Scenario**: A restricted administrator changes tenant-wide switches, thresholds or the privileged list, or an authorized tenant administrator deliberately empties that list.
- **Severity**: High
- **Affected area**: detection for every organization of the tenant
- **Mitigation**: Settings GET/PUT require unrestricted organization scope and the management feature; writes use a guarded, versioned command and audit entry; an empty list has an explicit warning. Defaults apply to new and existing tenants without overwriting saved choices.
- **Residual risk**: An authorized unrestricted administrator can still switch rules off; this spec does not add a separate detector for settings changes.

#### Security history is kept without limit
- **Scenario**: Signals and alerts, each naming a user, accumulate for as long as the installation runs.
- **Severity**: High
- **Affected area**: storage limitation; privacy coverage
- **Mitigation**: Signals and alerts are pruned by age from Phase 1 through two declared retention sets, under the named variables and DEC-C hold guard. Two `retentionBounds` entries and the read-only `securityAlertRetentionBounds` handler give C5 and G6 the exact targets, anchors, effective windows and row evaluation; a hold, a missing runner or an unscheduled job is projected as such, never as a finite bound. A replayed old event writes nothing.
- **Residual risk**: Without the scheduler no automatic run occurs; without the runner nothing is pruned. A subject hold delays expiry and is visible as a skipped pass. Copies in webhook deliveries and in external monitoring are outside it; the sign-in log has its own retention contract.

#### A lockout reaches other portal users
- **Scenario**: The newly emitted lockout event keeps its declared portal broadcast, so the portal event bridge sends it to every portal session of the organization.
- **Severity**: Critical
- **Affected area**: portal users' privacy; account enumeration through the portal
- **Mitigation**: Seam 1 removes `portalBroadcast` from both lockout declarations in the same change that starts emitting `user.locked`. A unit test pins the declarations, and TC-SEC-ALERT-002 asserts that another portal user's stream receives nothing.
- **Residual risk**: A later change that re-adds the flag. The unit test fails if it does.

#### Alerts leak who is being investigated
- **Scenario**: A user sees an alert about a colleague.
- **Severity**: Medium
- **Affected area**: staff privacy
- **Mitigation**: A dedicated feature, off for ordinary users; ids and counts only.
- **Residual risk**: Those who hold the feature see names through the linked logs, as intended.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for events, the frontend architecture contract. Read-only source checks covered the emitters, RBAC, API-key callers, portal lockout, notification deduplication, bus and webhook dispatch; source checks and table validation do not establish implemented behavior.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | The OSS seams are listed and additive |
| No cross-module table access | Compliant | Each producer owns its receipt. A scoped DI adapter reaches producer data and the consumer owns its alert/decision state. |
| Event ids: module, singular entity, past tense | Compliant | — |
| Feature-based guards | Compliant | Two features |
| Optimistic locking on editable records | Required by design | Settings and acknowledge commands; versioned responses, conflict UI and concurrency tests |
| Tenant scoping | Compliant | Signals and alerts carry tenant and null-safe organization in their counting keys; source keys are globally unique; settings are tenant-only and unrestricted; a tenant-wide alert is limited to holders whose scope is every organization and is not forwarded |
| Event contract changes additive | Compliant | Seams are trigger-excluded from first emission; new payload fields are additive; the MFA delivery change is stated, and its PR carries the maintainer confirmation the events Ask First requires. Removing `portalBroadcast` from the two never-emitted lockout declarations narrows a delivery flag outside the frozen id/payload contract, so no bridge or emergency waiver is owed (Migration) |
| Privacy coverage and storage limitation | Compliant by design | Signals and alerts name real sets with windows and conservative holds, and owner-local `retentionBounds` entries with a read-only bound handler share the deleting predicates; settings are tenant configuration |
| Integration coverage | Required by design | TC-SEC-ALERT-001–007 cover scoped alert APIs/UI, hold-aware retention, tenant export and protected outbox fault recovery. |

**Verdict:** ready. The design is decided. Phase 1 waits for the contract and record-retention prerequisites it names; its PR carries the maintainer confirmation of the MFA delivery change that the events Ask First requires. No implementation validation is claimed. Phases 2 to 4 each wait for the OSS seam they name.

## Changelog

### 2026-11-20

- Kept failed-attempt alerting independently recoverable through its minimal auth receipt with history capture off. Treat the id-only history event as an optional wake-up for the exact G2 receipt.
- Kept protected MFA evidence internal, finalized alert delivery markers and their C5/C8 inventory, bounded settled decision-marker expiry, and specified report versus require behavior after the portal lock has expired.

### 2026-11-19 — Confirmed spec review corrections

- Define receipt-only tenant discovery, durable lockout capture, delivery-aware expiry, fair retention continuations, exact bounds/indexes and phased settings defaults. Add failure and acceptance cases; no implementation changes.


### 2026-11-19

- Bind protected alert sources to transactional owner receipts. Recover missed queue publication and delay acknowledgement until a durable scoped decision commits.

### 2026-11-18 — Review remediation

- Use one MFA privilege truth table for the event contract, failed-read behavior and rule test fixtures.

### 2026-11-18

- Assigned C8 declarations, scoped readers and both-mode verification for security alert signals, alerts and settings to G2 Phase 1.

### 2026-11-16
- Written autonomously with resolved assumptions. The program described this package as "brute force, new device, mass export"; the new-device notice is already in the 11-13 spec and is not repeated.
- Revised after independent review. Two rules had no event to consume: the portal lockout event is declared and never emitted, and feature changes emit nothing; both become OSS seams. The throttled-sign-in rule is dropped, because the limiter runs before a user is known and the 11-13 spec keeps refusals silent on purpose. Counting is redesigned: idempotent signals keyed by their event, a lock per rule and subject, and one open alert until acknowledged instead of fixed time buckets. Notifications are sent by a worker from the alert row. Rows, the list, recipients and the outward event carry the organization. Settings have their own table. API-key events carry a kind so that per-session keys do not alert. The export seam moved to its own OSS spec. The legal framing no longer suggests an alert starts the 72 hours.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), critical fix: `customer_accounts.user.locked` is declared with `portalBroadcast: true`. Emitting it as specified would have streamed every lockout to all portal sessions of the organization, an account-enumeration oracle that bypasses the login route's uniform response. Seam 1 now removes the flag from both lockout declarations. Neither event was ever emitted, so this changes no existing behaviour. Added a scenario, a unit test, an integration assertion and a risk entry.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g7-03 — "tenant-level webhooks" do not exist; an alert with no organization is now tenant-wide, shown and notified only to holders whose scope is every organization, and not forwarded (assumption 9, needs confirmation, fallback one event per organization), with a two-organization webhook test. g7-04 — signals and alerts get named retention variables and a batched daily prune in Phase 1, both tables are declared retention-bounded, and replayed old events write nothing. g7-09 — every consumed event carries a producer-generated occurrence key, with the key defined per rule; the seams are emitted persistent with their scope; signal, sum and alert run in one transaction under a transaction-scoped lock, and the outward event moves to the delivery worker. g7-13 — Phase 1 adds the tenant, the organization and an occurrence id to `security.mfa.removed`, an occurrence id to `security.mfa.reset`, and emits both persistent; TC-SEC-ALERT-001 covers a self-removal. g7-14 — the organization is in the lock key, the window sum, the signal index and the open-alert unique index, normalised null-safely, with a two-organization export test.

- Council round two fixes (GPT-6.1 Sol workers): r9-01 — subjects and export qualifiers; r9-07 — guarded, versioned acknowledgement; r9-08 — internal raw seams; r9-12 — effective ACL gains; r9-13 — out-of-order windows; r9-14 — acknowledgement cutoff; r9-15 — unrestricted audited settings; r9-16 — Phase 4 integration; r9-19 — explicit key callers and ACL writers; r9-20 — typed scoped alert payloads; r9-21 — privileged defaults; r9-25 — reset notice deduplication; r9-34 — expired-lock transition; r9-35 — skip inline persistent subscribers; r9-36 — index invariant; g7-22 — cross-organization isolation tests; g7-26 — all authorization writers; g7-28 — existing scoped acknowledge rule made explicit; g7-31 — payloads and manifest; g7-39 — severity and settings seed.

- Council round two fixes, pass two (GPT-6.1 Sol workers): align `boundedBy` with C5's declared retention-set contract; use the shared R3-2/DEC-C driver, batch limit and conservative hold default for alert expiry; correct the export/API-key occurrence-id exceptions and add shared-runner integration coverage.
- Council round two fixes, pass three (GPT-6.1 Sol workers): check the current export, sign-in, table-coverage and retention contracts; preserve assumption 12's conservative hold default even through the shared engine opt-out path, and cite the driver's R3-8 ownership without adding a second drain.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): correct set-id-only C5 coverage and readiness claims, align Phase 1 checks with the owning retention-bound contract, and expose the unresolved security-owned bound and handler/predicate design without inventing bindings.

### 2026-11-17
- MFA rule privilege timing: MFA events carry an emission-time `targetPrivileged` flag; a true flag raises even after a later revocation, a false flag is rechecked at delivery, and a null or legacy flag fails closed for a deleted target or an RBAC read failure. Delayed-delivery unit tests added.
- Counting: the portal-lockout rule counts distinct locked accounts through a new `counted_id` signal column, so one account re-locking every fifteen minutes cannot reach the threshold; `count` is defined as the non-decreasing peak window value, with `first_seen_at`/`last_seen_at`, scenarios, edge cases, payload docs and tests aligned.
- `auth.acl.changed` gains `origin`; tenant bootstrap raises no privileged-change alert, and execution/agent principal provisioning noise is stated and tested. `session` and `one_time` API-key events are non-persistent to keep queue jobs off hot paths.
- The `portalBroadcast` removal is classified as narrowing a delivery flag on never-emitted events, outside the frozen id/payload contract, with the exception route stated if maintainers disagree.
- Both alert retention sets declare `unmatchedHoldsOptOut: 'forbidden'`, so the DSR engine's policy validation refuses the opt-out as well as the handlers. TC-SEC-ALERT-003 adds an export across several organizations (tenant-wide alert, `organizationId: null`) beside a one-organization export.
- The bound and handler left open in pass six are specified: two `retentionBounds` entries and the read-only `securityAlertRetentionBounds` handler under **Retention bounds**.
- TC-SEC-ALERT-002 no longer re-locks a user after expiry, which would need the running app's clock or a fifteen-minute wait; distinct counting of a re-locking account stays in `alert-counting.test.ts` and the re-lock transition in `seam-events.test.ts`.
