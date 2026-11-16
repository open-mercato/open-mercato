# Security event alerting

> **Program:** package G2 of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-13-sign-in-activity.md`](2026-11-13-sign-in-activity.md) (#8106), which is specified and not implemented, and on the OSS spec [`../2026-11-16-export-audit-event.md`](../2026-11-16-export-audit-event.md). The 11-13 spec already covers the notice a user gets about their own sign-in from a new device, and decides that sign-ins refused by the rate limit stay silent; this spec keeps both.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/enterprise/2026-11-13-sign-in-activity.md
Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Nothing in the product tells a tenant's administrators that something may be wrong: a hundred failed sign-ins against one account, a wave of locked portal accounts, a user exporting fifty thousand customer records, a new API key, MFA switched off for an administrator. For most of these there is not even an event to build a signal from — two events that look as if they exist are declared and never emitted. **Proposed (future):** four small additions to OSS so that these things can be seen at all, and an enterprise feature that turns them into alerts: a list for administrators, a notification, and one event a tenant can forward to its own monitoring through the existing webhooks.

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
| 4 | Thresholds | Per tenant, with defaults; each rule can be switched off | ⚠ NEEDS HUMAN CONFIRMATION of the default numbers in the rule table. They are guesses that err towards fewer alerts. |
| 5 | Sign-ins refused by the rate limit, and attempts with an email that matches no user | No rule | The limiter runs before the user is looked up, so there is nobody to attribute them to, and the 11-13 spec keeps refusals silent on purpose. Stated as a limit. |
| 6 | Does an alert do anything | No | Locking an account on a threshold is a way to lock out the real owner. |
| 7 | What an alert stores | Counts, ids, the rule and times. No address, no email, no exported data | The sign-in log and the audit log hold the detail, under their own access rules. |
| 8 | How long one condition stays one alert | Until someone acknowledges it | Fixed time buckets either split one burst across a boundary or raise an alert per bucket for hours. |

## 📝 Problem Statement

| Signal | Today | Evidence |
|---|---|---|
| Failed staff sign-in | An event with the email and a reason. The 11-13 spec adds the user, tenant and an attempt id when known | `auth/api/login.ts:162, 198` |
| Portal account locked after five failures | The event is declared and never emitted. The lock is a blind SQL update that returns nothing | `customer_accounts/events.ts:7`; `services/customerUserService.ts:91-105`; `api/login.ts:111` |
| A role or user gains or loses features | Nothing is emitted by the two commands that change them; the role-updated event carries no feature change | `auth/commands/acl.ts:231-232, 322-345` |
| MFA changes, emergency bypass, failed step-up | Events | `enterprise/…/security/events.ts:5-37` |
| API key created | No event; the module declares none. Keys are also minted by the assistant, by agents, and per session | `api_keys/`; `ai_assistant/api/mcp-key/route.ts:46`; `agent_orchestrator/lib/identity/agentTokenService.ts:75`; `apiKeyService.ts:248` |
| A list exported | Nothing; the export-audit spec adds an entry and an event | — |

- **Persistent events are delivered at least once**, so a subscriber may see one twice (`packages/events/src/bus.ts:681-695`).
- **An event with no organization is sent to every organization's webhooks in the tenant** (`packages/webhooks/…/subscribers/outbound-dispatch.ts:68-107`).
- **Telling administrators is possible.** The `security` module already has a subscriber that notifies by feature, using `createBatch` with a group key because `createForFeature` cannot skip an existing group (`security/subscribers/mfa-emergency-bypass-notification.ts:49-66`; `notifications/lib/notificationService.ts:279`).
- **A notification type is opt-out-able or not as a whole**, not per channel.
- **Module configuration is last-write-wins** (`configs/lib/module-config-service.ts:176-204`).
- **Feature matching must understand wildcards**: administrators hold `security.*` (`security/setup.ts:5-6`).

## 📝 Proposed Solution

### OSS seams (additive)

1. **`customer_accounts.user.locked`** is actually emitted. The lock update returns whether this failure caused the lock, and the login route emits the event with the tenant, the organization, the user id and the time.
2. **`auth.acl.changed`** — emitted by the two commands that change features, for a role or for a user, with the features added and removed and whether super-administrator status changed. A user being given or losing a role emits the same event with the role ids.
3. **`api_keys.key.created`** and **`api_keys.key.deleted`**, emitted by the service that every path uses, with ids and a kind: created by a user, by the assistant, by an agent, or for a session.
4. **`audit_logs.export.completed`** — from the export-audit spec.

### Rules (enterprise)

| Rule | Fires when | Default | Depends on |
|---|---|---|---|
| MFA weakened | MFA is removed or reset for a user who holds a privileged feature; an emergency bypass is detected | Each occurrence | Events that exist |
| Privileged change | A role or a user gains a feature on a configured list, or super-administrator status | Each occurrence | Seam 2 |
| Portal lockouts | Portal accounts locked in an organization within a window | 5 in 1 hour | Seam 1 |
| API key created | A key of the kind "by a user" is created | Each occurrence | Seam 3 |
| Large export | Rows of one kind exported by one actor within a window | 5,000 in 1 hour | Seam 4 |
| Repeated failures on one account | Failed sign-ins for one user within a window | 10 in 10 minutes | The 11-13 spec's seam |

Feature matching for the first two uses the shared matcher that understands wildcards.

### How a rule counts

Each rule is a subscriber. For each event it:

1. takes a lock for the rule and subject, so that two workers cannot evaluate at once;
2. inserts a signal — tenant, organization, rule, subject, quantity, time, and a key derived from the event — and does nothing more if a signal with that key already exists, which is how a redelivered event is ignored;
3. sums the signals for that subject within the rule's window, looking back from the event's own time;
4. if the sum reaches the threshold: updates the open alert for that rule and subject if one exists, otherwise inserts one.

There is at most one open alert per rule and subject, enforced by a partial unique index. It stays open, with its count and last-seen time rising, until someone acknowledges it. After that, the next crossing opens a new one.

### An alert

- A row: rule, severity, subject, count, first and last time seen, state, and a notification time.
- A notification to users in the alert's organization who hold the alerts feature. It is sent by a small worker that picks up alerts with no notification time, so that a retry after the insert cannot lose it or send it twice. The type cannot be opted out of.
- A persistent event, `security.alert.raised`, with ids, counts and the organization.
- A page, Security › Alerts, with a link to the sign-in log or the audit log filtered to the same subject and time. Acknowledging records who and when.
- A settings section for thresholds and switches.

### Design decisions

| Decision | Rationale |
|---|---|
| Signals in the module's own table, each with a key from its event | Counting must not query another module's tables, and redelivery must not double-count. |
| One open alert per rule and subject | See assumption 8. |
| A lock per rule and subject | Two workers evaluating one burst would otherwise both insert. |
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

### Known limits

- Attempts with an email that matches no user, and sign-ins refused by the rate limit, raise nothing.
- A slow attack under every threshold is not seen.
- An export through direct database access, or by an API client paging by hand, is not an export to the product.
- Nothing here tells the operator of an installation. A host that is a processor for its tenants has its own duty to notify them and needs its own monitoring.

## 📝 Delta

### Capability: security-event-alerting

#### ADDED Requirement: Alerts for administrators
The system SHALL raise an alert to an organization's authorized users when a configured threshold is crossed, and SHALL keep one open alert, not many, while the same condition continues.

##### Scenario: Portal lockouts
- WHEN the threshold number of portal accounts are locked within the window
- THEN one alert is listed and authorized users are notified once

##### Scenario: The condition continues
- WHEN more lockouts follow while the alert is open
- THEN its count rises and no second alert or notification is produced

##### Scenario: After acknowledgement
- WHEN the alert is acknowledged and the threshold is crossed again
- THEN a new alert is raised

##### Scenario: The same event delivered twice
- WHEN an event is redelivered
- THEN it is counted once

##### Scenario: Large export
- WHEN a user exports more rows of one kind than the threshold within the window
- THEN an alert names the user, the kind and the count

##### Scenario: Rule switched off
- WHEN a tenant has switched a rule off
- THEN nothing is raised for it

##### Scenario: Another organization
- WHEN an alert is raised in one organization
- THEN users of another organization in the tenant neither see it nor are notified

#### ADDED Requirement: Forwarding
The system SHALL emit one event per alert that an organization can subscribe a webhook to.

##### Scenario: Webhook
- WHEN an alert is raised and its organization has a webhook for the alert event
- THEN that webhook, and no other organization's, receives the rule, the subject's id and the count

#### MODIFIED Requirement: Portal lockout event
The system SHALL emit the declared lockout event when a failed sign-in locks a portal account.

##### Scenario: Fifth failure
- WHEN the fifth consecutive failure locks the account
- THEN the event is emitted once, with the tenant, the organization and the user

Frozen by: `packages/core/src/modules/customer_accounts/__tests__/login-lockout-event.characterization.test.ts`

## 📝 Architecture

- **OSS**: `customer_accounts` — the lock update returns the transition and the route emits; `auth/commands/acl.ts` and the role-assignment path — `auth.acl.changed`; `api_keys` — `events.ts` and the service; the export event from its own spec.
- **Enterprise `security`**: `data/` — signals, alerts, settings; `subscribers/` — one per rule; `lib/alerting/` — the lock, the idempotent signal, the window sum, the open-alert rule; `workers/` — notification delivery and pruning; `api/alerts`, `api/alert-settings`; the backend page; `notifications.ts`; `events.ts`.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| OSS → `security` | Events | Enterprise module off: the events are emitted and nobody listens |
| `security` → administrators | `notificationService.createBatch` with a group key | Notifications module absent: the list page still shows alerts |
| `security` → external monitoring | `security.alert.raised` through webhooks | No webhook: nothing leaves |
| A seam not yet shipped | Each rule's subscriber registers only for an event that is declared | That rule is listed in settings as unavailable |

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

All three tables carry `tenant_id`, a nullable `organization_id`, and `created_at`.

| Table | Columns |
|---|---|
| `security_alert_signals` | `rule`, `subject_kind`, `subject_id`, `quantity`, `occurred_at`, `source_key`. Unique on tenant, rule and `source_key`. Indexed on tenant, rule, subject and `occurred_at` |
| `security_alerts` | `rule`, `severity`, `subject_kind`, `subject_id`, `count`, `first_seen_at`, `last_seen_at`, `state` (`open` \| `acknowledged`), `notified_at?`, `acknowledged_by?`, `acknowledged_at?`, `updated_at`. Unique on tenant, rule and subject where the state is open |
| `security_alert_settings` | One row per tenant: per rule a switch, a threshold and a window; the list of privileged features; `updated_at` |

No personal data beyond user ids is stored, so nothing is added to an encryption map. The module declares the three tables for the privacy coverage check: signals as bounded by retention, alerts as reference-only, settings as configuration.

## 📝 API Contracts

| Route | Feature | Notes |
|---|---|---|
| `GET /api/security/alerts` | `security.alerts.view` | Scoped to the selected organization, as the 11-13 list is; filters by rule, state, time; page size at most 100 |
| `POST /api/security/alerts/:id/acknowledge` | `security.alerts.manage` | Mutation-guard registry |
| `GET`, `PUT /api/security/alert-settings` | `security.alerts.manage` | Validated with zod; optimistic locking on the row's `updated_at` |

**Events.** OSS: `customer_accounts.user.locked` (now emitted), `auth.acl.changed`, `api_keys.key.created`, `api_keys.key.deleted`. Enterprise: `security.alert.raised`, `security.alert.acknowledged`, both carrying the organization. All additive.

**Notification type** `security.alert.raised`, in-app and email, not opt-out-able.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Two workers evaluate the same burst | The lock serialises them; the partial unique index is the second guard |
| A redelivered event | Its signal key already exists; nothing is added |
| A subscriber fails after inserting the alert | The alert has no notification time; the delivery worker sends it |
| An attack that continues for days with nobody acknowledging | One open alert whose count and last-seen time keep rising |
| No user holds the alerts feature | The alert is listed; the page says nobody will be notified |
| The acting user is the one being alerted about | They are notified like anyone else who holds the feature; the alert names them |
| An export or a key by an API key | The actor is the key; the alert names it |
| An event with no organization | The alert has none; it is listed for every organization's authorized users and its event goes to tenant-level webhooks only |
| A seam's event is not declared in this installation | The rule is shown as unavailable |
| Thresholds changed while an alert is open | Applied to the next evaluation |

## 📝 Migration & Backward Compatibility

- Three new OSS events and one declared event that starts being emitted; three tables, three routes, two features, one notification type, one page: additive.
- `customer_accounts.user.locked` was declared and silent. A subscriber written against the declaration starts receiving it; the dated entry says so.
- Features: administrators hold both new features through the existing `security.*` wildcard; nothing is added to role defaults.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Signals, alerts, settings, delivery, list page; the MFA rule | — |
| 2 | Lockout, ACL and API-key seams in OSS; their three rules | — |
| 3 | The large-export rule | The export-audit spec |
| 4 | The repeated-failures rule | The 11-13 spec's Phase 1 |

## 📋 Implementation Plan

### Phase 1
1. Entities, migration, features.
2. The alerting library, with unit tests: under, at and over a threshold; a redelivered event; two concurrent evaluations; an open alert updated, not duplicated; a new alert after acknowledgement.
3. The settings table, route and section. Unit tests, including a conflicting edit.
4. The notification type and the delivery worker; the list route and page; acknowledge. Unit tests for delivery after a failed subscriber.
5. The MFA rule, with wildcard-aware matching. Integration test TC-SEC-ALERT-001.

### Phase 2
1. **Characterize** that a fifth failed portal sign-in locks the account and emits no lockout event. Commit alone.
2. OSS: the lock transition and its event; `auth.acl.changed`; the API-key events with a kind. Unit tests that each is emitted once and carries no email. Update the characterization test.
3. The three rules. Unit tests per rule. Integration test TC-SEC-ALERT-002.

### Phase 3
1. The large-export rule. Integration test TC-SEC-ALERT-003.

### Phase 4
1. The repeated-failures rule, keyed by the attempt id.
2. The outward event's docs with the webhook recipe; the pruning worker; the breach-response page's reference to this list.
3. Archive this Delta into `.ai/specs/capabilities/security-event-alerting.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/customer_accounts/{services/customerUserService.ts,api/login.ts}`, `packages/core/src/modules/auth/{commands/acl.ts,events.ts}`, `packages/core/src/modules/api_keys/{events.ts,services/apiKeyService.ts}` | Modify / create |
| `packages/enterprise/src/modules/security/{data,subscribers,lib/alerting,api/alerts,api/alert-settings,backend/security/alerts,workers,notifications.ts,events.ts,acl.ts,setup.ts,i18n}` | Create / modify |
| `packages/enterprise/src/modules/security/__integration__/TC-SEC-ALERT-00{1,2,3}.spec.ts` | Create |

## 🧪 Integration Coverage

In the enterprise test environment, with the security module enabled. Thresholds are set through the settings route, which exists from Phase 1, and restored afterwards. Each test uses its own organization where it can, because lockout counts are per organization.

| Test | Covers |
|---|---|
| TC-SEC-ALERT-001 | MFA is reset for a user who holds a privileged feature; one alert is listed; an administrator has one notification; a user without the feature gets 403; the page loads, lists the alert, acknowledges it and saves a threshold |
| TC-SEC-ALERT-002 | With the lockout threshold set to two, two portal users are locked by failed sign-ins; one alert is listed; a third lockout raises its count and adds no alert or notification; after acknowledgement a further two raise a new one. Creating an API key raises an alert; granting a listed feature to a role raises one |
| TC-SEC-ALERT-003 | With the export threshold lowered to a few rows, a small full export raises an alert naming the user and the kind |

The repeated-failures rule is unit-tested until the 11-13 spec's seam exists.

## 📝 Risks & Impact Review

#### Alerts are noise
- **Scenario**: Thresholds are too low for a busy tenant, and administrators stop reading them.
- **Severity**: High
- **Affected area**: the value of the whole feature
- **Mitigation**: One alert per window; adjustable thresholds; rules can be switched off; defaults err high.
- **Residual risk**: The defaults are guesses until real tenants use them.

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
- **Mitigation**: Delivery is a separate worker driven by the alert row.
- **Residual risk**: A stopped worker; the list page still shows the alert.

#### Alerts leak who is being investigated
- **Scenario**: A user sees an alert about a colleague.
- **Severity**: Medium
- **Affected area**: staff privacy
- **Mitigation**: A dedicated feature, off for ordinary users; ids and counts only.
- **Residual risk**: Those who hold the feature see names through the linked logs, as intended.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for events, the frontend architecture contract. Not reviewed: the enterprise `security` module guide in full.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | The OSS seams are listed and additive |
| No cross-module table access | Compliant | Own signal table; other modules reached by events |
| Event ids: module, singular entity, past tense | Compliant | — |
| Feature-based guards | Compliant | Two features |
| Optimistic locking on editable records | Compliant | Settings |
| Tenant scoping | Compliant | Every row and query carries the tenant |
| Integration coverage | Compliant | Three tests |

**Verdict:** approved for Phase 1. Phases 2 to 4 each wait for the OSS seam they name.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions. The program described this package as "brute force, new device, mass export"; the new-device notice is already in the 11-13 spec and is not repeated.
- Revised after independent review. Two rules had no event to consume: the portal lockout event is declared and never emitted, and feature changes emit nothing; both become OSS seams. The throttled-sign-in rule is dropped, because the limiter runs before a user is known and the 11-13 spec keeps refusals silent on purpose. Counting is redesigned: idempotent signals keyed by their event, a lock per rule and subject, and one open alert until acknowledged instead of fixed time buckets. Notifications are sent by a worker from the alert row. Rows, the list, recipients and the outward event carry the organization. Settings have their own table. API-key events carry a kind so that per-session keys do not alert. The export seam moved to its own OSS spec. The legal framing no longer suggests an alert starts the 72 hours.
