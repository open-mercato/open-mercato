# Privacy coverage: staff and per-user data

> **Program:** a coverage spec of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for `staff`, `planner`, `onboarding`, `devices`, `push_notifications`, `notifications`, `api_keys`, `perspectives`, `dashboards` and per-user `integrations` rows.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md), [`2026-11-16-privacy-doctor-cli.md`](2026-11-16-privacy-doctor-cli.md) and communication coverage Phase 1 for channel disconnects and source notification copies.
> **Verified at** the supplied read-only repository: all 25 staff entities, both planner entities, per-user stores, signup processing/reuse, support-ticket/comment snapshots, credential erasure and fake push/channel fixtures. Nothing was executed against an application. Arbitrary mentions inside unrelated users' free text were not inventoried.
> **Written autonomously.** Product defaults below require confirmation before implementation.

Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

An ordinary user delete leaves devices, notification copies, saved views, dashboards, keys, signup data and personal credentials. A team member also has HR and working-time records that may outlive their login. **Proposed (future):** module-owned classes export and erase per-user stores, report the team member as a separate related subject, and retain only the declared employment records until a tenant-defined end. A marked member is blanked later by a retention set. Every staff and planner table has an outcome below.

The staff account itself belongs to the contract/erasure specs. The program's A9 owns the broken user-delete subscriber repair; communication coverage owns disconnecting channels. No class here reads their tables directly.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen default and fallback | Rationale |
|---|---|---|---|
| 1 | Team member when their user is erased | Report as related. Do not change it unless the reviewed subject list names it; an explicit exclusion leaves it alone | An HR record is a separate root that may outlive its account |
| 2 | Kept employment records | ⚠ NEEDS HUMAN CONFIRMATION. Keep the member's name, user link, time entries, leave records and financial report contributions identified until the tenant age under `prefer: 'delete'`, as C4 assumption 18 specifies; set `anonymizeOwnerWhenRetained: false`. Refuse explicit `--prefer anonymize` in pre-flight with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW` while that identifying block must remain; its message tells the operator to run with `--prefer delete`. Under `delete`, erase everything not under legal retention, including address, job history, availability, comments and personal profile values, and report the identified employment root as `retained` / `legal_retention` with its `retainedUntil`; pending leave retains the existing `open_case` outcome. Fallback if this policy is rejected or its authorization is missing: refuse member apply for manual review; never silently call it anonymized | The period and identified-owner exception need human authorization; leave reasons can be sensitive. Retained legal/open-case blocks keep null `anonymizedAt` until final clearing |
| 3 | Retention anchor | ⚠ NEEDS HUMAN CONFIRMATION. Use the latest time-entry `date` and decided leave `end_date`, falling back to member `created_at` only when neither exists. Pending leave keeps the block as `open_case` with no end until decided; future decided leave moves the end forward. Fallback: `open_case` and manual review for invalid dates | There is no employment-end column on the member entity; the anchor must be reproducible |
| 4 | Member without an account | Resolve name to candidates, then use `--subject staff:team_member:<id>` | Erase never accepts a name as an exact subject |
| 5 | User-only stores and keys | Delete them after the reviewed dry run; keys/devices/credentials run in the credentials group | They serve the account, and their secrets must not survive it |
| 6 | Personal integration credentials | R4-1 makes `integrations.user_credentials` the only credential-row deletion class. Communication disconnects the subject's channels, clears identifying fields, state and `credentials_ref`, and calls integrations' `deleteUserCredential({ scope: PrivacyScope, userId, credentialId })`; it declares no credential class. A9 calls that same method | Integrations owns deletion, including disconnected and soft-deleted residual rows found by user id; C4's records-before-credentials barrier still applies, and communication's call placement remains the design prerequisite below |
| 7 | Rows without a tenant | After the auth owner confirms the user belongs to the requested tenant, include that user's tenant-less keys/views/dashboards, with organization scoping. An owner with no tenant is refused and its rows are left and reported | The owner check supplies the missing tenant proof; rows explicitly belonging to another tenant never match |
| 8 | Unfinished signup | Prune by last update after the configured age, excluding only a fresh processing lease | Crashed processing must not keep a request forever |
| 9 | Completed signup row | Delete with its verified user | Consent flags here are not the timed consent evidence held elsewhere |
| 10 | Existing coverage bundle or split | Keep signup pruning and subject classes as independently releasable phases in this owned spec, as the work packet requests; create no replacement spec in this revision | The packet fixes the existing scope and file ownership |

## 📝 Problem Statement

The following are current-code observations. Core module paths are under `packages/core/src/modules/`.

| Area | Verified store or path | Gap |
|---|---|---|
| User deletion | `auth/commands/users.ts` builds the event with `id`; `communication_channels/subscribers/user-deleted-cascade.ts` and enterprise SSO cleanup read `userId` | Existing subscriber repair is A9, not a substitute for an erasure run |
| Staff | `staff/data/entities.ts` has 25 tables; `staff/commands/team-members.ts` soft-deletes only the member | Child personal data and command snapshots remain |
| Support | `staff/commands/support-tickets.ts` puts request subject/body in a task and ticket snapshot, `reporterDisplayName` in `customer_snapshot`, and commenter name in `author_display_snapshot` | Clearing request text alone misses these names |
| Reports | `staff/data/entities.ts` stores frozen financial values in `staff_time_report_entries`; `staff/commands/timesheets-reports.ts` stores event reason/metadata | Frozen entry columns do not contain a member-name field; report joins and free-text/event copies still need an outcome |
| Planner | `planner/data/entities.ts` has availability rule sets and rules, with notes and unavailability reasons | Member rules need erasure without deleting shared rule sets |
| Signup | `packages/onboarding/src/modules/onboarding/lib/service.ts` reuses a row and clears tenant/user without resetting creation; `api/get/onboarding/verify.ts` uses a 15-minute `processing_started_at` freshness window | Creation age and an unlimited processing exemption are both wrong cleanup predicates |
| Per-user stores | Entities in devices, push notifications, notifications, API keys, perspectives and dashboards hold user ids, tokens/content or private settings | Soft deletion/deactivation is not a personal-data purge |
| Credentials | `integrations/data/entities.ts` has tenant, organization and optional user; `lib/credentials-service.ts` `eraseIntegrationCredentials` empties credentials then soft-deletes, locating by integration/scope | The helper removes the secret, but leaves the row and does not enumerate every integration for a user |
| Integration fixtures | `packages/core/src/helpers/integration/pushFake.ts` supports `OM_PUSH_FAKE_PROVIDERS`; `communicationChannelsFixtures.ts` has `seedConnectedChannel` | Push delivery and personal credential integration coverage needs no real provider |

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | `erasureGroup` | Export / erasure |
|---|---|---|---|
| `staff.team_members` | `staff:team_member`; `auth:user` | `records` | Owns member kind. For `auth:user`, find linked members and report them as related only: no member mutation. For member subjects use the matrix below |
| `planner.availability` | `staff:team_member` | `records` | Export and delete member rules; shared rule-set configuration stays |
| `staff.customer_copies` | `customers:person`; `customer_accounts:user` | `records` | Export/clear customer snapshots, portal request/task copies and portal comment author copies as below |
| `staff.authorship` | `auth:user` | `records` | Export attributable comment/decision/report-event authorship about others; retain as `other_party`, with id-only attribution and no unrelated person's private text in the export |
| `onboarding.requests` | `auth:user` | `records` | Export completed signup fields without password/token/lookup hashes; delete completed rows for the verified user |
| `notifications.inbox` | `auth:user`; `customer_accounts:user` | `records` | Export inbox and own preferences; delete both |
| `perspectives.views` | `auth:user` | `records` | Export/delete private views |
| `dashboards.layouts` | `auth:user` | `records` | Export/delete own layout and own widget rows |
| `push_notifications.deliveries` | `auth:user` | `records` | Export delivery content/status/dates without token snapshots/provider secrets; delete own deliveries |
| `devices.user_devices` | `auth:user` | `credentials` | Export platform/versions/last seen, never token; hard-delete devices |
| `api_keys.keys` | `auth:user` | `credentials` | Export name/date, never key hash/token/secret; delete rows created by or issued to the user |
| `integrations.user_credentials` | `auth:user` | `credentials` | Export metadata by user/integration with no secret; sole DSR deleter of all scoped personal credential rows, freshly re-listed after every records class succeeds |

The `auth:user` path of `staff.team_members` is discoverable because that kind is declared. Export and dry run report linked member references; the run refuses an unnamed related member unless explicitly excluded, as the erasure contract requires. No link means no related subject. When both user and member are named, each path processes only its own reviewed subject.

`staff.team_members` sets `anonymizeOwnerWhenRetained: false` for its `staff:team_member` owner path. Consume C4 assumption 18, “The operation” and “The run”, step 7: the flag prevents dependent retention from coercing the reviewed `delete` preference into `anonymize`. Under `delete`, the declared identifying employment block may remain `retained` / `legal_retention` or `open_case`; explicit `--prefer anonymize` while legal retention keeps an identified employment record is refused by `checkErasable` in pre-flight before any write with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW`, and rechecked before owner mutation. The refusal message tells the operator to run with `--prefer delete`: it deletes everything not under legal retention and keeps the identified employment root, reported as `retained` with `retainReason: 'legal_retention'` and its `retainedUntil`. Pending leave retains its existing `open_case` handling. It never means the named root is anonymous. Assumption 2 and C4 assumption 18 keep the human policy gate; without its authorization, refuse member apply with that code for manual review. When no identifying block needs retention, anonymize clears it. Set `privacy_retained_at` while any identifying employment block survives and return `retained`; `anonymizedAt` stays null. Only final identifying-field clearing removes `user_id`, clears that mark and sets `anonymized_at`. The flag has no effect on the related-only `auth:user` path.

### Staff and planner table matrix

All rows, including soft-deleted rows, are scoped to the tenant and optional organization. “Now” means initial member erasure. “Final” means erasure already past the age or the later employment set. Kept rows use `legal_retention`, except pending leave's `open_case`; shared work/authorship retained without a defined end is reported as `shared_record`/`other_party`. Do not label a section anonymized while a declared identifying copy remains.

For exports select only the subject's contribution. Redact other people's names, private bodies and credentials. Fields listed as configuration are exempt from subject erasure because they have no subject ownership/link, not because arbitrary free text is guaranteed non-personal. Unlinked mentions in shared configuration/work text are an explicit limit.

| Table | Subject link and export | Now | Final / set effect | History handling |
|---|---|---|---|---|
| `staff_teams` | No member/person column; team name/description is shared configuration | Exempt: tenant team configuration | Unchanged | No changed record |
| `staff_team_roles` | Team role name/description/appearance, no member ownership | Exempt: shared role vocabulary | Unchanged | No changed record |
| `staff_team_members` | Member id or `user_id`; own display name, description, tags, roles, custom values | Delete profile description/tags/custom values and clear rule-set preference; keep name/user id only with retained employment block; set retention mark | Replace name with shared placeholder; clear user id, remaining personal values and mark; set anonymized timestamp; keep tombstone id and non-personal totals references | Member and custom-value owner record |
| `staff_leave_requests` | `member_id`; dates, timezone, status, reasons, note, decision/comment | Retain identified block until anchor/age; pending is `open_case` | Clear reason entry/value, note, decision comment and subject's submitting/deciding ids; keep dates/status against tombstone | Every changed leave and member |
| `staff_team_member_comments` | `member_id`; body and author attribution with other-party redaction | Delete | Already gone | Every deleted comment |
| `staff_team_member_activities` | `member_id`; subject, body, activity/date and attribution | Delete | Already gone | Every deleted activity |
| `staff_team_member_job_histories` | `member_id`; job/company, dates, description | Delete | Already gone | Every deleted history row |
| `staff_team_member_addresses` | `member_id`; all address fields including coordinates | Delete | Already gone | Every deleted address |
| `staff_time_entries` | `staff_member_id`; work date, durations, notes, project/task and billable/rate fields | Retain employment record, including notes under assumption 2 | Clear notes and owned custom values; keep dates/durations/amounts against tombstone | Changed entry and its member/report parents |
| `staff_time_entry_segments` | Through `time_entry_id`; start/end/type | Retain with employment entry | Keep numeric/time record against tombstone entry; no name/text column to clear | Include segments if changed; include parent entry for snapshot copies |
| `staff_time_projects` | `default_assignee_staff_member_id` for member; `owner_user_id` for auth; `customer_id` for customer copies | Clear erased member's default-assignee link now; user's ownership retained id-only as `other_party`; clear matched customer snapshot through customer class | Shared project/financial fields stay; no HR set ownership of another member's project | Every edited project, even if owned by someone else |
| `staff_time_project_members` | `staff_member_id`; project, role/status, visibility, assignment dates | Export then delete membership | Already gone | Every deleted membership and parent project if snapshot carries it |
| `staff_time_task_statuses` | Project vocabulary only, no subject column | Exempt: shared board configuration | Unchanged | No changed record |
| `staff_time_tasks` | `assignee_staff_member_id`; `created_by_user_id`; customer through `customer_id` and portal ticket | Clear erased member's assignee now; keep shared work title/body as `shared_record`, explicit free-text limit. Customer class replaces portal ticket task title with reference and clears description; retain creator id-only as authorship | No employment-set blanket deletion of shared tasks; clear member-owned custom values where present | Every edited task |
| `staff_support_tickets` | `reported_by_customer_user_id`; customer via linked task's `customer_id` | Customer class clears matched display snapshot; portal author clears `reporterDisplayName`, request subject/body and reporter id; task copy handled above | Unchanged by HR set | Ticket and edited task |
| `staff_support_routing_rules` | Category/project routing only | Exempt: tenant routing configuration | Unchanged | No changed record |
| `staff_time_task_comments` | `author_customer_user_id` for portal subject; `author_user_id` for staff authorship | Portal class clears body and `author_display_snapshot`, nulls `author_customer_user_id`; staff-authored comments about others retained as `other_party` with id-only attribution | No HR-set deletion of comments owned by others; report unrelated quoted-text limit | Every edited comment plus parent task if its snapshot carries the comment |
| `staff_time_tags` | Tag vocabulary; link to member only through entry/tag joins | Exempt: shared labels, no subject-owned row; export labels through subject joins | Keep shared vocabulary | No changed record |
| `staff_time_task_tags` | Through shared task | Export tags for exported subject contribution; shared joins retained as `shared_record` | Unchanged; no member column to clear | No changed record unless a subject-owned task copy changes |
| `staff_time_entry_tags` | Through subject entry | Export label; delete joins now because tagging is not employment evidence | Already gone; shared tag stays | Deleted join and parent entry |
| `staff_time_reports` | Through subject entries/frozen entries; customer by `customer_id`; actor ids for auth authorship | Retain subject's financial contribution; customer class clears own customer snapshot; export report reference/dates and own contribution only | Replace free-text title with report reference and clear personal custom values if the report contains this member; preserve other contributors' totals and customer record | Every edited report, including shared reports |
| `staff_time_report_projects` | Report/project junction, no member field | Retain with shared report; export only context for subject contribution | Keep ids; no personal value to blank | No changed record; parent report included when edited |
| `staff_time_report_entries` | `time_entry_id` resolves member; frozen minutes/rates/currency/amount/billable fields | Retain with employment record; export only subject rows | Keep numeric frozen values against tombstone entry. There is no frozen-name column; member name comes through joins | Include changed rows if any; entry and report for containing snapshots |
| `staff_time_report_events` | Through reports containing the subject's entries; actor id is authorship | Retain event evidence while employment block kept, export type/time and subject-relevant reason/metadata with others redacted | Clear event reason and metadata except a typed numeric/enum accounting allowlist; keep event type/time and unrelated actor id as `other_party` | Every edited event and containing report |
| `staff_timesheet_preferences` | `staff_member_id`; last project | Export then delete | Already gone | Deleted preference and member if its snapshot carries it |
| `planner_availability_rules` | `subject_type = member` and `subject_id = member id`; timezone, recurrence, exceptions, note/reason | Planner class exports/deletes rules | Already gone | Every deleted rule |
| `planner_availability_rule_sets` | Reusable set name/description/timezone, not a member-owned row | Exempt: shared schedule template; staff clears the member's rule-set link through its own handler | Keep shared set and rules for resources/rulesets | No changed record |

**Custom fields.** Staff's `ce.ts` declares member, entry, project, task, report and tag custom-field surfaces. Consume C4's “Custom values — `entitiesPrivacyService`”: `listCustomValuesForPrivacy({ scope, entityId, recordIds, after?, limit }, { em? })` returns `{ records: Array<{ recordId: string; organizationId: string | null; values: Record<string, unknown>; recordIdentities: Array<{ table: 'custom_field_values'; rowId: string; columns: string[] }> }>, next?: string, done: boolean }`; `clearCustomValuesForPrivacy({ scope, entityId, recordIds, dryRun }, { em })` returns `{ affected: number, historyRecords: PrivacyHistoryRecord[], recordIdentities: Array<{ table: 'custom_field_values'; rowId: string; columns: string[] }> }`. Prove the entity/record ids from staff's own rows, bound record ids and page size to 100, and exhaust scoped pages, including soft-deleted values and removed definitions. Ambiguous tenant-less values and decryption failures refuse affected apply or leave export incomplete; never import entities tables. With `em`, listing uses the caller's transaction and the same scoped value locks as clearing. Clearing uses that transaction without a nested commit or snapshot-bearing command; dry run returns complete planned history identities and projected survivors, apply returns actual changed history identities and actual survivors, normally `[]` after hard deletion. Union its planned/actual `entities.custom_field_value` histories with the actual staff owner identities and run required field/index/cache side effects after commit. Export only the subject's values. Delete all member profile custom values now; clear values on subject entries and retained report contributions at final blanking. Shared project/task/tag values are retained as `shared_record` and the arbitrary-mention limit is reported; no claim of full anonymity for those shared sections. Exact retained-custom-value evidence uses the owner-returned `recordIdentities` below. New sensitive copy storage would need encryption maps; this revision adds none.

### Run-bound retained declarations and evidence

Consume [`2026-11-16-privacy-verification-suite.md`](2026-11-16-privacy-verification-suite.md), “1. Run-bound retained declarations” and “Definition and run evidence”. Its `PrivacyRetainedDeclaration` has `{ section, table, columns, reason }`; the enclosing class supplies the class id. Populate `privacy.ts.dataClasses[].retained` with the exact entries below. They allow only the listed identifier/personal columns on the actual selected rows, not an entire table or JSON policy waiver. Numeric accounting fields/dates may remain under the stated outcomes; every captured fixture row still needs row-presence evidence. JSON columns additionally obey the existing typed reducers; column-level permission never permits a cleared email/name to survive inside a different key.

Consume R3-14 — “The `eraseSubjects` entry point” — and C4's “Contract additions — `@open-mercato/shared/modules/privacy`”. Import `PrivacyRetainedRecord` from `@open-mercato/shared/modules/privacy`: every section carries runner-stamped `dataClassId`, and each retained section returns `retainedRecords: PrivacyRetainedRecord[]`. For each selected surviving row, emit one record for each applicable row below, using its actual primary key (the exit reader's stable `rowId` encoding), the listed columns that really survive this branch, and the same reason as `retainReason`. Never include another row, a deleted row or a column cleared in this branch. Deduplicate identical records. Dry run predicts these same identities; apply reports only committed, verified standing survivors. `affected` is not row evidence; unchanged standing retained rows still need evidence with zero changes. Non-retained sections emit no retained permission. Split anonymized content and retained structural/other-party subsets into separate sections with the keys below. Keep the existing `retainedUntil` and `retentionSetId` on time-bounded/open-case sections; indefinite structural sections have null end and no invented set.

C4 now defines optional `PrivacyErasureSectionResult.dataClassId` / `retainedRecords` and `PrivacyRetainedRecord` for compatibility, and requires stamped exact evidence for new verified runs. Populate every retained staff/per-user section below, including zero-change authorship and related-member links, from the scoped selected-row inventory with exact surviving columns, reason, end and set. The runner preserves these fields on flattened `PrivacyErasureRunResult.subjects[].sections`, its private report and encrypted completed audit, so verification consumes the applied run rather than asking the handler to excuse a leftover later. No completion-event field or new reason is introduced; the event omits retained-row evidence.

| Class | Section | Reason | Table | Exact retained identifier/personal columns |
|---|---|---|---|---|
| `staff.team_members` | `related_member` | `other_party` | `staff_team_members` | `id`, `tenant_id`, `organization_id`, `user_id` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_team_members` | `id`, `tenant_id`, `organization_id`, `display_name`, `user_id`, `team_id`, `role_ids` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_leave_requests` | `id`, `tenant_id`, `organization_id`, `member_id`, `submitted_by_user_id`, `decided_by_user_id`, `note`, `decision_comment`, `unavailability_reason_entry_id`, `unavailability_reason_value` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_time_entries` | `id`, `tenant_id`, `organization_id`, `staff_member_id`, `time_project_id`, `task_id`, `customer_id`, `deal_id`, `order_id`, `locked_report_id`, `notes` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_time_entry_segments` | `id`, `tenant_id`, `organization_id`, `time_entry_id` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_time_reports` | `id`, `tenant_id`, `organization_id`, `title`, `reference`, `customer_id`, `customer_snapshot`, `created_by_user_id`, `closed_by_user_id` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_time_report_projects` | `id`, `tenant_id`, `organization_id`, `report_id`, `time_project_id` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_time_report_entries` | `id`, `tenant_id`, `organization_id`, `report_id`, `time_entry_id` |
| `staff.team_members` | `employment` | `legal_retention` | `staff_time_report_events` | `id`, `tenant_id`, `organization_id`, `report_id`, `actor_user_id`, `reason`, `metadata` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_team_members` | `id`, `tenant_id`, `organization_id`, `display_name`, `user_id`, `team_id`, `role_ids` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_leave_requests` | `id`, `tenant_id`, `organization_id`, `member_id`, `submitted_by_user_id`, `decided_by_user_id`, `note`, `decision_comment`, `unavailability_reason_entry_id`, `unavailability_reason_value` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_time_entries` | `id`, `tenant_id`, `organization_id`, `staff_member_id`, `time_project_id`, `task_id`, `customer_id`, `deal_id`, `order_id`, `locked_report_id`, `notes` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_time_entry_segments` | `id`, `tenant_id`, `organization_id`, `time_entry_id` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_time_reports` | `id`, `tenant_id`, `organization_id`, `title`, `reference`, `customer_id`, `customer_snapshot`, `created_by_user_id`, `closed_by_user_id` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_time_report_projects` | `id`, `tenant_id`, `organization_id`, `report_id`, `time_project_id` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_time_report_entries` | `id`, `tenant_id`, `organization_id`, `report_id`, `time_entry_id` |
| `staff.team_members` | `pending_employment` | `open_case` | `staff_time_report_events` | `id`, `tenant_id`, `organization_id`, `report_id`, `actor_user_id`, `reason`, `metadata` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_team_members` | `id`, `tenant_id`, `organization_id`, `team_id`, `role_ids` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_leave_requests` | `id`, `tenant_id`, `organization_id`, `member_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_entries` | `id`, `tenant_id`, `organization_id`, `staff_member_id`, `time_project_id`, `task_id`, `customer_id`, `deal_id`, `order_id`, `locked_report_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_entry_segments` | `id`, `tenant_id`, `organization_id`, `time_entry_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_reports` | `id`, `tenant_id`, `organization_id`, `reference`, `customer_id`, `customer_snapshot`, `created_by_user_id`, `closed_by_user_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_report_projects` | `id`, `tenant_id`, `organization_id`, `report_id`, `time_project_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_report_entries` | `id`, `tenant_id`, `organization_id`, `report_id`, `time_entry_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_report_events` | `id`, `tenant_id`, `organization_id`, `report_id`, `actor_user_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_projects` | `id`, `tenant_id`, `organization_id`, `name`, `description`, `customer_id`, `customer_snapshot`, `owner_user_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_tasks` | `id`, `tenant_id`, `organization_id`, `title`, `description`, `customer_id`, `created_by_user_id`, `time_project_id`, `parent_task_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_task_tags` | `id`, `tenant_id`, `organization_id`, `task_id`, `tag_id` |
| `staff.team_members` | `shared_work` | `shared_record` | `staff_time_tags` | `id`, `tenant_id`, `organization_id`, `label` |
| `staff.team_members` | `employment` | `legal_retention` | `custom_field_values` | `id`, `tenant_id`, `organization_id`, `entity_id`, `record_id`, `field_key`, `value_text`, `value_multiline`, `value_int`, `value_float`, `value_bool` |
| `staff.team_members` | `pending_employment` | `open_case` | `custom_field_values` | `id`, `tenant_id`, `organization_id`, `entity_id`, `record_id`, `field_key`, `value_text`, `value_multiline`, `value_int`, `value_float`, `value_bool` |
| `staff.team_members` | `shared_custom_fields` | `shared_record` | `custom_field_values` | `id`, `tenant_id`, `organization_id`, `entity_id`, `record_id`, `field_key`, `value_text`, `value_multiline`, `value_int`, `value_float`, `value_bool` |
| `staff.authorship` | `authorship` | `other_party` | `staff_time_projects` | `id`, `tenant_id`, `organization_id`, `owner_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_time_tasks` | `id`, `tenant_id`, `organization_id`, `created_by_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_leave_requests` | `id`, `tenant_id`, `organization_id`, `submitted_by_user_id`, `decided_by_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_team_member_comments` | `id`, `tenant_id`, `organization_id`, `author_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_team_member_activities` | `id`, `tenant_id`, `organization_id`, `author_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_time_task_comments` | `id`, `tenant_id`, `organization_id`, `author_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_time_reports` | `id`, `tenant_id`, `organization_id`, `created_by_user_id`, `closed_by_user_id` |
| `staff.authorship` | `authorship` | `other_party` | `staff_time_report_events` | `id`, `tenant_id`, `organization_id`, `actor_user_id` |
| `staff.customer_copies` | `support_structure` | `shared_record` | `staff_time_projects` | `id`, `tenant_id`, `organization_id`, `customer_id`, `owner_user_id` |
| `staff.customer_copies` | `support_structure` | `shared_record` | `staff_time_reports` | `id`, `tenant_id`, `organization_id`, `customer_id`, `created_by_user_id`, `closed_by_user_id` |
| `staff.customer_copies` | `support_structure` | `shared_record` | `staff_support_tickets` | `id`, `tenant_id`, `organization_id`, `task_id` |
| `staff.customer_copies` | `support_structure` | `shared_record` | `staff_time_tasks` | `id`, `tenant_id`, `organization_id`, `customer_id`, `created_by_user_id`, `time_project_id`, `parent_task_id` |
| `staff.customer_copies` | `support_structure` | `shared_record` | `staff_time_task_comments` | `id`, `tenant_id`, `organization_id`, `task_id`, `author_user_id` |

For an identified member emit `employment` for the selected legal block, or `pending_employment` with null end when pending leave blocks final clearing; use `retentionSetId: staff.retained_employment_records`. The same member row's exact record uses its actual id and `[id, tenant_id, organization_id, display_name, user_id, team_id, role_ids]`; include only columns actually present and kept. At final blanking it is replaced by `shared_work` evidence containing `[id, tenant_id, organization_id, team_id, role_ids]`; neither `display_name` nor `user_id` remains retainable then. Member placeholders do not preserve the original name. Preserve only the subject's frozen financial rows, never another contributor's row merely because the report is shared.

Every `employment` section uses the computed member end, or null while the age is unset, and the employment set above; `pending_employment` uses null and that same set. `related_member`, `shared_work`, `shared_custom_fields`, `authorship` and `support_structure` carry null end and no set, with their declared other-party/shared-work limit stated. Emit evidence for every actual surviving report/event/comment/custom-value row selected by that branch, including unchanged rows with `affected: 0`; never borrow the member root's evidence for its children.

The three `custom_field_values` declarations apply only to rows selected by the entities owner's scoped seam for the explicit served entity/record ids: entry/report contribution values use the employment branch and are deleted at final clearing; shared project/task/tag values use `shared_custom_fields` and remain explicitly retained. Member-profile values are deleted immediately and grant no retained evidence. C4's listing method supplies each actual value row's `rowId` and surviving `columns` in `recordIdentities`; intersect those columns with the matching declaration above and attach that branch's reason, never the parent entity id or a value snapshot. Its clear method supplies planned/actual history and projected/actual survivor identities in the caller's transaction. Missing or malformed identity results refuse affected retained-custom-value apply in pre-flight; never query `custom_field_values` here or infer row ids from a field key. C5 baseline/seam metadata is not run-specific row permission.

`authorship` permits id-only attribution on the exact attributed row, not copied author names or the subject's personal text. If a shared work row is kept for a member, return its own `shared_work` evidence; do not infer permission from another class's authorship section. `staff.customer_copies` returns exact `support_structure` rows for surviving project/report/ticket/task/comment shells, while reporter/author customer ids and display/body copies it clears are absent from those permissions. Shared JSON customer snapshots about a genuinely different party are reviewed separately; no column permission may conceal this subject's reporter name. The related-only `auth:user` member path changes no member and reports the member reference/exclusion. Its standing `related_member` / `other_party` section gives exact row evidence only for the kept member id/scope/`user_id` link, with `affected: 0`; it grants no permission for the excluded member’s broader profile or child values. Those belong to a separately reviewed member subject, not an implicit user deletion.

`planner.availability`, `onboarding.requests`, `notifications.inbox`, `perspectives.views`, `dashboards.layouts`, `push_notifications.deliveries`, `devices.user_devices`, `api_keys.keys` and `integrations.user_credentials` declare `retained: []` for their matched user/member-owned rows. Every row they plan to delete must be absent, including id-only preferences/junctions and orphaned captured children. Deleted member addresses/comments/activities/job histories/project memberships/entry tags/preferences have no retained evidence. Unattributed configuration mentions stay a stated discovery gap, never an invented retained row.

### Retention anchor, markers and set

Compute the employment anchor in UTC from all subject entries, including soft-deleted ones: maximum of time entries' work `date` at UTC day end and approved/rejected leave requests' `end_date` at UTC day end. Member creation is only a fallback for an empty date set, not a lower bound on imported historical work. Future approved/rejected leave is included and moves the end forward. No entries or leave means member `created_at`. Pending leave prevents final blanking and reports `open_case` / `retainedUntil: null`; malformed dates refuse that member for manual review. There is no guessed employment-end field.

Add the configured whole calendar years to that anchor, clamping 29 February to 28 February in a non-leap year. Before that end, retain the stated block with `privacy_retained_at`, `retainedUntil` and `retentionSetId: staff.retained_employment_records`. With no age set use null. At or after the end, blank every “Final” copy in the matrix, clear `user_id` and the retention mark, and only then set `anonymized_at`. An `auth:user` hold is still matchable through `user_id` up to that last write. Recompute anchor, pending state and exclusions under the batch's locks; newly added work or leave must not allow premature blanking. Re-runs report standing retained/anonymized outcomes without reintroducing profile data.

| Set | Matches / age | Effect | Declaration |
|---|---|---|---|
| `staff.retained_employment_records` | Members marked `privacy_retained_at`; anchor above, past calendar end and caller window; no pending leave | All “Final” matrix changes, current history stripping, clear user link/mark, set anonymized timestamp | `targets: ['records']`, `minimumDays: 365`, `excludableSubjectKinds: ['staff:team_member', 'auth:user']` by member id and still-present user id |

Consume DEC-C — “Retention sets and holds”, owned by the record-retention spec. The set refuses while the tenant age is unset or the caller window is shorter than the `365 * configuredYears` days. Calendar eligibility is rechecked independently of that floor. A registered guard failure refuses; an unsupported exclusion kind skips with `hold_not_honourable`. OSS operators must supply `--exclude-subject` themselves; enterprise registers the legal-hold guard. Held rows stay marked. R3-5 — “Holds, honestly” — in the program owns the OSS/enterprise limit: no OSS legal-hold engine is implied. Internal blankers create no before/after snapshots carrying cleared values.

Use R3-1 — “The audit-history rule for every erasure”, and DEC-B — “The audit-history strip routine” — in the erasure spec's “Contract additions” and `applyRetention` sections. Every edited/deleted record in the matrix is returned as `historyRecords`, including shared reports/projects/comments and parents carrying their snapshots. The orchestrator owns its two strip passes and locked undo/redo checks. The later retention handler collects the same full footprint and strips its current history before and after blanking through `actionLogService.applyRetention` with `includeRecords` in the batch transaction; exhaust bounded pages, and roll back if stripping fails. This catches entries created after initial erasure. Resource kinds come from existing command logs (`staff.teamMember`, `staff.timesheets.time_entry`, and other command-owned constants), not table-name guesses.

### Settings and database doctor check

Consume R3-3 — “Tenant privacy settings live in `module_configs`”, owned by the contract spec, and R3-4 — “An opt-in database tier for the doctor”, owned by the doctor spec. This coverage spec supplies declarations, not a new staff settings table or page.

| Declaration | Value |
|---|---|
| Name | `retention.staff.employmentRecordAgeYears` |
| Type/unit/minimum | `type: 'integer'`, `unit: 'years'`, `minimum: 1`; validated by `z.number().int().min(1)` and calendar anniversaries |
| Default | No `default` member; unset means legal-retention pruning refuses |
| Read | `privacySettingsService.get(scope, name)`; no instance fallback |
| Write/list | `mercato privacy settings set --tenant <id> retention.staff.employmentRecordAgeYears <value>` and `mercato privacy settings list --tenant <id>` |
| Label | `staff.privacy.employmentRecordAgeYears`, through locale files |
| Check | Declare `staff.retention_age_unset`, `needs: 'database'`, in `staff/privacy.ts.doctorChecks`; consume C1 Phase 7's get-only settings factory under R4-7, complement `privacy.retention_settings_unset` and never read configs tables |

Declare the setting in `staff/privacy.ts.settings` using the contract's `PrivacySettingDefinition`. Read the validated `value` from the `{ name, value, source, updatedAt }` envelope returned by `privacySettingsService.get(scope, name)`; missing is unset, never zero. The shared CLI owns setting audit and version conflicts; enterprise routes/page supply feature ACL and mutation guards over that service. Under R4-7, `staff.retention_age_unset` constructs `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` with staff's validated setting definitions and the doctor's transaction-bound manager and allowed tenant list. Its async check calls `get(scope, name)` and tallies `source: 'unset'` and `SETTING_INVALID`; other service/database errors become `doctor.check_failed`. Return aggregate counts only, never values, versions or tenant ids. The default doctor run lists it as `database_not_requested`, without opening a database or constructing the reader. `mercato privacy doctor --only staff.retention_age_unset --database` constructs the same get-only capability independently, without general application DI bootstrap. C1's “Bootstrap-free settings reads — R3-3” defines that factory, returning `Pick<PrivacySettingsService, 'get'>` through the configs-owned `createModuleConfigPrivacyReader({ em })`. R4-7 permits these settings reads alongside counting queries; the shared `privacy.retention_settings_unset` check complements the staff check. No new doctor context member is needed. R3-2 — “The registry carries the whole `privacy.ts` default export” — owns member collection; DEC-I — “The doctor's extension point” — owns `doctorChecks`.

### Per-user rows, scope and credentials

For all classes, organization absent means the tenant's organizations; present means that organization plus rows with no organization. After the auth owner's tenant check, key/view/dashboard predicates match `(tenant_id = scope.tenantId OR tenant_id IS NULL)` and the verified owner id, plus that organization rule. Never match a row with another non-null tenant. Without a tenant-bound owner proof, refuse before listing or deleting tenant-less rows. Exports require that proof too, via the auth owner's handler rather than a cross-module read.

| Class | Concrete history footprint / exemption |
|---|---|
| `onboarding.requests` | Deleted `onboarding_requests` rows; password/token hashes omitted from export |
| `notifications.inbox` | Deleted `notifications` and `notification_preferences`; `notification_types` and `notification_type_overrides` are shared configuration |
| `perspectives.views` | Deleted `perspectives`; `role_perspectives` is shared role configuration |
| `dashboards.layouts` | Deleted `dashboard_layouts` and `dashboard_user_widgets`; `dashboard_role_widgets` is shared role configuration |
| `push_notifications.deliveries` | Deleted `push_notification_deliveries`, before device deletion |
| `devices.user_devices` | Deleted `user_devices` |
| `api_keys.keys` | Deleted `api_keys`, including soft-deleted user-owned rows |
| `integrations.user_credentials` | Every scoped user-owned `integration_credentials` row planned/deleted after all records classes succeed, freshly re-listed including disconnected and soft-deleted rows; never credential contents in history; integration logs are owned by retention |
| `staff.authorship` | No mutation and no changed history records; retained `other_party` references reported |

R4-1 makes `integrations.user_credentials` the only class that owns deletion of per-user credential rows for a subject. DI `integrationCredentialsService` gains scoped `listByUser({ scope, userId })`, `hardDeleteByUser({ scope, userId })` and the integrations-owned `deleteUserCredential({ scope: PrivacyScope, userId, credentialId })`, using the exact signature in communication coverage's “API Contracts — Credential method”. The communication class disconnects the subject's channels, clears their credential pointers and calls this integrations method; it declares no credential class of its own. The A9 cascade calls the same method. Reuse these integrations-owned additions if A9 delivers them first. All include soft-deleted rows, enforce tenant plus optional organization in SQL, and never act on `user_id IS NULL`, another user or another tenant. Tenant-wide calls retain each row's actual organization predicate. Listing returns safe metadata only; deletes expose safe metadata/history, never secrets. `deleteUserCredential` hard-deletes only the named user's row, with missing row idempotent, and uses the caller's transactional manager through DI. All inputs are zod validated; service operations use shared encryption helpers rather than direct cross-module table access.

Phase 2's credential work depends explicitly on communication coverage Phase 1 and A9's scoped methods if A9 ships them. When communication is enabled, `checkErasable` verifies `communication_channels.conversations`, its records-group declaration and required disconnect/reference-clearing capabilities before any user mutation. Communication owns disconnecting channels and clearing identifying fields, state and `credentials_ref`, including on soft-deleted channels; actual credential-row deletion belongs to integrations through the shared method above. After every records class succeeds, only `integrations.user_credentials` freshly re-lists by the checked user id and hard-deletes all scoped personal rows, including disconnected and soft-deleted ones, without relying on a channel pointer. There is no `communication_channels.user_credentials` class in the current communication contract. Dry run preplans the complete channel/credential history identities without secrets. A failed records class prevents credential deletion; a late credential failure leaves the run incomplete for retry through the same scoped listing. A9 remains the separate ordinary-user-delete repair: its `deleteUserCredential` call and pointer clearing share a transaction, and a failed deletion preserves that pointer. C4's “The run”, steps 5–6, owns this records-before-credentials ordering. R4-1 requires the communication class to call the hard-deleting integrations method, but communication's current “Classes” and Phase 1 keep that class in `records` and forbid credential deletion there. The placement of that call without violating the barrier remains `OPEN_DESIGN`, owned by communication coverage.

For every class in both tables, `eraseSubject({ dryRun: true })` returns the full planned `{ resourceKind, resourceId }` list in required `historyRecords`; apply returns every actual edited/deleted identity, including a retention marker, a custom-value owner and another person's shared record. The related-only `staff.team_members` user path and unchanged `staff.authorship` return `[]`. Planner returns deleted rule identities. `staff.customer_copies` returns every edited project, report, ticket, task and comment, plus snapshot-containing parents. Use existing command resource kinds; R3-1 maps an unlogged row from its discovered module entity id by replacing `:` with `.`. No silent planning limit is allowed. Newly encountered unplanned identities cause `REPLAN_REQUIRED` before mutation. Consume both R3-1 strip passes with `includeSubjects` and the full planned/journaled/returned `includeRecords` union; disclose removal of unrelated history on shared rows. Every internal blanker writes no undo snapshot or audit entry carrying cleared values.


The erasure owner's attachment-release methods now return planned/actual `historyRecords` and survivor `recordIdentities` alongside released/pending/retained/skipped files. File-using classes consume those owner-returned identities in the caller's transaction through the trailing `{ em, dryRun?: boolean }` options. Current assignments are embedded in `attachments.storage_metadata`, so the owner returns the containing row as `attachments.attachment`; callers never infer assignment row ids or read attachment tables. Union the complete planned/actual history footprint under R3-1 and match surviving columns only to the caller's declared retained-file section. Missing or truncated identity results still refuse affected apply or leave the section incomplete; the specified owner result is no longer a missing-design prerequisite.

### Source notification copies and staff address gaps

The communication spec's “Source notification copies” is the design owner for message-derived copies delivered to other recipients. Its messages service calls `notificationService.clearSourceForErasure({ scope, sourceEntityType: 'message', sourceEntityIds, dryRun })`; notifications blanks the source-bearing fields and calls push's owner service by notification ids. Both return `{ affected, historyRecords, sections }`, with `sections: PrivacyErasureSectionResult[]` carrying separate cleared sections and exact colleague notification/push survivor evidence from those owners, including their actual row ids and columns. Preserve those sections and every other user's edited history identity; message ids and recipient counts cannot substitute for owner evidence. The `notifications.inbox` and `push_notifications.deliveries` classes here still delete the erased recipient's own rows; they do not duplicate message-source traversal or delete colleagues' inboxes. Missing source-clearing support leaves that communication section incomplete; retry workers re-read cleared source state. Device/email copies already delivered remain outside database erasure.

Communication's “Known limits” explicitly reports the absent `auth:user` address aliases: staff forwarding addresses/names, inbox message outside fields and address-only call participants cannot be reached by staff id. Every staff account export/erasure report carries that unresolved coverage alongside its id-based sections. This spec does not silently turn those records into complete staff coverage.

### Portal customer copies

For a CRM customer, `staff.customer_copies` clears their matched customer display snapshots on projects, reports and tickets. For a reporting portal user it also clears `customer_snapshot.reporterDisplayName`, nulls `reported_by_customer_user_id`, clears the request snapshot, replaces the linked portal task's title with its reference and clears description. For a commenting portal user clear their comment body, set `author_display_snapshot` to the shared display-name placeholder and null `author_customer_user_id`. Leave other users' comments and internal tasks alone. Return every edited ticket, task and comment as history records under R3-1. A company customer's display name is not cleared merely because an unrelated portal author is erased.

### Unfinished signups

A scheduled queue worker prunes rows after `OM_ONBOARDING_PENDING_RETENTION_DAYS` (integer days, minimum 1, default 30). It selects bounded keyset batches, but applies all eligibility predicates again in the DELETE statement itself:

- `user_id IS NULL` and status is pending, processing or expired;
- `COALESCE(updated_at, created_at)` is strictly before the age cutoff, with `created_at` used only for legacy null updates;
- status is not processing, or `processing_started_at IS NULL`, or it is at or before `now - 15 minutes`.

Use one captured clock per batch. The 15-minute freshness rule matches `packages/onboarding/src/modules/onboarding/api/get/onboarding/verify.ts`; extract a shared module-local constant used by verification and pruning so it cannot drift. A stale crashed process is eligible. Recheck user, status, update time and processing time in the deletion predicate, so a reused/claimed/completed row between selection and delete survives. No personal values or secrets enter prune logs. This is system-scope age cleanup of unfinished rows, not a tenant subject erasure or legal-hold operation. Use the existing worker/scheduler contracts; no polling loop.

### Coverage metadata and mixed-store remainders

Consume C5's “Declarations and row subsets”, “First root inventories” and exact `tables` / `entityIds` / `seams` contract. The staff matrix describes subject outcomes; it is not a whole-table waiver. A module lists only its own canonical tables. A dynamic member/user id or a multi-table join is not a finite C5 discriminator. Leave an inexpressible partial slice and its unmatched/orphaned remainder on the baseline until a complete handler or reasoned classification covers it. Shared configuration with `name`, `description`, JSON or another suspicious column requires per-column `reviewedColumns` reasons before an exemption, never a table-wide assertion that text is non-personal.

| Owner / store | Classification boundary |
|---|---|
| Staff member root | `staff.team_members` handles the `staff_team_members` root by exact member id, including members with no login; register the served custom-field `entityIds: ['staff:staff_team_member', 'staff:staff_time_entry', 'staff:staff_time_project', 'staff:staff_time_task', 'staff:staff_time_report', 'staff:staff_time_tag']` from C4's “Shared-store seam declarations”, validated against `staff/ce.ts` and discovery, never subject kinds |
| Staff employment/support/work tables | The matrix's member/customer/author joins cover only those contributions. Shared projects/tasks/reports, custom values and unattributed/orphaned children remain explicit baseline identities unless C5 can express a fully served subset. The HR set never classifies another member's contribution as deleted |
| Planner | `planner_availability_rules` can partition on real `subject_type`, with subset `members` having `values: ['member']` and a `planner.availability` class claim only when every member-rule row is served, including orphan handling; otherwise keep this candidate subset baselined. Its resource/ruleset/null/future `remainder` needs its own classification/backlog. `planner_availability_rule_sets` remains shared-template review, not member coverage |
| Per-user stores | Own row lists are `onboarding_requests`, `notifications`, `notification_preferences`, `perspectives`, `dashboard_layouts`, `dashboard_user_widgets`, `push_notification_deliveries`, `user_devices`, `api_keys`, `integration_credentials`. Unknown owners, null-user or ambiguous tenant-less rows keep mixed tables baselined; a user-filtered class is not a whole-table claim |
| Shared definitions / operational stores | Notification types/overrides, role views/widgets, integration state/mappings and integration logs need independent reviewed configuration/reference/credential/retention classifications. Integration-log retention must resolve its actual pruner rather than become an unbounded exemption |
| Entities / attachments / action logs | Consume C4's “Shared-store seam declarations”: `entities.custom_values` / `entitiesPrivacyService` and `audit_logs.subject_history` / `subjectHistoryService` serve the six staff entity ids above; `attachments.records` / `attachmentService` serves only `staff:staff_team_member` among them. Any `covered_via_seam` lists that exact resolved `seam`, the actually served `entityIds` and consuming `classIds`, and covers only served subsets. Snapshot-only mentions, unknown resource kinds and all unserved entity types remain baseline remainders. DEC-G — “The tenant-export reader and its declarations” — keeps `tableExports` separate |

No phase removes a whole mixed table merely because it gained one class. Local declaration tests resolve all class/seam/set/entity ids and reject missing capabilities, duplicate claims and absent remainder entries; handler unit tests bootstrap only their actual owning DI registrars.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Blank a member during their user's run | Changes another reviewed subject's root and may destroy employment evidence |
| Mark an identified member `anonymized_at` | Misstates the retained outcome and leaves UI/export reporting false |
| Leave every tenant-less owner row | The verified owner check already supplies tenant membership |
| Reuse only `eraseIntegrationCredentials` | It empties the secret before soft deletion, but locates by integration/scope and leaves the row; it does not enumerate all user credentials |
| Skip every processing signup forever | Crashed processing never ends without another verification call |
| Delete all rows of a report containing one member | Destroys other people's financial contributions; clear only the declared subject copies |

### Known limits

- Notifications/push from unrelated or unattributed sources, and unlinked mentions in shared task/configuration text, may escape subject discovery. Message-source copies for other recipients are covered through communication’s “Source notification copies”, including push payloads; recipient-owned rows are deleted here. Shared sections actually found are reported retained with exact row evidence; unknown mentions are a coverage gap, never an anonymous result.
- Staff forwarding-address/name, inbox outside-field and address-only call copies remain unresolved because `auth:user` supplies no address aliases, as communication’s “Known limits” reports. Delivered device/email copies cannot be recalled.
- A member with no account is resolved by name candidates, then explicitly selected by id.
- Root ids and kept numeric work/financial values are tombstone-linked and may be re-identifiable with outside information; final blanking is removal of local identifying fields, not a legal anonymity guarantee.
- A user with no tenant cannot supply the owner proof needed for tenant-less row cleanup and is reported/refused by the tenant run.
- Integration logs naming a user are bounded by their owner's retention, not this class.
- Unset age, pending leave, a hold or an OSS operator not running the set can prolong employment retention; reports/checks make those states visible.

## 📝 Delta

### Capability: privacy-coverage-people-ops

#### ADDED Requirement: Complete per-user export and related members
The system SHALL include the user's own stores with secrets omitted, and SHALL report linked members without changing them.

##### Scenario: Member path is reachable
- WHEN `auth:user` is exported or checked in dry run
- THEN `staff.team_members` is called, reports linked members as related, and mutates none; no link reports no related member

#### MODIFIED Requirement: Per-user erasure
The system SHALL delete the user's own stores and all matching personal credentials after channel disconnect, including tenant-less private rows covered by the verified owner check.

##### Scenario: An organization-limited credential export
- WHEN one user has credentials in two organizations and one organization is requested
- THEN only its credentials and organization-less rows are listed; a scoped deletion follows the same predicate

##### Scenario: Tenant-less owner rows
- WHEN a verified tenant user has private keys/views/layouts without a tenant, plus another tenant's control row
- THEN their tenant-less rows are removed, the control stays, and an owner with no tenant is refused

##### Scenario: Channel failure
- WHEN the required channel class is missing or its records phase fails
- THEN credentials are not deleted; the user run refuses in pre-flight or remains incomplete for retry

Frozen by: `packages/core/src/modules/devices/__tests__/deactivate-keeps-token.characterization.test.ts` and `packages/core/src/modules/integrations/__tests__/credential-erasure.characterization.test.ts` (to be added).

#### ADDED Requirement: Retained employment blocks have honest markers and an end
The system SHALL distinguish retained from blanked members, use the exact anchor and apply every table outcome.

##### Scenario: Inside the age
- WHEN erasure retains name and work/leave evidence
- THEN `privacy_retained_at` is set, `anonymizedAt` is null, user link stays for exclusions, and the report gives `retainedUntil` or null and the set id

##### Scenario: Explicit anonymize while legal retention applies
- WHEN `--prefer anonymize` would leave an identified employment record under legal retention
- THEN pre-flight refuses with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW` before writes and tells the operator to run with `--prefer delete`
- THEN a reviewed run with `--prefer delete` deletes everything not under legal retention, keeps the identified employment root and reports it as `retained` / `legal_retention` with its `retainedUntil` and null `anonymizedAt`

##### Scenario: Final blanking
- WHEN the anchor anniversary and caller cutoff have passed, with no pending leave or exclusion
- THEN every Final copy is cleared, newer history is stripped, `user_id` is null and only then `anonymizedAt` is set

##### Scenario: Pending or future leave
- WHEN leave is pending or has a future decided end date
- THEN pending leave blocks final blanking with `open_case`; a future decided leave moves the reported calendar end forward

#### ADDED Requirement: Portal author copies
The system SHALL clear reporter and commenter display snapshots as well as request text.

##### Scenario: Reporter and commenter
- WHEN a portal author is erased
- THEN their ticket reporter name, task request copy and own comment body/name/id are cleared, with all edited records returned for history stripping

#### MODIFIED Requirement: Unfinished signup cleanup
The system SHALL delete old unfinished signups unless their processing lease is still fresh, and SHALL recheck the full predicate at deletion.

##### Scenario: Stale processing
- WHEN processing began at least 15 minutes ago and the last update is older than the age, with no user
- THEN the request is eligible, including legacy null processing times

##### Scenario: Reused between selection and delete
- WHEN signup updates or completes a selected request before deletion
- THEN its new update/user/status prevents deletion

Frozen by: `packages/onboarding/src/modules/onboarding/__tests__/pending-retention.characterization.test.ts` (to be added).

## 📝 Architecture

Each owning module supplies its `privacy.ts`, scoped handler and DI registration. Staff owns its matrix/blanker; planner deletes only its own member rules. Member/portal copy discovery consumes contract Phase 6 aliases; employment settings consume contract Phase 7. Entities custom values, audit history, credentials and channel coordination use owning service seams. R3-2/R3-3/R3-4/R4-7 remain owned by the contract/doctor specs; R3-1/DEC-B by erasure; DEC-C by record retention. No new UI page is needed.

| Touchpoint | Mechanism | Missing/failure behaviour |
|---|---|---|
| User ↔ member | Both subject kinds declared; related-subject review | No linked member is normal; unnamed member refuses unless excluded |
| Staff → custom values/history | `entitiesPrivacyService` and `actionLogService.applyRetention` | Required seam/retained identity inventory missing refuses before write; erasure strip failure leaves incomplete without undoing earlier commits; a retention batch rolls back its own writes |
| Credentials → channel phase | Registry pre-flight of communication's records handler; all records succeed before integrations-only credential deletion by fresh scoped user listing | Missing enabled class refuses; records failure prevents credential deletion; late credential failure leaves an incomplete retryable run without relying on a channel pointer |
| Settings/doctor | Shared privacy settings service; `staff.retention_age_unset` through C1 Phase 7's get-only factory under R4-7 | Unset age refuses legal set; default doctor cannot inspect it; unavailable reader/check is an error |
| Signup worker → scheduler | Existing queue worker/scheduler contracts | No schedule means no prune; doctor scheduler finding remains the pruner owner's check |

## 📝 Data Models

`staff_team_members` gains nullable `anonymized_at` and `privacy_retained_at`; the latter has a tenant-led partial index. Add tenant/org/user lookup indexes where a class lacks one, as determined from the existing entity indexes. No new table. Existing editable rows keep `updated_at` and list/detail `updatedAt`; `anonymizedAt` is an additive nullable response field, not a substitute version. New internal markers are set only by privacy handlers. Schema changes include migration/snapshot and safe concurrent index creation where required.

## 📝 API Contracts

- Kind `staff:team_member`; both subject kinds on `staff.team_members`; full `PrivacyScope` on all three credential methods; no member write on the `auth:user` path. Set `anonymizeOwnerWhenRetained: false` and consume C4 assumption 18 and R4-14: explicit `--prefer anonymize` while legal retention keeps the employment root identified refuses in pre-flight with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW`. Its message tells the operator to run with `--prefer delete`, which deletes everything not under legal retention and reports the identified root as `retained` / `legal_retention` with `retainedUntil`. Missing policy authorization keeps the existing manual-review refusal before writes.
- Reuse erasure's `retainedUntil?: string | null` and `retentionSetId?: string` in preview, completed audit and CLI output. Do not introduce a local `retainUntil` alias or a pending outcome.
- Reuse shared settings CLI, ACL, audit and conflict contract under R3-3; declare the exact staff setting/check above. Add locale keys for setting, unset/future/pending explanations and final placeholders.
- `OM_ONBOARDING_PENDING_RETENTION_DAYS` is documented in both env examples; template mirroring follows the create-app rules. The actual freshness constant stays module-local and shared by verify/prune.
- New service inputs and settings declarations use zod; tenant required, optional organization semantics enforced in SQL, record/page batches at most 100. Reads of encrypted fields use the existing decryption helpers; deletion-only signup queries need no plaintext load.
- If A9 has already shipped tenant-only credential signatures when this work is implemented, add scoped overloads and retain the old tenant-wide signature for one minor with deprecation and upgrade notes. This design's callers always use full scope; never reinterpret an old call as organization-limited.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| No linked member | User path reports no related subject and changes no member |
| Member has no entries or leave | Anchor is member creation, never undefined/infinite by accident |
| Pending leave, including old requests | Retained `open_case`; once decided the same set re-evaluates without another erasure |
| Future decided leave | End derives from its future end date |
| Final blanking after user deleted earlier | Clear dangling user id; no account lookup needed |
| Held member or their still-linked user | Leave marked block; unsupported hold kind skips whole set |
| Tenant-less key/view/layout with verified tenant owner | Include only that owner's row and applicable organization; other non-null tenants never match |
| Shared role dashboard or perspective | Tenant configuration, never user-owned deletion |
| Tenant-wide integration credential | `user_id IS NULL` is never listed/deleted here |
| Explicit `--prefer anonymize` with identified legal employment retention | Pre-flight refuses with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW` and tells the operator to run with `--prefer delete`; that run deletes non-retained data and reports the identified root as retained `legal_retention` with `retainedUntil` |
| Reused signup / fresh processing claim | DELETE rechecks status, user and timestamps; leave row |
| Stale processing with missing start timestamp | Eligible after age; null start never grants an unlimited lease |
| History-strip or channel-phase failure | Stop with the run incomplete and retryable; earlier module commits remain. Records failure prevents credentials, late DSR credential failure retries by scoped user listing, A9 ordinary-delete failure rolls back its pointer/delete transaction, and a retention batch rolls back its own writes |

## 📝 Migration & Backward Compatibility

Additive markers, response field, subject definition, scoped service additions, setting/doctor-check declarations and one schedule. No public event id or payload field is removed. Existing staff status and reporting calculations stay unchanged. Privacy-triggered clearing and the final user unlink are explicit outcomes, not changes to ordinary member deletion. A9 coordination follows the scoped overload bridge if already released. New editable settings use the shared optimistic-lock contract; no independent staff settings route is introduced.

The first signup prune run can remove aged unfinished rows; the upgrade note names the default, the 15-minute freshness rule, full DELETE recheck and operator setting. The employment set changes nothing until invoked. Upgrade notes list its setting/command, unresolved legal-age/identified-owner authorization, null `anonymizedAt` during retention, final user unlink, shared free-text limits and channel Phase 1's disconnect/reference clearing before integrations-only credential deletion after the records barrier. All handlers remain OSS in the owning modules; enterprise scheduling and holds are consumed only through shared services.

## 📋 Phasing

| Phase | Work | Depends on |
|---|---|---|
| 1 | Signup pruning, shared freshness constant and race-safe predicate | Operational pruner scheduler/worker foundation |
| 2 | Per-user classes and credential cleanup | Erasure Phases 2–3 and R3-1/DEC-B; communication coverage Phase 1 for channel disconnect/source copies (itself after contract Phase 6 and erasure Phase 4); scoped A9 methods if already delivered |
| 3 | Staff/planner matrix, member subject, customer copies, employment retention and `staff.retention_age_unset` | Phase 2 foundations; C4's specified custom-value seam with history/survivor identities and assumption 18 authorization; contract Phase 7 settings/read-only doctor adapter under R3-2/R3-3, doctor R3-4/R4-7 and record-retention DEC-C |

The 25-table matrix is an input to Phase 3 approval, not a classification task postponed to implementation. Each class ships export and erase together.

## 📋 Implementation Plan

### Phase 1

1. Characterize unchanged old unfinished requests and verify's 15-minute freshness behaviour. Extract the shared constant without changing verification semantics.
2. Add bounded idempotent prune worker/schedule and environment documentation. `pending-retention.test.ts` covers fresh/stale/null processing start, exact cutoff, null legacy update, no user, completed request, and reuse/claim/completion between candidate selection and DELETE. Exercise local and async queue strategies.
3. Add self-contained TC-PRIVACY-PEOPLE-004 through real signup/verify paths and worker invocation with synthetic users; no emails sent to real addresses.

### Phase 2

1. Characterize device deactivation and credential soft erasure; preserve existing public commands.
2. Implement each per-user class, dry-run history footprint, empty retained declaration and scope predicates; consume the erasure-owner row-evidence extension and add captured owner probes. `per-user-privacy.test.ts` covers verified tenant-less owner rows, same-user other-tenant rows, organization-limited export/deletion, no-tenant owner refusal and shared role configuration.
3. Implement/use scoped `listByUser`/`hardDeleteByUser` for every personal credential row and the shared integrations-owned `deleteUserCredential` for communication and A9; declare only `integrations.user_credentials` as the deleting class. Resolve the communication-owned call-placement prerequisite above before implementing its R4-1 DSR call. `credential-privacy.test.ts` covers the same user's rows in two organizations plus organization-less metadata, another user/tenant, `user_id IS NULL`, safe export, connected/disconnected/soft-deleted rows and no secret history. Require communication's records handler in pre-flight. Assert channel disconnect/reference clearing deletes no credential, records failure preserves credentials, integrations is the sole DSR deleter after the records barrier, fresh scoped listing works after pointer clearing, and a late credential failure is retryable. Assert communication and A9 delegate to the same scoped integrations method, communication declares no credential class, and A9's referenced deletion and pointer clearing commit/roll back together. The communication DSR call-order test remains blocked on its call-placement design; do not invent a second deletion path to make it pass.
4. Run TC-PRIVACY-PEOPLE-001, 005 and 006 with fake push/channel fixtures, no live provider.

### Phase 3

1. Consume the retained-declaration/evidence types and captured-row fixture contract above. Characterize that ordinary member deletion leaves its children; read the completed matrix against entity declarations to catch table drift.
2. Implement both subject paths of `staff.team_members`. `member-discovery.test.ts` covers `auth:user` export, unnamed-related dry-run refusal, explicit exclusion, no linked member and no member mutation. `member-markers.test.ts` covers C4 assumption 18 with `anonymizeOwnerWhenRetained: false`, identified legal/open-case retention under `delete` with null `anonymizedAt`, no dependent-retention coercion into anonymize, explicit-anonymize pre-flight refusal with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW` and the `--prefer delete` instruction while legal retention keeps identification, a follow-up reviewed delete that removes non-retained data while reporting the identified root as retained `legal_retention` with `retainedUntil` and null `anonymizedAt`, missing-policy-authorization pre-flight refusal with no writes, final user unlink, idempotency and held auth-user matching before unlink.
3. `employment-anchor.test.ts` covers no records, imported work predating member creation, time date versus leave start/end/decision/creation, pending leave, future approved/rejected leave, invalid date refusal, exact anniversary, leap day and midnight. One helper feeds dry run and retention.
4. Add the setting and `staff.retention_age_unset` declaration using C1 Phase 7's get-only settings factory, as permitted by R4-7. `retained-employment.test.ts` covers clock inside/outside age, unset/short window refusal, held member/user, unsupported exclusion, registered guard failure, pending decision later resolved, concurrent new work, all Final matrix copies and newer audit snapshots; doctor tests cover selected-check resolution, unset/invalid counts, failed reader/database as an error and no setting values in output.
5. Implement planner and customer-copy paths. `staff-table-coverage.test.ts` asserts all 25 plus both planner tables have the designed classification and builds representative child fixtures; `portal-copies.test.ts` asserts reporter name, comment author snapshot/id/body, task title/body and all history records, while another comment/internal task stays.
6. Run TC-PRIVACY-PEOPLE-002/003/007 with own fixtures; verify current member/report/task/portal read surfaces display placeholders, no false anonymized label or cleared values. Run generation, focused package tests, typecheck/build appropriate to implementation. Add captured no-text/session/junction/orphan probes and exact retained-evidence negative cases to the verification suite and archive the Delta if its capabilities directory is adopted.

| Planned files | Action |
|---|---|
| `packages/core/src/modules/{staff,planner,devices,push_notifications,notifications,api_keys,perspectives,dashboards,integrations}/{privacy.ts,lib/privacy/*,di.ts}` | Add classes, scope, full dry-run history, C5 metadata and exact retained declarations |
| `packages/core/src/modules/staff/{data/entities.ts,data/validators.ts,migrations/*,i18n/*}` and member response/OpenAPI serializers | Markers, locale labels and nullable anonymized response |
| `packages/core/src/modules/integrations/lib/credentials-service.ts` | Scoped safe list/hard delete, bridge if A9 released first |
| `packages/onboarding/src/modules/onboarding/{privacy.ts,lib/privacy/*,lib/processing-window.ts,api/get/onboarding/verify.ts,workers/*,setup.ts}` | Shared constant, class and bounded prune/schedule |
| Module `__tests__` and `packages/core/src/modules/staff/__integration__/TC-PRIVACY-PEOPLE-00{1,2,3,5,6,7}.spec.ts`; onboarding `__integration__/TC-PRIVACY-PEOPLE-004.spec.ts` | Named unit suites and API/read-path coverage |
| `packages/core/src/helpers/integration/{pushFake,communicationChannelsFixtures}.ts` and staff/signup fixture extensions if needed | Reuse network-free fixtures, add only missing creation helpers |
| Both environment examples/create-app template and `UPGRADE_NOTES.md` | Prune setting, first-run consequence and retention/credential migration guidance |

## 🧪 Integration Coverage

Every test creates its own tenant-scoped users, members and configuration through APIs/fixtures and restores settings and deletes all leftovers in `finally`. Backdate only the test's rows with scoped queries. After erasure use administrator reads and direct scoped queries, because the user's session is revoked. Another user in the same tenant and another tenant are controls. Never rely on demo data or a real device/provider. CLI children use the same environment as the application.

| Test | Paths and assertions |
|---|---|
| TC-PRIVACY-PEOPLE-001 | Create user, dashboard layout/user widgets, private view, API key, completed signup, notification and preference. Use `connectFakePushChannel`, `registerFakePushDevice` and delivery helpers from `pushFake.ts` under `OM_PUSH_FAKE_PROVIDERS`; drain worker and assert real delivery row. Use `seedConnectedChannel` for a referenced per-user credential via stub connect and a disconnected credential. Export every section with no token/hash/secret; erase and assert records-stage disconnect/reference clearing deletes no credential, then only integrations re-lists/deletes both after every records class succeeds. Directly assert deliveries/preferences/signup/credentials physically gone, channel disconnected and second user's rows intact |
| TC-PRIVACY-PEOPLE-002 | Resolve member name to candidate id, then erase with `--subject staff:team_member:<id>`. Own fixtures cover all linked matrix stores, shared report with a control member, address/comments/job history/preferences/tags and planner rules. With no age set, first use `--prefer anonymize`: assert pre-flight refuses with `STAFF_EMPLOYMENT_RETENTION_REQUIRES_REVIEW`, its message instructs `--prefer delete`, and all rows/history stay unchanged. Run the reviewed `--prefer delete`: name/work/leave stay, profile rows go, `anonymizedAt` is null and the identified root is reported as retained `legal_retention` with `retainedUntil: null`. Set/list `retention.staff.employmentRecordAgeYears` through R3-3 CLI, backdate anchor, preview/refuse too-short/apply set, then read member/time/report pages/APIs: user id and every Final copy are cleared, totals/control member remain, newer audit snapshots stripped. A second inside-age member tests delayed blanking |
| TC-PRIVACY-PEOPLE-003 | A portal user files a ticket and posts a comment through real portal support routes; another author posts a control comment. Erase portal user with linked person explicitly excluded. Admin task/ticket/comment reads show reference title, no request body/reporter name, placeholder comment author snapshot, null author id and empty body; control comment survives. Query history to ensure all three record kinds were stripped |
| TC-PRIVACY-PEOPLE-004 | Own unfinished signup fixtures via real signup service/API: old pending and stale processing prune, fresh processing and completed stay. Pause between selection/delete and reuse/claim a candidate through signup/verify; run worker and assert refreshed row survives, then cleanup |
| TC-PRIVACY-PEOPLE-005 | Same user's disposable credentials in two organizations; export with `--org` includes only requested-org plus organization-less fixture when schema permits. Invoke scoped methods via an authenticated test-only seam for erase counterpart; second org/user/tenant and tenant-wide credential survive; erase CLI itself remains tenant-wide |
| TC-PRIVACY-PEOPLE-006 | Own API keys/views/layouts with null tenant and an explicitly other-tenant control. Auth owner validation allows only the verified user's null-tenant rows; erasure removes them, preserves controls. A no-tenant account is refused and its rows unchanged |
| TC-PRIVACY-PEOPLE-007 | Own members with no work, pending leave, future decided leave and exact age boundary; erasure preview reports the expected end from fixture dates, while set preview counts only eligible members; member detail shows the defined name/`anonymizedAt` state only, with no new anchor/end response fields. Missing/invalid age is reported by `staff.retention_age_unset` only in the database tier, including `--only staff.retention_age_unset --database`; unavailable scoped settings adapter fails rather than reporting clean. CLI rejects fractional/zero setting; settings restored afterward |

Organization-less credential fixtures are not forced through a NOT NULL column: the real `integration_credentials.organization_id` is required today. Unit tests cover the generic optional-organization predicate; integration tests cover valid two-organization rows and report the schema distinction.

### Captured owner fixtures and row probes

Verification's “3. Erase-everywhere test”, steps 2–7, is normative for the proof. Owner test helpers capture `{ table, rowId, tenantId, organizationId, dataClassId, section }` for every created root/child/junction before erasure, together with subject/profile/account/user ids, fixture network identifiers and exact FK references. Keep that inventory in test memory. A module-local test helper accepts only that captured inventory and probes its own rows by captured primary key after the run, even if the parent has been deleted; an inner join to the removed parent is not evidence of absence. For a row without tenant columns, the pre-erasure captured owner proof limits this test-only probe. It returns presence and surviving references to captured fixture ids, never row values and never a production unscoped API. The production owner reader instead reports globally ambiguous orphans as `not_scanned`, per tenant exit's “The reader and scan mode”.

Register the staff report/comment/custom-value and portal snapshot builders with G6's suite-owned index barriers. G6 drains actual normal cleanup/indexing work before both scans, requires positive pre-erasure marker hits and verifies post-erasure absence or exact applied retained evidence in token/query-index and configured fulltext/vector stores. Captured custom-value row probes remain entities-owned and require the identity inventory above; staff never queries that table. Keep orphan-safe probes after parent deletion and assert comments/profile values expected deleted are absent independently of text search. TC-PRIVACY-VERIFY-011's parked delayed/failed jobs are excluded from these drains. C4 assumption 18 and the human authorization in assumption 2 gate member apply; G6 cannot bypass the safe-refusal fallback to complete a fixture.

Each selected surviving fixture row must match its applied class/section/table/row/column/reason evidence above; every expected-deleted fixture row must be absent. Put `noSearchableText` entries only on classes for exact no-text tables below; they waive the planted-text requirement only, never row-presence/FK assertions. Make a negative test deliberately leave an id-only fixture child orphaned after parent deletion and assert verification fails. Do not create retained evidence or manually delete that leak to pass the assertion. Control users/rows/tenants survive untouched; clean all captured rows in `finally` after assertions, using owner helpers even for orphans.

`staff.team_members.noSearchableText` lists `staff_time_entry_segments`, `staff_time_entry_tags`, `staff_time_report_projects`, `staff_time_report_entries`, `staff_time_task_tags` and `staff_timesheet_preferences`; only row/id assertions replace text checks there. Member rows, notes, addresses, comments, portal snapshots and shared reports/tasks use planted text. `staffFixtures`/module-local test helpers capture all 25 staff table categories and both planner categories touched by the fixture; only selected subject contributions get survivor evidence, and shared configuration remains a control or explicit gap. Source-notification tests use communication's owner fixtures/services and assert other-recipient notification/push content cleared while their rows remain.

For account fixtures, auth and customer_accounts test helpers own captured session/reset/role/ACL/junction probes, including session timestamps, synthetic IP/user-agent values where supported and children left orphaned by a removed account. This spec's fixtures call those helpers rather than reading auth tables. Keys, preferences, layouts/widgets, delivery/device links, signup and credential probes live in their own modules and assert captured deleted-row absence without relying on a live parent or the erased user's session. Captured null-tenant rows use the pre-erasure owner proof; another tenant's explicit rows are controls. Add a deliberately orphaned no-text session/junction negative case to the shared verification fixture and require failure before cleanup. These owner helpers are prerequisites for TC-PRIVACY-PEOPLE-001/002/003/006 and TC-PRIVACY-VERIFY-001; no new production route is introduced.

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Tenant chooses an age shorter than required | High | Employment evidence | Marked assumptions, reviewed dry run, exact anchor/end and no guessed default | Tenant's policy still needs human/legal selection |
| Age unset, pending leave or no OSS invocation | High | Former employees' storage | Exact settings CLI, database check, marked set and visible null end | Operator omission or never-decided leave can prolong retention |
| Member still named but marked anonymous | Medium | API/UI/report accuracy | R4-14 flag false; explicit-anonymize pre-flight refusal instructs `--prefer delete`; identified legal root has retained `legal_retention` evidence and `retainedUntil`, with null anonymized timestamp until final name/user clearing | External copies and tombstone-linked numeric data can remain re-identifiable |
| One member's report clearing affects another | Medium | Shared timesheets/reports | Preserve frozen numbers and other contribution rows; clear only declared text copies; multi-member fixture | Shared free text is conservatively reduced, or explicitly reported retained |
| Hold misses employment rows | High | Dispute records | DEC-C matching member/user before unlink; unsupported kind skips; guard failure refuses | OSS relies on explicit exclusions; enterprise hold freshness belongs to its owner |
| Portal name survives in snapshots/history | High | Support data | Clear reporter/comment author names and ids; return shared parents/comments under R3-1 | Unstructured quotes copied into unrelated authors' text remain a stated limit |
| Credential deleted before mailbox disconnect | High | Personal integrations | R4-1 integrations-only deletion ownership and the same scoped method for communication/A9; C4's records-before-credentials barrier | Communication's required DSR call placement against that barrier remains open design in its owner spec; credential-group failure needs retry and the account stays locked |
| Organization omitted by credential helper | High | Cross-organization confidentiality | Full scope in all three methods and two-org unit/integration tests | Legacy tenant-wide overload, if already released, remains tenant-wide for its bridge |
| Tenant-less row cleanup reaches another tenant | High | Isolation | Auth-owner tenant proof, exact user id, organization rule and explicit other-tenant exclusion | Corrupt ownership needs manual review; no-tenant owners are refused |
| Stale signup exemption or selection/delete race | Medium | Onboarding retention/availability | Shared 15-minute rule and complete DELETE predicate, bounded transactions | A fresh long-running process must refresh its existing lease to remain protected |

## Final Compliance Report — 2026-11-16

| Rule | Status | Notes |
|---|---|---|
| Module ownership and placement | Compliant design | All handlers in OSS owning modules, scalar links and DI seams; no cross-module table access |
| Other roots / related subjects | Compliant design | `auth:user` member path reports only; both kinds declared |
| Table outcomes | Designed | All 25 staff and two planner tables classified; custom values and shared-text limits explicit |
| Tenant/org isolation | Compliant design | Full credential scope; verified owner proof for null-tenant rows |
| Honest retained markers | Designed | R4-14 and C4 assumption 18: owner flag false, explicit-anonymize refusal with `--prefer delete` guidance, retained identified legal root with `retainedUntil`, missing-authorization refusal and null `anonymizedAt` until final name/user clearing |
| Credential deletion ownership | Designed; call placement open | R4-1 gives only `integrations.user_credentials` deletion ownership and the same integrations method to communication/A9; communication owns resolving its DSR call placement against C4's records barrier |
| Encryption/zod/i18n/optimistic locking | Required by plan | Existing helpers/maps, shared versioned settings audit and enterprise route guards and preserved `updatedAt` |
| Settings doctor | Aligned design | R4-7 permits C1 get-only reads; `staff.retention_age_unset` complements the aggregate and works under isolated selection with counts-only output |
| History/replay | Designed | R3-1 erasure and same-footprint later strip; no snapshot-producing blankers |
| Queue and cleanup | Designed | Bounded worker, both queue strategies and race-safe DELETE |
| Integration coverage | Designed, not executed | Network-free push/mailbox fixtures and all changed API/read paths listed |

**Verdict:** R4-14's staff preference behavior is specified; communication's R4-1 call placement and existing employment-policy/shared-contract confirmations remain prerequisites before implementation. No runtime validation is claimed.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Revised after independent review. The user's run no longer blanks the team member: that broke the erasure spec's rule about another kind's root, and made a re-run find nothing. The member is its own subject. Time and leave records are kept identified until an age the tenant sets, instead of kept with the name removed, which served neither the employer nor the person. Availability rules in `planner`, customer copies on projects, reports and tickets, and portal users' notifications are added. The signup pruner keys on the last update and skips rows being processed, because a repeat signup reuses the row; the completed row is deleted, since it records no time of consent. Credential-holding classes run last, after a read-only check, so that a refusal cannot leave a live administrator without a second factor. Rows with no tenant are left. Tests check by direct query, since the erased user's own routes are unobservable afterwards.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: **g3-11** — kept employment records of a member erased inside the age were never blanked later; the run now marks the member `privacy_retained_at`, and the `staff.retained_employment_records` retention set blanks the name, notes and leave reasons once the age has passed, refusing a window below the tenant's age and honouring holds through `excludableSubjectKinds` and the retention guard; clock-based unit tests and a step in TC-PRIVACY-PEOPLE-002 cover it. **g3-13** — a portal user's request text survived in plaintext as the title and description of the ticket's task; `staff.customer_copies` now replaces the title with the task's reference, clears the description and returns the task and ticket as history records, covered by a unit test and TC-PRIVACY-PEOPLE-003. Also, from the other fixers: every class states `erasureGroup`, `staff.team_members` sets `anonymizeOwnerWhenRetained: false` under C4 assumption 18, and the integrations credential methods are tenant-scoped, never touch a tenant-wide credential, and may ship first with the program's A9 fix.

- Council round two fixes (GPT-6.1 Sol workers): r5-05 shared staff setting and database check; r5-08 full staff/planner table matrix; r5-14 organization-scoped credential methods; r5-19 reporter/comment snapshots; r5-20 honest retained/anonymized markers and final user unlink; r5-21 exact anchor; r5-22 fake push/mailbox integration coverage; r5-37 auth-user fan-out; r5-38 verified tenant-less owner rows; r5-39 stale processing and DELETE recheck; g3-40 explicit channel dependency and single row-delete ownership; g3-52 corrected soft-erase helper description; nit: resolve name then erase member id.
- Council round two fixes, pass two (GPT-6.1 Sol workers): extend R3-1 dry-run/actual footprints to every class and other-owner row; align R3-3 setting metadata/envelopes and the privacy-owned doctor check; reconcile identified staff retention through the existing owner flag and explicit-anonymize refusal default; keep integrations.user_credentials as the only credential deleter; consume communication source notification/push clearing and report staff address-only gaps; add exact retained row/column evidence, C5 mixed-store remainders and captured account/staff/session/junction/orphan probes; retain explicit upstream row-evidence prerequisites.
- Council round two fixes, pass three (GPT-6.1 Sol workers): align integrations-only DSR credential deletion and scoped A9 transactional retries with communication and C4 ordering; consume C4 assumption 18 with the flag-false/explicit-anonymize-refusal policy and safe-refusal authorization fallback; name the paged/transactional custom-value methods; consume delivered retained-row results; restore staff.retention_age_unset with the C1 read-only-adapter prerequisite; bind staff/custom-value fixtures and orphan-safe probes to G6's index barriers.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): align the current communication contract's integrations-only DSR credential deletion and separate A9 pointer-preserving cleanup; consume C4's flag-false staff policy, exact custom-value/attachment history and survivor results, served staff seam ids and shared retained-record type; preserve source-notification owner sections, captured-row probes and the manual-review fallback; replace the obsolete C1 adapter handoff with its specified get-only factory and report the unresolved doctor-context conflict.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): apply R4-1 integrations-only credential deletion ownership and the same scoped method for communication/A9, reporting the unresolved communication call placement against C4's records barrier; restate R4-14 staff assumption 2, explicit-anonymize refusal and `--prefer delete` guidance with retained legal-root evidence, scenarios, tests, risk and compliance coverage.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): remove the stale doctor-context conflict and Phase 3 resolution gate under R4-7; align staff's database check with C1's exact get-only factory and its independent, counts-only execution alongside the shared aggregate check.
