# Privacy coverage: staff and per-user data

> **Program:** a coverage spec of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for `staff`, `planner`, `onboarding`, `devices`, `push_notifications`, `notifications`, `api_keys`, `perspectives`, `dashboards`, and the per-user rows of `integrations`.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md) and [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), including their addenda; [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md); [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md).
> **Verified at** `main` @ `08dada9624` by reading each module's entities, encryption map and delete paths; nothing was run. Not read: most timesheet columns, the staff events' payloads, who writes the author's display name on task comments.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

Deleting a staff user removes their account and nothing else. Their HR record — home address, job history, colleagues' comments about them, leave requests with their reasons, availability — stays. So do their registered devices with push tokens, every notification ever sent to them, their saved views and dashboards, the API keys they made, and the mailbox password stored for them. No module reacts to a user being deleted; the two that try read a field the event does not carry. And a person who began signing up and never finished stays in a table that is never cleaned. **Proposed (future):** data classes so that a staff user's export is complete and their erasure deletes what is theirs alone. A team member's HR record is a subject of its own, because an employer must keep some of it and decides for how long. Each module ships its export and its erase together.

**Not in this spec:** the staff user's account itself (the contract and erasure specs); repairing the two broken subscribers (program package A9); what a notification sent to someone else says about the person.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | A team member's record when their user is erased | Not touched by the user's run. The member is reported as a related subject, and is erased only when named | The erasure spec forbids a class changing another kind's root, and requires related subjects to be named. An HR record also outlives an account for good reason. |
| 2 | Erasing a team member | Their address, job history, availability rules, and comments and activities about them are deleted. Time entries, leave requests with their reasons, reports and the member's name are kept until an age the tenant sets, then blanked. With none set, they are kept and the run says no end is defined | ⚠ NEEDS HUMAN CONFIRMATION. Working-time and leave records are kept under employment and tax law for periods that differ by country. Keeping them with the name removed, as a first draft did, proves nothing for the employer and is still re-identifiable; a leave reason may be a health matter. So they are kept identified and whole, or erased, and the tenant sets when. |
| 3 | A team member who has no user account | The same subject kind, found by name as a candidate | The record holds a name and nothing an operator could type exactly. |
| 4 | Devices, push deliveries, notifications, saved views, dashboards | Deleted | They exist only for the user. |
| 5 | API keys the user created | Deleted, after the dry run has listed them by name | A key bound to its creator already stops working when the creator is gone. Keys may still be referenced by an integration or a rule, which then fails either way. |
| 6 | The user's stored integration credentials | Hard-deleted, after their mailbox channel is disconnected | A personal secret. The existing helper only soft-erases, and only by integration. |
| 7 | Rows with no tenant | Left alone and reported | Keys, views and dashboards may have an empty tenant. Matching them by user id alone could reach another tenant's rows. |
| 8 | Someone who started signing up and never finished | Removed by age, not by a tenant's request | The row belongs to no tenant until completion. Today such rows are kept forever. |
| 9 | A completed signup's record | Deleted when its user is erased | It holds consent flags and no times, so it is not evidence worth keeping. |

## 📝 Problem Statement

- **Nothing reacts to a user being deleted.** The event carries `id`; the two subscribers that exist read `userId` (`auth/commands/users.ts:214-223`; `communication_channels/subscribers/user-deleted-cascade.ts:40-54`; `enterprise/…/sso/subscribers/user-deleted-cleanup.ts:11-33`). None of the modules here subscribes at all. No database constraint ties any of their rows to a user.

| Module | What it holds about a person | Linked by | Today |
|---|---|---|---|
| `staff` | Member name, description, tags, custom fields; addresses; job histories; comments and activities; leave requests with notes and an unavailability reason; time entries; reports, their frozen entries and events; project membership; tasks and task comments | `user_id`, which may be empty (`staff/data/entities.ts:97`); child rows by member. 25 tables in all | Deleting a member soft-deletes that row only (`commands/team-members.ts:500-528`), and its commands keep full copies in the audit log. Only leave notes and one ticket field are encrypted |
| `staff` customer copies | A customer's display name on projects, reports and support tickets; a reporting portal user's request text; a commenting portal user's display name | `customer_id`; `reported_by_customer_user_id`; `author_customer_user_id` | Soft delete |
| `planner` | A member's availability rules, with reason and note (`planner/data/entities.ts:50-75`) | The member | — |
| `onboarding` | Email, names, organization name, a password hash until completion, consent flags without times | An email hash unique across all tenants; tenant and user only after completion. A repeat signup reuses the row, clears tenant and user, and does not reset its creation time (`onboarding/lib/service.ts:25-59`) | Never deleted |
| `devices` | Device id, platform, versions, locale, push token | `user_id` | Deactivation keeps the token (`commands/deactivate.ts:56`) |
| `push_notifications` | A copy of each notification's title and body; the token's tail | `user_id` | No delete path |
| `notifications` | Title, body, variables, action data, links, in clear | `recipient_user_id` — a staff user or a portal user (`customer_accounts/api/portal/notifications.ts:6, 28`) | Expired ones are marked, not removed |
| `api_keys` | Name, description, key hash, session secret | `created_by`, `session_user_id`; tenant may be empty | Soft delete |
| `perspectives`, `dashboards` | Saved views, layouts, widgets | `user_id`; tenant may be empty | Private rows have no cleanup |
| `integrations` | A credential that may belong to one user; a channel elsewhere points at it (`integrations/data/entities.ts:70-83`; `communication_channels/data/entities.ts:110`) | `user_id` | The only helper soft-erases by integration and scope (`lib/credentials-service.ts:219-231`) |

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | Group | On erasure |
|---|---|---|---|
| `staff.team_members` | `staff:team_member`; reports the member as related to `auth:user` | Records | See assumption 2 |
| `planner.availability` | `staff:team_member` | Records | The member's rules **deleted** |
| `staff.customer_copies` | `customers:person`; `customer_accounts:user` | Records | The customer's display name **cleared** on projects, reports and tickets; a portal user's request text and comment bodies **cleared** |
| `staff.authorship` | `auth:user` | Records | Nothing changed: comments, decisions and report events the user wrote about others are **retained** as `other_party`, holding an id that no longer resolves |
| `onboarding.requests` | `auth:user` | Records | The completed request **deleted** |
| `notifications.inbox` | `auth:user`; `customer_accounts:user` | Records | Notifications and preferences **deleted** |
| `perspectives.views` | `auth:user` | Records | Private views **deleted** |
| `dashboards.layouts` | `auth:user` | Records | Layouts and user widgets **deleted** |
| `devices.user_devices` | `auth:user` | Credentials | **Deleted**, token included |
| `push_notifications.deliveries` | `auth:user` | Records | **Deleted** |
| `api_keys.keys` | `auth:user` | Credentials | Keys created by or issued to the user **deleted** |
| `integrations.user_credentials` | `auth:user` | Credentials | **Hard-deleted**, through a new method of the module's credential service that lists by user |

Each class exports what it holds, with secrets left out: a key by name and date, a device by platform and last-seen time, a credential by the integration it belongs to.

Classes in the credentials group run after every records class, as the erasure addendum orders them. The communication spec's channel class is a records class and so disconnects a mailbox before its credential is deleted here.

### A team member as a subject

`staff:team_member`, with the member's id, owned by `staff.team_members`.

- Resolving a name scans member names in the tenant and offers matches as candidates.
- A user's export and dry run report the member as related; the operator names it, or excludes it.
- The run for a member is idempotent because the member gains `anonymized_at`; the link to a user is not cleared.
- A tenant setting in `staff` gives the number of years employment records are kept, counted from the member's last time entry or leave. Older than that, the kept records are blanked: the member's name replaced, notes and reasons cleared.
- Handlers return the member's and its children's records as history records, so that the copies the commands kept in the audit log are stripped.

### Every table declared

`staff` has 25 tables. Each module's step ends with every one of its tables in a class or declared with a reason, and only then are they taken off the coverage baseline. The step's first act is to write that list here.

### Unfinished signups

A scheduled job in `onboarding` deletes requests that have no user, are not in the middle of being processed, and were last updated more than `OM_ONBOARDING_PENDING_RETENTION_DAYS` ago (default 30). It keys on the last update, because a repeat signup reuses the row without resetting its creation time. The table is covered by the class above; the job is clean-up, not its classification.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Blank the member when their user is erased | See assumption 1. |
| Keep time and leave records with the name removed | See assumption 2. |
| Rely on the user-deleted event | It is emitted after the account is gone, carries no outcome per module, and its subscribers are broken today. |
| Match rows with no tenant by user id | See assumption 7. |
| Keep the completed signup row as consent evidence | It records no time of consent. |
| Soft-erase credentials with the existing helper | The secret stays in the table. |

### Known limits

- A notification or push message sent to another user that names the person is not found.
- A team member with no user is found only by name.
- An API key, view or dashboard with no tenant is left and reported.
- An integration log line that names the user is bounded by retention, not erased.

## 📝 Delta

### Capability: privacy-coverage-people-ops

#### ADDED Requirement: Export of a staff user's data
The system SHALL include in a staff user's export their devices, notifications, saved views, dashboards, the names of their API keys and stored credentials, and their signup record, and SHALL name their team-member record as a related subject.

##### Scenario: Complete export
- WHEN a staff user with a device, a notification, a saved view and a team-member record is exported
- THEN each of the first three appears in its own section with no token, key or secret, and the member is listed as related

#### MODIFIED Requirement: Erasure of a staff user
The system SHALL, when a staff user is erased, delete their devices, push deliveries, notifications, private views, dashboards, signup record, API keys and stored credentials, and SHALL NOT change their team-member record unless it was named.

##### Scenario: Credentials go last
- WHEN the user is erased
- THEN their API keys, devices and stored credentials are deleted only after every other class has run

##### Scenario: A refusal before anything changes
- WHEN the user is the tenant's last administrator
- THEN the run stops in pre-flight and none of their keys, devices or credentials has been touched

##### Scenario: Team member not named
- WHEN the user has a team-member record and only the user was named
- THEN the run refuses the unnamed related subject, as the erasure spec requires

Frozen by: `packages/core/src/modules/devices/__tests__/deactivate-keeps-token.characterization.test.ts`

#### ADDED Requirement: Erasure of a team member
The system SHALL, when a team member is erased, delete their address, job history, availability and the comments about them, and SHALL keep their name, time entries, leave requests and reports until the age the tenant has set.

##### Scenario: Within the age, or none set
- WHEN the member's last entry is younger than the tenant's age, or no age is set
- THEN the address and job history are gone, the time entries and leave still load under the member's name, and the run reports them as retained with the date they may be erased, or that none is defined

##### Scenario: Past the age
- WHEN the member's last entry is older than the tenant's age
- THEN the member's name, notes and leave reasons are blanked

Frozen by: `packages/core/src/modules/staff/__tests__/team-member-delete.characterization.test.ts`

#### ADDED Requirement: Unfinished signups
The system SHALL delete a signup request that was never completed once it has not been updated for the configured age.

##### Scenario: Old and unfinished
- WHEN a request has no user, is not being processed, and was last updated before the age
- THEN it is deleted

##### Scenario: Restarted yesterday
- WHEN an old request was reused by a new signup yesterday
- THEN it is kept

## 📝 Architecture

- Each module: `privacy.ts`, a handler under `lib/privacy/`, its registration, its table declarations.
- `staff`: the tenant setting; `anonymized_at` on the member.
- `onboarding`: a prune worker and its schedule, as the pruner spec registers others.
- `integrations`: a credential-service method that lists and hard-deletes by user.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Run → each class | The data-class registry | A disabled module contributes nothing |
| User ↔ team member | Related subjects, both ways | — |
| Classes → undo copies | History records returned to the run | Reported as retained in audit |
| `onboarding` prune → scheduler | `schedulerService`, guarded | Unfinished signups are never removed; the doctor's scheduler check reports it |

## 📝 Data Models

`staff_team_members` gains `anonymized_at`. Indexes on the user column where a class looks up by it and none exists; each step lists them. No new table.

## 📝 API Contracts

- **Subject kind** `staff:team_member`.
- **Settings**: in `staff`, employment-record retention in years, per tenant; `OM_ONBOARDING_PENDING_RETENTION_DAYS`, in both `.env.example` files.
- **`integrations`** credential service: list and hard-delete by user.
- The team-member response gains `anonymizedAt`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A user with no team-member record | Nothing related is reported |
| A member whose user was deleted earlier | Found as a member subject; its user link is already dangling |
| A leave request awaiting a decision | Kept with the rest |
| An API key in use by an integration or a rule | Deleted; the dry run lists keys by name so they can be replaced first |
| A key, view or dashboard with no tenant | Left; reported |
| A person signs up again after their request was deleted | A new request is created |
| A portal user who reported tickets or receives notifications | Their request text is cleared and their notifications deleted |
| A dashboard shared by role | Not the user's; untouched |
| A first-group class fails | The account stays locked and its credentials intact; a re-run continues |

## 📝 Migration & Backward Compatibility

Additive: one column, one subject kind, two settings, one schedule, one service method. Nothing is deleted on upgrade except unfinished signups not updated within the age, from the first scheduled run; the upgrade note says so and names the setting.

## 📋 Phasing

Each phase ships its classes' export and erase together.

| Phase | Classes | Depends on |
|---|---|---|
| 1 | Unfinished-signup pruning | Pruner spec, Phase 1 |
| 2 | The per-user deletes: notifications, views, dashboards, devices, push deliveries, API keys, credentials, the signup record | Erasure spec, Phase 3, and its addendum |
| 3 | `staff` and `planner`: the member subject, customer copies, authorship | The same |

Every `auth:user` class here ships with its erase, so none of them blocks the kind.

## 📋 Implementation Plan

### Phase 1
1. **Characterize** that an old unfinished signup stays. Commit alone.
2. The prune worker, schedule and setting. Unit tests with a clock: unfinished and stale; restarted yesterday; being processed; completed.

### Phase 2
1. **Characterize** that deactivating a device keeps its token. Commit alone.
2. One step per module: the class with its group, tables and export sections; the erase; the table declarations. Unit tests per outcome, a cross-tenant test, and a row with no tenant.
3. `integrations`: the service method. Unit tests.
4. Integration test TC-PRIVACY-PEOPLE-001.

### Phase 3
1. **Characterize** that deleting a team member leaves its child rows. Commit alone.
2. Write the list of `staff`'s 25 tables and `planner`'s, each with its class or declaration.
3. The member subject: resolution by name, `anonymized_at`, the tenant setting, the erase with both branches, history records. Unit tests.
4. `planner.availability`, `staff.customer_copies`, `staff.authorship`. Unit tests.
5. Integration test TC-PRIVACY-PEOPLE-002; the declared tables leave the coverage baseline; fixtures join the verification suite.
6. Archive this Delta into `.ai/specs/capabilities/privacy-coverage-people-ops.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/{staff,planner,devices,push_notifications,notifications,api_keys,perspectives,dashboards,integrations}/{privacy.ts,lib/privacy/*,di.ts}` | Create / modify |
| `packages/onboarding/src/modules/onboarding/{privacy.ts,lib/privacy/*,workers/*,setup.ts}` | Create / modify |
| `packages/core/src/modules/staff/{data/entities.ts,migrations/*}`; `packages/core/src/modules/integrations/lib/credentials-service.ts` | Modify |
| `packages/core/src/modules/staff/__integration__/TC-PRIVACY-PEOPLE-00{1,2}.spec.ts` | Create |

## 🧪 Integration Coverage

After a user is erased their own session is gone, so the tests check with direct queries and through an administrator's session, not through routes scoped to the caller.

| Test | Covers |
|---|---|
| TC-PRIVACY-PEOPLE-001 | A staff user with a device registered through the existing device fixture, a notification, a saved view and an API key is exported: each section is present and no key hash or token appears; a second tenant's user is not included. After erasure, direct queries find no device, notification, view or key row for that user, soft-deleted or not |
| TC-PRIVACY-PEOPLE-002 | A team member with an address and a time entry is erased by name with no age set: an administrator's request returns the member with their name and the time entry; the address is gone; the run reports the entry as retained with no end defined. With an age set and the entry backdated beyond it, the member is returned with no name |

Push deliveries and integration credentials are unit-tested: no fixture creates them without a real device token or provider.

## 📝 Risks & Impact Review

#### An employer loses a record it had to keep
- **Scenario**: A tenant sets an age shorter than its law requires.
- **Severity**: Medium
- **Affected area**: HR and payroll
- **Mitigation**: Nothing is blanked unless an age is set; the run reports the date.
- **Residual risk**: The tenant's own choice.

#### HR records are kept with no end
- **Scenario**: No age is set.
- **Severity**: High
- **Affected area**: former employees
- **Mitigation**: The run says so each time; the doctor reports the setting unset; assumption 2 is marked.
- **Residual risk**: A tenant who never sets it.

#### An administrator is left without a second factor
- **Scenario**: Credentials are deleted and the owner then refuses.
- **Severity**: High
- **Affected area**: the account being erased
- **Mitigation**: The read-only check in pre-flight; credentials run last; the account is locked first.
- **Residual risk**: A failure inside the credentials group itself; a re-run continues, and the account is locked meanwhile.

#### An integration breaks
- **Scenario**: An API key or a mailbox credential the erased user made was still in use.
- **Severity**: Medium
- **Affected area**: that integration
- **Mitigation**: The dry run lists both by name before anything is deleted.
- **Residual risk**: An operator who applies without reading the list.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the contract's handler obligations, the erasure spec's rules and addendum, `packages/queue/AGENTS.md` (MUST rules).

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Each class in its own module |
| A class never changes another kind's root | Compliant | The user's run reports the member; it does not blank it |
| Retain only with a listed reason | Compliant | `legal_retention`, `other_party` |
| Tenant scoping | Compliant | Rows with no tenant are left |
| Background work through the worker contract | Compliant | One prune worker |
| Integration coverage | Partly | Two kinds of row are unit-tested for the reason given |

**Verdict:** Phases 1 and 2 approved as a design. Phase 3 waits on assumption 2.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The user's run no longer blanks the team member: that broke the erasure spec's rule about another kind's root, and made a re-run find nothing. The member is its own subject. Time and leave records are kept identified until an age the tenant sets, instead of kept with the name removed, which served neither the employer nor the person. Availability rules in `planner`, customer copies on projects, reports and tickets, and portal users' notifications are added. The signup pruner keys on the last update and skips rows being processed, because a repeat signup reuses the row; the completed row is deleted, since it records no time of consent. Credential-holding classes run last, after a read-only check, so that a refusal cannot leave a live administrator without a second factor. Rows with no tenant are left. Tests check by direct query, since the erased user's own routes are unobservable afterwards.
