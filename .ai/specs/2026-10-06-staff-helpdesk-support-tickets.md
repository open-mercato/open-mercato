# Helpdesk: Customer Support Tickets in Project Management (staff)

> **Status:** Draft
> **Module:** `staff` (`packages/core/src/modules/staff`)
> **Reference for the portal surface:** `warranty_claims` (portal intake, customer-pinned ownership, portal attachments) and staff's own EP-50 portal time reports (identity resolution, recipient pinning)
> **Related specs:** `implemented/2026-02-23-core-timesheets.md`, `2026-08-12-time-tracking-module-requirements.md`, `2026-08-24-time-tracking-umes-extension-points.md`, `implemented/2026-05-08-staff-decouple-from-core.md`, `2026-07-03-warranty-rma-claims-desk.md`

## 📝 TLDR

Customer Portal users can register support tickets, follow their status, talk to the team handling them and exchange files. A ticket **is a task** (`staff_time_tasks`) in a time-tracking project, so support work shows up on the same board, timesheets and reports the team already uses. Staff administrators keep **support ticket categories in a dictionary** and configure **routing**: a mandatory **fallback rule** that sends every unrouted category to one project, plus optional per-category overrides. The fallback rule and its project ("Customer support") are seeded for every organization, so the portal works out of the box. Any target project may belong to a customer or to none. Projects also gain **assigners** (members who are notified about new work and can claim unassigned tasks) and an optional **default assignee** for new tasks. Because the module now covers projects, time tracking and helpdesk, its user-facing name changes from "Employees" to **"Project management"** (display only; the module id stays `staff`).

## 📝 Decisions (gate answers)

| # | Question | Decision |
|---|---|---|
| Q1 | Split the rename into its own spec? | No. The rename is kept here as its own independently shippable phase (Phase 1). |
| Q2 | Rename depth | Display only. `metadata.title`, i18n values and the sidebar group label change. The module id `staff`, ACL ids, API paths, event ids, DI keys and table names do not. |
| Q3 | What a ticket is | A `staff_time_tasks` row with `source = 'portal'` and support columns. |
| Q4 | Routing | A mandatory **fallback rule** (every category without a usable rule → one project) plus optional **per-category rules** (category → project). A paused or broken per-category rule falls back. The fallback rule and its project are seeded. A target project may or may not have a customer. Ownership of a ticket never derives from the project's customer. |
| Q5 | Category storage | A per-organization dictionary, `staff.support_ticket_category`, owned and seeded by `staff`. |
| Q6 | Conversation | Two-way thread. Staff replies and customer messages are visible to the customer; staff internal notes never are. |
| Q7 | Portal surface | Portal pages (list, new, detail) in the sidebar, plus a "Support tickets" widget on the portal dashboard. |
| Q8 | Attachments | Included in v1, reusing `attachments` the same way `warranty_claims` does. |
| Q9 | Where assigners and the default assignee are specified | In this spec, as their own phase (Phase 3). They are general project features: they apply to every task, not only portal tickets. |
| Q10 | Who can be an assigner | An **"Assigner" flag on an existing project-member row**: an internal team member who has a user account. Assigners are never tied to a customer; customer portal users can't be members, assigners or assignees. |
| Q11 | What assigners can do | Get notified about new unassigned work, and **claim unassigned tasks** as their own assignee. They can also release their own claim. Reassigning someone else's task still requires `staff.timesheets.tasks.manage`. |
| Q12 | Scope of the default assignee | **All new tasks** in the project that are created without an explicit assignee: board, API and portal tickets alike. |

## 📝 Problem Statement

Customer Portal users have no way to ask for help except warranty claims, and those only cover RMA and returns for an order. General questions, incidents and change requests arrive by email or phone. Someone re-types them into a time-tracking project, and the customer never sees what happened next. The `staff` module already has customer-linked projects, project membership with assignment windows, tasks with per-project statuses, task comments, and a hardened portal surface (EP-50 time reports). What is missing is a portal intake path, routing from a request to the team that owns it, and a split between customer-visible and internal conversation.

## 📝 Proposed Solution

1. **Seeded defaults.** For every organization, `seedDefaults` creates:
   - a **"Customer support"** time-tracking project with no customer, its code generated through `timeProjectCodeResolver` so it cannot collide, and the standard task statuses (`seedProjectTaskStatuses`);
   - the **fallback rule** pointing at that project;
   - the four default categories.

   Existing tenants get the same through the idempotent CLI `mercato staff seed-support-defaults`. Seeding never overwrites a fallback rule that already exists.
2. **Categories** are dictionary entries in a module-owned dictionary, `staff.support_ticket_category`. It is seeded per organization in `setup.ts` `seedDefaults` with "General question", "Technical issue", "Change request" and "Billing", following `warranty_claims/lib/dictionaries.ts`. Labels are translatable through the dictionaries module.
3. **Routing** is a per-organization table of rules. Exactly one rule per organization has a null category: the **fallback rule**. It always exists and can be repointed but never deleted or paused. Rules with a category override it; a category with no rule, a paused rule, or a rule whose project is unusable goes to the fallback project. Routing resolves once, at ticket creation, inside the create command. A ticket's project is then fixed: later rule edits never move existing tickets.
4. **Intake.** Portal routes under `/api/staff/portal/support-tickets/*` create a task in the routed project's default status, with `source = 'portal'`, the filing customer's id and snapshot, the category value and label snapshot, and a customer-facing `support_reference` (e.g. `SUP-1042`).
5. **Ownership.** Portal reads and writes are pinned to `customer_id = auth.customerEntityId` on **the task**, never on the project. This lets the fallback rule send tickets from many customers into one internal "Helpdesk" project, or into a project that belongs to someone else, without leaking anything.
6. **Conversation.** Task comments gain `visibility` (`internal` | `customer`) and an author kind (`staff` | `customer`). Existing comments and the existing comment API default to `internal`, so current behavior is unchanged.
7. **Customer-facing status** is **derived** from the task's status flags rather than stored, the way Jira Service Management maps workflow statuses to customer-visible status names:
   - `received`: the task is in the project's `isDefault` status.
   - `in_progress`: any other status that is not done.
   - `resolved`: the status has `isDone`.

   A routing target must have an `isDefault` status. The last value published to the portal is kept in `portal_status_published`, so the broadcast subscriber can tell when a change is visible to the customer, whichever path caused it.
8. **What the customer wrote is kept apart from the task text.** The customer's subject and message are stored in `customer_request_snapshot` (encrypted). The task `title`/`description` start as copies, and staff may freely rewrite them for triage. The portal **only** ever reads the snapshot, never the task fields, so internal edits cannot leak.
9. **Assigners and default assignee.** These are general project features, used here so that every routed ticket reaches a person.
   - **Assigners:** a project-member row gains `is_assigner`. While their membership is active and inside the assignment window, assigners:
     - are notified when an unassigned task or a portal ticket arrives in the project;
     - can **claim** an unassigned, not-done task, which sets them as its assignee;
     - can **release** a task they claimed, which sets it back to unassigned.

     Claiming does not need `staff.timesheets.tasks.manage`. Being an assigner is the permission, on top of `staff.timesheets.tasks.view`.
   - **Default assignee:** a project gains `default_assignee_staff_member_id`. The task create command applies it when the request **omits** an assignee. An explicit `null` still means "leave unassigned", so a caller can opt out. The default is applied only while that member is an active project member inside the assignment window; otherwise the task is created unassigned and the assigners are notified.
10. **Rename.** The module title changes to "Project management". The "Time tracking" sidebar group is relabeled "Project management" and gains a "Support tickets" page. The "Employees" group (team members, teams, leave) keeps its label, because those are HR pages.

### Alternatives considered

| Alternative | Why it lost |
|---|---|
| A separate `helpdesk` module | Routing targets staff projects and tickets need the staff board, timesheets and reports. A separate module would have to reach into staff internals, which `staff/AGENTS.md` rule 1 forbids for other modules, and staff is being extracted to official-modules. |
| A dedicated `staff_support_tickets` entity linked to a task | Rejected at Q3. It duplicates status, assignee and comments, and needs sync between two records. |
| Extending `warranty_claims` | Its claim status enum and lifecycle state machine are FROZEN and RMA-specific (SLA pause, dispositions, vendor recovery). |
| Routing stored in time-tracking settings (`ModuleConfigService`) | Those settings are **tenant-global** by contract (`lib/time-tracking/settingKeys.ts`), while project ids are organization-scoped. A tenant-global project id is wrong for every other organization. |
| Stored portal status | It drifts whenever someone moves the task on the board. Deriving it from `isDefault`/`isDone` costs nothing and cannot disagree with the board. |

## 📝 Research: what helpdesk leaders do

| Product | Takeaway | Adopted? |
|---|---|---|
| Jira Service Management | A request type maps to a project/queue; workflow statuses map to customer-facing names; public comments vs internal notes | Yes: categories plus routing, derived portal status, `visibility` |
| Zammad / Freescout | A separate ticket number from the internal id; customer replies reopen a resolved ticket; attachments on every message | Yes: `support_reference`, reopen on reply, attachments. Attachments sit at ticket level in v1, not per message |
| Odoo Project + Helpdesk | Tickets as project tasks, visible in the customer portal | Yes: this is Q3 |
| All of the above | SLAs, an email-to-ticket channel, CSAT surveys, canned responses, auto-assignment | **No, out of scope for v1.** Listed under Non-goals. Each layers on top of this model without changing it |

### Non-goals (v1)

SLA timers and escalation; email-to-ticket and email notifications to customers; customer satisfaction ratings; customer-initiated close; round-robin or load-based auto-assignment (only a fixed per-project default assignee is in scope); per-customer routing overrides; merging tickets; anonymous (not logged-in) submission; **re-routing a ticket to another project** (tasks cannot change project today, because `assertNoProjectMove` returns `task_project_move_unsupported`. A misrouted ticket is handled in the project it landed in. A "move ticket" command is a follow-up); encrypting existing internal comment bodies (a separate change, because it needs a tenant-key backfill and a switch of every read site to `findWithDecryption`).

## 📝 Architecture

```
Portal user ──► /api/staff/portal/support-tickets (customer auth, ownership clause)
                    │ create
                    ▼
            staff.support_tickets.create_from_portal (command)
                    │ resolveSupportRoute(category) ─► staff_support_routing_rules
                    │ resolveTaskStatus(project)    ─► project's isDefault status
                    │ allocateTaskReference + allocateSupportReference
                    ▼
            staff_time_tasks (source='portal', customer_id, …)
                    │ events: staff.timesheets.time_task.created (existing)
                    │         staff.support_ticket.created (new, server-side only)
                    ▼
  Subscribers ─► staff notification to project owner + active project members
  time_task.updated / .status_changed / time_task_status.updated / time_task_comment.* (portalVisible)
              ─► recompute derivePortalStatus vs portal_status_published
              ─► staff.support_ticket.portal_updated (portalBroadcast, pinned recipients)
```

**What is reused**

- Task create logic: `resolveTaskStatus`, `allocateTaskReference`, `readHighestSequenceNumber`.
- The comment command, extended.
- `timeTrackingAccessResolver` for staff-side visibility (a non-manager sees tickets only on projects they are assigned to).
- `resolvePortalRecipientUserIds` (`lib/time-tracking/portalRecipients.ts`).
- The portal identity resolution of EP-50 (dynamic `import()` of `customerAuth`; 401 if it fails, 403 without `customerEntityId`).
- `DictionaryTable`/`DictionaryForm` for the category admin.
- `attachmentScopedUploadService` plus the `customer-visible` tag for files.

**New staff-internal pieces**

- `lib/support/routing.ts` (`resolveSupportRoute`)
- `lib/support/portalStatus.ts` (`derivePortalStatus`)
- `lib/support/portalTickets.ts` (the single ownership clause, written once and pinned by a test, as `portalReports.ts` does)
- `lib/support/dictionaries.ts` (ensure, seed and load categories)

**Coupling rules** (from `staff/AGENTS.md`, unchanged):

- No static import of `customer_accounts`. Portal identity uses a dynamic import, and recipients are read from `customer_users` by table name through Kysely.
- `customers` data reaches the ticket only as an FK id plus snapshot (the customer's display name at filing time). Staff already does the same for `staff_time_projects.customer_id`. The `staff_time_tasks.customer_id` → `customers:customer_entity` link is declared in `data/extensions.ts`, as EP-44 does for reports.
- The portal attachment route copies the warranty-claims flow, but it MUST NOT copy that route's static `customer_accounts` import. Identity goes through the dynamic import.
- Rate limiting uses `checkRateLimit` from `@open-mercato/shared/lib/ratelimit`, not the `customer_accounts`-internal limiter.
- `dictionaries` entities are imported directly. That is the established pattern (`staff/lib/seeds.ts`, `warranty_claims/lib/dictionaries.ts`, `sales`, `catalog`), and dictionaries is a core module, so `'dictionaries'` is added to `metadata.requires`.

**Portal broadcast rule** (EP-06 and the warranty-claims rule): `staff.support_ticket.portal_updated` is `portalBroadcast: true` and `excludeFromTriggers: true`. It always carries `recipientUserIds`, resolved from the **ticket's** `customer_id`, and is **not emitted** when that list is empty. The payload carries no free text: only `{ ticketId, supportReference, portalStatus, kind: 'status' | 'reply' }`. The existing `time_task.*` events gain no portal flag, because they are tenant-wide and would leak across customers.

## 📝 Data Model

### `staff_time_tasks`: additive columns

| Column | Type | Notes |
|---|---|---|
| `source` | text, not null, default `'internal'` | `'internal'` \| `'portal'`. Existing rows backfill to `internal` through the default. |
| `customer_id` | uuid, null | FK id into `customers:customer_entity`. Set only for portal tickets. **This column is the portal ownership key.** |
| `customer_snapshot` | jsonb, null | `{ displayName, kind }` at filing time |
| `reported_by_customer_user_id` | uuid, null | The `customer_users` id of the reporter |
| `support_reference` | text, null | `{prefix}-{n}`, unique per (tenant, org) among live rows. The prefix comes from settings key `support.referencePrefix` (default `SUP`, tenant-global, registered as an EP-42 built-in). It is separate from the task `reference` because the task reference embeds the **project code**, which can name a different customer's project. |
| `support_sequence_number` | integer, null | Backs `support_reference`. Allocated with max + 1 over all rows, including deleted ones, and retried on a unique-index conflict, the same as task references. |
| `support_category_value` | text, null | The dictionary entry `value` |
| `support_routed_via` | text, null | `category` \| `fallback`. Records which rule routed the ticket. |
| `support_category_snapshot` | jsonb, null | `{ value, label }`. Dictionary entries are **hard-deleted**, so the label must survive on the ticket. |
| `customer_request_snapshot` | jsonb, null, **encrypted** | `{ subject, body }` exactly as the customer submitted it. The portal reads subject and description only from here. It is immutable after creation. |
| `portal_status_published` | text, null | The last `received` \| `in_progress` \| `resolved` value broadcast to the portal. The subscriber compares against it, so a broadcast fires on every path that changes the derived status. |

Indexes:

- Partial index `(tenant_id, organization_id, customer_id, updated_at desc) WHERE source = 'portal' AND deleted_at IS NULL`, for the portal list.
- Partial unique index `(tenant_id, organization_id, support_reference) WHERE support_reference IS NOT NULL AND deleted_at IS NULL`.

### `staff_time_task_comments`: additive columns

| Column | Type | Notes |
|---|---|---|
| `visibility` | text, not null, default `'internal'` | `'internal'` \| `'customer'`. The default keeps every existing comment internal. |
| `author_kind` | text, not null, default `'staff'` | `'staff'` \| `'customer'` |
| `author_customer_user_id` | uuid, null | Set when `author_kind = 'customer'` (`author_user_id` is then null) |
| `author_display_snapshot` | jsonb, null | `{ displayName }` for customer authors, so staff do not need a `customer_accounts` read |

### `staff_time_project_members` and `staff_time_projects`: additive columns

| Table.column | Type | Notes |
|---|---|---|
| `staff_time_project_members.is_assigner` | boolean, not null, default `false` | Can only be `true` when the member's team member has a linked user account (`staff_team_members.user_id`). Otherwise the save returns `422 staff.timesheets.errors.assignerNeedsUser`, because a member without an account can't log in or receive notifications. |
| `staff_time_projects.default_assignee_staff_member_id` | uuid, null | Must be an **active** member of the same project when saved (`422 staff.timesheets.errors.defaultAssigneeNotMember`). It does not have to be an assigner. |

The partial index `(tenant_id, organization_id, time_project_id) WHERE is_assigner AND status = 'active' AND deleted_at IS NULL` supports recipient lookups.

"Active assigner" and "usable default assignee" both use the same predicate as `timeTrackingAccessResolver`: status `active`, not deleted, and `assigned_start_date <= today <= assigned_end_date + assignmentGraceDays`. It is written once in `lib/time-tracking/projectAssignment.ts` and used by the claim command, the create command and the notification recipients.

### New `staff_support_routing_rules`

| Column | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` | standard | `updated_at` gives optimistic locking |
| `category_value` | text, null | **null = the fallback rule.** Exactly one per organization; it can't be deleted or paused (`422 staff.support.errors.fallbackRuleRequired`) |
| `time_project_id` | uuid, not null | FK id to `staff_time_projects` in the same module, so a real FK is allowed |
| `is_active` | boolean, default true | Lets an admin pause a per-category rule without deleting it. Its tickets then go to the fallback project. Always true on the fallback rule. |

Partial unique index on `(tenant_id, organization_id, coalesce(category_value, ''))` where `deleted_at IS NULL`. This allows at most one fallback rule and one rule per category. The "exactly one" half is guaranteed by seeding plus the delete/pause refusal. It is an expression index that entity decorators cannot express, so it is hand-written in the migration and the snapshot is reconciled manually.

### Categories dictionary

The dictionary key is `staff.support_ticket_category`. It is per-organization and inherited from ancestor organizations, as the dictionaries module resolves it. Ensure and seed run in `setup.ts` `seedDefaults` and in the idempotent CLI `mercato staff seed-support-defaults` for existing tenants (which also seeds the fallback project and rule). The portal only offers entries that are on an active dictionary **and** resolve to a usable route (see the routing algorithm).

### Encryption and search

- `staff_time_tasks.customer_request_snapshot` is declared in `encryption.ts`. It is a new column with no legacy rows, it is not indexed for search, and it is read only through `findOneWithDecryption`/`findWithDecryption` in the portal routes and the drawer panel.
- Task `title`/`description` and all comment bodies **stay unencrypted**, the same as today. Customer-authored comments are plaintext as well. This is an accepted v1 risk, recorded under Risks. Encrypting comment bodies is a separate change (see Non-goals), because existing comments are indexed (`commentCrudIndexer`) and read through plain `em.find` at several sites.
- `search.ts`: `staff:staff_time_task` gains `support_reference` as a searchable field. Search on tasks already requires `staff.timesheets.projects.manage`, so non-managers cannot find tickets through global search. Filtering by `source` is done in the tasks API, not in search.

### Routing algorithm (`resolveSupportRoute`)

```
usable(project) = live, same tenant+org, status in ('active','on_hold'), has an isDefault task status

rule = active rule for categoryValue
if rule && usable(rule.project)        → { project: rule.project, via: 'category' }
if usable(fallbackRule.project)        → { project: fallbackRule.project, via: 'fallback' }
return null
```

- **A category with no rule, a paused rule, or a rule whose project became unusable** goes to the fallback project. The ticket stores `via` in `support_routed_via` (`category` \| `fallback`), so staff and admins can see a misconfigured override at work. The routing page warns on every override that is currently falling back.
- **The fallback project itself is unusable** (an admin completed or deleted the seeded project, or removed its default status). This is the only state in which no ticket can be created: `options.categories` is empty and the routing page shows a blocking error asking the admin to repoint the fallback rule. A per-category rule that is still usable keeps working in this state.
- **Completed project:** treated as invalid.
- **`on_hold` project:** stays valid, so a team on hold still receives tickets and sees them when it resumes.

## 📝 API Contracts

All bodies are validated with zod in `data/validators.ts`. Error messages use i18n keys under `staff.support.errors.*`.

### Portal

These routes declare `requireAuth: false` and resolve customer identity the EP-50 way. Writes go through the portal mutation guard, using the customer-user id and an empty feature list (warranty-claims rule 10).

| Method & path | Feature | Request | Response / notes |
|---|---|---|---|
| `GET /api/staff/portal/support-tickets/options` | `portal.support_tickets.view` | – | `{ categories: [{ value, label }], canCreate: boolean }`. Only routable categories are returned. `canCreate` is true when the caller holds `portal.support_tickets.manage` and at least one category is routable. |
| `GET /api/staff/portal/support-tickets` | `portal.support_tickets.view` | `page`, `pageSize ≤ 50`, `status?: received\|in_progress\|resolved` | `{ items: [{ id, supportReference, subject, category: {value,label}, portalStatus, createdAt, updatedAt, lastActivityAt }], total }` |
| `POST /api/staff/portal/support-tickets` | `portal.support_tickets.manage` | `{ categoryValue: string, subject: string(3..200), description: string(1..10000) }` | `201 { id, supportReference }`. Returns `422 staff.support.errors.categoryUnavailable` when the category does not route. |
| `GET /api/staff/portal/support-tickets/{id}` | `portal.support_tickets.view` | – | The ticket (subject and description **from `customer_request_snapshot`**), plus `messages: [{ id, authorKind, authorName, body, createdAt }]` (**customer-visible comments only**), plus `attachments`. Returns `404` for any ticket the caller does not own. |
| `POST /api/staff/portal/support-tickets/{id}/messages` | `portal.support_tickets.manage` | `{ body: string(1..10000) }` | `201`. On a `resolved` ticket this also moves the task to the project's `isDefault` status (reopen), as a system actor. |
| `GET\|POST\|DELETE /api/staff/portal/support-tickets/{id}/attachments` | view (GET) / manage (POST, DELETE) | multipart / `?attachmentId=` | Follows `warranty_claims/api/portal/attachments/route.ts`: `entityId = 'staff:staff_time_task'`, `recordId = task id`, tag `customer-visible`, 25 MB limit. Customer uploads also get the tag `customer-upload:<customerUserId>`, passed through `attachmentScopedUploadService` tags. `DELETE` requires that tag to match the caller. (The attachment entity has no uploader column, and warranty claims let any owner delete; staff narrows that rule.) |

**What the portal never returns:** the project id, name or code; the task `reference`; the task `title`/`description` (staff-editable, possibly with internal notes); the assignee; internal comments; time entries; any money field. The ownership clause is written once in `lib/support/portalTickets.ts`:

```
tenant_id = auth.tenantId AND organization_id = auth.orgId
AND customer_id = auth.customerEntityId AND source = 'portal' AND deleted_at IS NULL
```

Detail and sub-resources **load with** this clause, never "load, then check", following EP-50.

`portal.support_tickets.view` is granted to `buyer` and `viewer`, and `portal.support_tickets.manage` to `buyer`, through `setup.defaultCustomerRoleFeatures`. Existing tenants run `mercato customer_accounts sync-customer-role-acls`. These features are **not** added to `acl.ts`, which is the staff feature catalog (the same convention as `portal.time_reports.view`).

### Backoffice (additive only)

| Surface | Change |
|---|---|
| `GET /api/staff/timesheets/tasks` | New filters `source`, `customerId`, `supportCategory`, `portalStatus`. New response fields `source`, `customerId`, `customerSnapshot`, `supportReference`, `supportCategory`, `portalStatus`, `reportedByCustomerUserId`. |
| `POST/PUT /api/staff/timesheets/tasks` | Support columns are **read-only** through this route. Backoffice can't create `source = 'portal'` tasks or change `customer_id`. |
| `/api/staff/timesheets/tasks/{id}/comments` | `POST` accepts an optional `visibility` (default `internal`). Responses add `visibility`, `authorKind`, `authorName`. The comment command changes as follows. **(1)** `author_kind = 'customer'` comments are refused for edit and delete **before** the `manage_all` exemption in `requireEditableComment`, which today lets a manager edit any comment. **(2)** `visibility = 'customer'` is rejected with 422 unless `task.source = 'portal'`. **(3)** Changing `customer` → `internal` is allowed, to retract a reply. |
| `GET/POST/PUT/DELETE /api/staff/timesheets/support-routing-rules` | `makeCrudRoute`. Feature `staff.timesheets.settings.manage`. Optimistic locking default ON. Validation: the project belongs to the same org and has at least one status; `categoryValue` exists in the dictionary when not null. |
| `POST /api/staff/timesheets/tasks` | When `assigneeStaffMemberId` is **omitted** and the project has a usable default assignee, the task gets that assignee. Explicit `null` keeps the task unassigned. Projects without a default (every existing project) behave exactly as today. |
| `POST /api/staff/timesheets/tasks/{id}/claim` | **New.** Requires `staff.timesheets.tasks.view`, a staff profile, and active assigner membership of the task's project. The task must be unassigned and not in an `isDone` status. It is an atomic conditional update (`… SET assignee = :me WHERE id = :id AND assignee_staff_member_id IS NULL`); losing a race returns `409 staff.timesheets.errors.taskAlreadyClaimed`. Accepts the optimistic-lock header. |
| `POST /api/staff/timesheets/tasks/{id}/release` | **New.** Only the current assignee may release (`403` otherwise); the task becomes unassigned. Managers keep using `PUT /tasks`. |
| Project members CRUD (existing route) | Accepts and returns `isAssigner`. |
| Projects CRUD (existing route) | Accepts and returns `defaultAssigneeStaffMemberId`. Removing a member, or making them inactive, while they are the default assignee is allowed; the project then shows a warning, and new tasks fall to the assigners. |
| `GET/PUT /api/staff/timesheets/settings` | Gains the built-in key `support.referencePrefix` (`^[A-Z][A-Z0-9]{1,9}$`, default `SUP`) |

### Commands

| Command id | Purpose | Undo |
|---|---|---|
| `staff.support_tickets.create_from_portal` | Route, allocate both references, create the task in the default status, and save the first message as the description | Soft-deletes the task. Not offered to customers; staff undo is available through the task delete command. |
| `staff.support_tickets.portal_message` | Append a customer-visible comment with `author_kind = 'customer'`, and reopen if resolved | Soft-deletes the comment and restores the prior status |
| `staff.timesheets.task_comments.create` (extended) | Accepts `visibility` | unchanged |
| `staff.timesheets.tasks.create` (extended) | Applies the project's default assignee when the assignee is omitted | unchanged (the task is deleted) |
| `staff.timesheets.tasks.claim` | An assigner sets themselves as assignee on an unassigned task | Restores the unassigned state, provided the task is still assigned to the claimer |
| `staff.timesheets.tasks.release` | The assignee unassigns themselves | Restores the previous assignee, provided the task is still unassigned |

### Events (new, additive)

| Id | Flags | Payload |
|---|---|---|
| `staff.support_ticket.created` | persistent (**no** clientBroadcast) | `{ taskId, projectId, customerId, supportReference, categoryValue }` |
| `staff.support_ticket.customer_replied` | persistent (**no** clientBroadcast) | `{ taskId, projectId, commentId, supportReference }` |
| `staff.support_ticket.portal_updated` | portalBroadcast, excludeFromTriggers | `{ ticketId, supportReference, portalStatus, kind, recipientUserIds }` |
| `staff.timesheets.time_task.assignee_changed` | persistent, clientBroadcast | `{ taskId, projectId, previousAssigneeStaffMemberId, assigneeStaffMemberId, reason: 'default' \| 'claim' \| 'release' \| 'manual' }`. It carries only ids and no customer data, the same shape as the existing `status_changed`. It is emitted by create (when a default is applied), claim, release, and any `PUT` that changes the assignee. |

The two staff-facing events are deliberately **not** client-broadcast. `clientBroadcast` reaches every signed-in user of the organization with no feature or project-membership check, and staff already keeps `customerId` out of browser broadcasts (`events.ts`, `time_report.closed`). Backoffice screens refresh through the existing `time_task.*` events; people are told through notifications.

The existing `time_task_comment.created|updated|deleted` events gain an additive payload field, `portalVisible: boolean`. It is true when the comment's visibility **before or after** the change is `customer`, so retracting or deleting a reply also refreshes the portal.

`subscribers/support-ticket-portal-broadcast.ts` emits `portal_updated` (always with pinned recipients, and never when the recipient list is empty) on:

- `time_task.status_changed` **and** `time_task.updated`, for `source = 'portal'` tasks. A `PUT /tasks` that changes `taskStatusId` emits only `updated`. The subscriber recomputes `derivePortalStatus` and emits with `kind: 'status'` only when the result differs from `portal_status_published`, which it then updates.
- `time_task_status.updated` (an `isDone`/`isDefault` flag edit re-labels a whole column): fans out over the live portal tasks in that status, applying the same compare-and-publish rule. The fan-out is bounded by a batch size and runs in the persistent subscriber.
- `time_task_comment.*` with `portalVisible = true` (`kind: 'reply'`).

### Notifications (staff)

| Type | Recipients |
|---|---|
All recipient lists go through one **escalation chain**, `resolveProjectWorkRecipients`. Each step is used only when the previous one is empty, and the user who caused the event is always excluded:

1. the explicit audience of the type (see below);
2. the project's active assigners;
3. the project owner;
4. users holding `staff.timesheets.projects.manage` in the organization, resolved through the RBAC service (wildcard-aware).

This means a ticket in the seeded fallback project is never unseen, even before anyone is assigned.

| Type | Audience (step 1) |
|---|---|
| `staff.support_ticket.created` | The assignee, if one was set (by default or explicitly), **plus** the active assigners. Ticket intake is always visible to the dispatching team. |
| `staff.support_ticket.customer_replied` | The assignee; if the ticket is unassigned, the chain starts at step 2. |
| `staff.timesheets.time_task.unassigned_created` (**new, general**) | Starts at step 2: a task was created in the project with no assignee. Not sent for portal tickets, which use `support_ticket.created`. |
| `staff.timesheets.time_task.assigned` (**new, general**) | The new assignee, when someone else assigned them or the default was applied. A claim is self-assignment, so it is not sent for claims. |

All notifications are rendered with i18n keys and link to the board drawer, which has a **Claim** action.

## 📝 UI/UX

### Portal (customer)

- **`/{orgSlug}/portal/support`** (list):
  - Page meta: `requireCustomerAuth`, `requireCustomerFeatures: ['portal.support_tickets.view']`, `nav { labelKey: 'staff.portal.support.nav', group: 'main', order: 45, icon: 'life-buoy' }`.
  - Shows a status filter, then reference, subject, category, status badge (DS status tokens: `received` → info, `in_progress` → warning, `resolved` → success) and last activity.
  - Empty state offers a "New ticket" call to action when `canCreate`. When no category is routable, it says that support requests are not available yet, rather than offering a form that would fail.
- **`/{orgSlug}/portal/support/new`**:
  - Fields: category select, subject, description, and file drop zone.
  - On submit, the client creates the ticket and then uploads the files one by one, then goes to the detail page. A failed upload shows there with a retry button; the ticket is never lost to a failed file.
  - `Cmd/Ctrl+Enter` submits.
- **`/{orgSlug}/portal/support/{id}`**:
  - Header: reference, status and category.
  - The thread in chronological order: the description first, then messages, with author names from snapshots and staff shown as "Support team" plus their display name.
  - A reply composer (with the hint "Replying reopens this ticket" when resolved) and an attachments list.
  - Subscribes with `usePortalAppEvent('staff.support_ticket.portal_updated')` and refetches when `ticketId` matches.
  - Injection spots `portal:staff.support_ticket:before|after`.
- **Dashboard widget** `staff.injection.portal-support-tickets` on `portal:dashboard:sections`:
  - `metadata.features: ['portal.support_tickets.view']`.
  - Shows up to 5 tickets that are not resolved, a count of all open tickets, a "New ticket" button (when `canCreate`) and "View all".
  - The user can hide it with the existing hidden-widgets mechanism.
  - This is the first core contributor to this spot; the example module's `portal-stats` widget is the template.

### Backoffice (staff)

- **Sidebar.** The "Time tracking" group label becomes **"Project management"** and gains a **Support tickets** page (`/backend/staff/time-tracking/support`, feature `staff.timesheets.tasks.view`).
  - The page is a `DataTable` over the tasks API with `source=portal`.
  - Columns: support reference, subject, customer, category, portal status, project, assignee, last activity.
  - Filters: portal status, category, project, customer, assignee.
  - Visible projects are limited by `timeTrackingAccessResolver`.
  - A row opens the existing `TaskDrawer` (`?task=`).
- **`TaskDrawer`** for a `source = 'portal'` task:
  - A **Customer request** panel shows the customer, the reporter, the category, the support reference and the portal status the customer currently sees.
  - The comment composer has **two explicit buttons**, "Reply to customer" and "Add internal note". There is no hidden default, so an internal note cannot be sent to a customer by accident.
  - Customer-visible comments carry a "Visible to customer" marker, and customer-authored ones are styled as incoming.
  - A **new attachments section** (the drawer has none today), shown for portal tasks only. It lists files, marks customer-visible ones, and staff uploads include a "Share with customer" checkbox, unchecked by default.
  - Editing the task title or description shows a hint: "The customer sees their original request, not this text."
- **Project form and members tab:**
  - an "Assigner" toggle per member, disabled with a tooltip for members without a user account;
  - a "Default assignee" select limited to active members;
  - a warning when the default assignee's membership is inactive or outside its assignment window.
- **Board and drawer:**
  - an unassigned task shows a **Claim** button to active assigners, and the assignee sees **Release**;
  - the board's "Unassigned" filter chip gets a count, so assigners can find work to claim.
- **Board cards** for portal tasks show a small "Customer request" badge and the support reference.
- **Settings → Support** (`/backend/staff/time-tracking/settings/support`, feature `staff.timesheets.settings.manage`):
  1. **Categories:** `DictionaryTable` for `staff.support_ticket_category`.
  2. **Routing:**
     - A required **"Fallback project"** select, pre-filled with the seeded "Customer support" project. It can be repointed but not cleared.
     - A table of category → project overrides, with add, edit, delete and pause.
     - Each override row shows a warning badge, "Falling back to <fallback project>", when it is paused, its project is unusable (completed, deleted, or has no default status), or its category no longer exists.
     - A preview column shows the project each category actually routes to right now.
     - A blocking error banner appears when the fallback project is unusable.
     - A warning appears when the fallback project has no active assigner, no usable default assignee and no owner. In that state, new-ticket notifications go to holders of `staff.timesheets.projects.manage` (see Notifications).
  3. **Reference prefix**.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| A fresh organization with no configuration | Seeded: the "Customer support" project, the fallback rule and four categories. The portal accepts tickets immediately. |
| An existing tenant upgrades | Until `mercato staff seed-support-defaults` runs, there is no fallback rule and `options.categories` is empty. The portal shows "Support requests are not available yet", and the routing page offers a "Create fallback project" action that runs the same seeding for that organization. |
| An override's target project is completed or deleted after tickets were filed | Existing tickets stay where they are, and the portal still shows them. New tickets in that category go to the fallback project, and the routing page warns on the override. |
| The fallback project is completed, deleted, or loses its default status | No new tickets are possible except through still-usable overrides. The routing page shows a blocking error; the portal shows "not available" for the affected categories. |
| An admin tries to delete or pause the fallback rule | `422 staff.support.errors.fallbackRuleRequired` |
| The dictionary entry is deleted (hard delete) | Tickets keep `support_category_snapshot.label`. The orphaned override is flagged on the routing page; the portal stops offering the category because it is no longer in the dictionary. |
| A rule is saved targeting a project with no `isDefault` task status (legacy projects, which status seeding did not backfill) | Rejected with `staff.support.errors.projectHasNoDefaultStatus`. |
| An admin deletes the seeded "Customer support" project and then re-runs seeding | Seeding is idempotent per rule. A fallback rule that exists, even one pointing at a deleted project, is never overwritten; the admin repoints it. A project is only created when no fallback rule exists. |
| Concurrent creates race for `support_sequence_number` | The unique index rejects one, and the command retries up to 3 times (the same strategy as `task_reference_conflict`). After that it returns `409`, and the portal asks the user to resubmit. |
| A staff member changes the ticket's status (board drag, status endpoint or `PUT /tasks`) | The portal status is re-derived, and `portal_updated` fires only if it changed. |
| An admin edits a status column's `isDone`/`isDefault` flag | Every portal ticket in that column is re-derived through the `time_task_status.updated` fan-out. |
| A ticket was routed to the wrong project | Tasks cannot change project (`task_project_move_unsupported`). Staff handle it where it landed. Re-routing is a listed follow-up. |
| A staff member retracts a reply (flips it to internal) or deletes it | `portalVisible` is true on that event, so the portal refreshes and the message disappears. |
| Two assigners claim the same task at the same time | The conditional update lets exactly one win; the other gets `409 taskAlreadyClaimed`, and the board refreshes from `assignee_changed`. |
| The default assignee left the project, their assignment window expired, or they were deleted | New tasks are created unassigned, and the escalation chain notifies the assigners. The project form shows a warning. Nothing fails. |
| A member's team member loses their user account while flagged as an assigner | They drop out of the recipient lists (no user to notify) and can't claim (no session). The members tab flags the row. |
| An assigner tries to claim a task in a done status, or one that is already assigned | `422 staff.timesheets.errors.taskNotClaimable` or `409 taskAlreadyClaimed`. Taking over someone else's task is out of scope (Q11). |
| An API client that creates tasks relies on them staying unassigned | Unchanged unless an admin sets a default assignee on that project. Sending an explicit `assigneeStaffMemberId: null` opts out. Called out in the release notes. |
| A staff member deletes the task | The portal answers `404` for it and it drops out of the list. |
| A customer user is deactivated, or the customer has no active portal users | The ticket stays visible to the company's other users. `portal_updated` is not emitted for an empty recipient list. |
| The portal session has no `customerEntityId` | `403 staff.errors.customerAccountNotLinked`, the same as EP-50 |
| The `customer_accounts` dynamic import fails (module disabled) | `401`; the pages are unreachable because their guards fail |
| Spam or flooding from one account | Portal `POST` routes call `checkRateLimit` (`@open-mercato/shared/lib/ratelimit`), keyed by customer user. The defaults are 10 tickets and 60 messages per hour; exceeding them returns `429` with the shared rate-limit error key. |
| A staff member without project membership searches globally | Task search already requires `staff.timesheets.projects.manage`, so they find nothing. |
| An attachment upload fails after the ticket was created | The ticket exists; the detail page lists the failed file with a retry. |

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| A cross-customer leak through a shared project | High | Ownership comes from the task's `customer_id` and is written in one clause, which tests pin. The portal never selects project fields, the task reference or internal comments. Broadcasts always pin recipients. |
| An internal note shown to a customer | High | `visibility` defaults to `internal` on every existing path; the composer uses explicit buttons; the portal query filters `visibility = 'customer'` in SQL. The portal never reads the staff-editable task title or description, only the immutable `customer_request_snapshot`. |
| Personal data in plaintext customer comments and in the task title/description copy | Medium | An accepted v1 tradeoff, the same as all task comments today. The original request is encrypted; the form copy discourages secrets; comment encryption is a listed follow-up. |
| A broadcast disclosing customers to staff outside the project | Medium | The staff-facing support events are not client-broadcast. Notifications go only to the project owner, members and the assignee. |
| Rename side effects | Low | Display-only, so no id changes. Changing `metadata.title` also relabels the HR features (team members, leave) wherever features are grouped by module title, such as role editors. That is accepted as intended, because the module is renamed. The hard-coded `'Time tracking'` breadcrumb fallbacks in `backend/staff/time-tracking/*/page.meta.ts` are updated with the i18n values. |
| Extraction of `staff` to official-modules | Low | All new code lives in `staff` with the same coupling rules, so it moves with the module. |
| A migration on the large `staff_time_tasks` table | Low | Additive columns are nullable or have constant defaults, which is a metadata-only change on PostgreSQL 11+. The two indexes are partial. |

**Backward compatibility** (checked against `BACKWARD_COMPATIBILITY.md`):

- **Additive:** DB columns and table; API fields, filters and routes; event ids; notification types; portal feature ids; injection spot ids; the `requires` entry; the `portalVisible` payload field on the existing comment events.
- **Behavior change on an existing surface:** task create applies a default assignee when the assignee is omitted. This only happens on projects where an admin set a default, which no existing project has. Explicit `null` opts out.
- **Behavior change on an existing surface:** comment `PUT`/`DELETE` now refuses customer-authored comments even for `manage_all` holders. No such comments exist before this feature, so no existing caller is affected.
- **Unchanged:** existing comment and task behavior for internal tasks (the defaults preserve it), all ACL ids, the module id.
- **Rollback:** the feature is gated by the portal features and by routing rules. With no rules, no tickets can be created. Columns can stay in place; a down migration drops them.

## 📋 Phasing

Staff-side handling ships **before** portal intake, so customers never get a channel where nobody can answer them.

| Phase | Ships | Works without later phases? |
|---|---|---|
| 1. Display rename | "Project management" title and sidebar group | Yes |
| 2. Data model, categories and routing admin | Migration; seeding of categories, the "Customer support" project and the fallback rule; routing rules CRUD and settings page | Yes. Admins can configure; nothing is customer-facing yet. |
| 3. Project assigners and default assignee | `is_assigner`, the default assignee, claim and release, `assignee_changed`, the general task notifications and the recipient escalation chain | Yes. Useful on its own for every project, including those without helpdesk tickets. |
| 4. Staff-side ticket handling | Comment visibility and guards, the drawer "Customer request" panel, the Support tickets page, staff notifications, the portal-status subscriber | Yes. It is inert until portal tickets exist, and tested with tickets created through the command in fixtures. |
| 5. Portal intake and conversation | Portal API, the list/new/detail pages with two-way messages, the dashboard widget, the portal broadcast and `defaultCustomerRoleFeatures` | Yes. This is the first customer-visible release. |
| 6. Attachments | Portal and staff customer-visible files, including the new drawer section | Yes |

## 📋 Implementation Plan

### Phase 1: Display rename

1. **1.1** Change `index.ts` `metadata.title` to "Project management" and update the `description`. Change the i18n values of `staff.time_tracking.nav.group` (and the module title key, if present) in every locale. Update the hard-coded `'Time tracking'` breadcrumb fallbacks in `backend/staff/time-tracking/*/page.meta.ts`, and the `apps/docs` pages that name the module. *Test:* a unit test asserting the metadata title; `yarn i18n:check-sync`.

### Phase 2: Data model, categories and routing

1. **2.1** Entities and migration:
   - the `staff_time_tasks` and `staff_time_task_comments` columns;
   - the `staff_support_routing_rules` table;
   - the partial indexes, plus a hand-written expression unique index with the snapshot reconciled;
   - `customer_request_snapshot` in `encryption.ts`;
   - the `customer_id` link in `data/extensions.ts`.

   *Test:* an entity/migration unit test; an encryption-map test for the new column.
2. **2.2** `lib/support/seedDefaults.ts` and `lib/support/dictionaries.ts`, called from `setup.ts` `seedDefaults` and from the CLI `mercato staff seed-support-defaults`. They ensure:
   - the `staff.support_ticket_category` dictionary and its four entries;
   - the "Customer support" project, with a resolver-generated code and the standard statuses;
   - the fallback rule.

   Add `'dictionaries'` to `requires`. *Test:* a seeding unit test:
   - running it twice creates nothing new;
   - an existing fallback rule, even one pointing at a deleted project, is never overwritten;
   - a project-code collision gets a different code;
   - a new organization ends up with a usable route.
3. **2.3** `lib/support/routing.ts` `resolveSupportRoute`, and `lib/support/portalStatus.ts` `derivePortalStatus`. *Test:* unit tables covering:
   - the fallback rule only;
   - a usable per-category override;
   - paused, unusable and orphaned overrides all fall back, with `via: 'fallback'` recorded;
   - an unusable fallback with a usable override (the override still works);
   - an unusable fallback with no override (returns null);
   - `on_hold` vs `completed` projects;
   - a project with no `isDefault` status;
   - an orphaned category.
4. **2.4** The `support-routing-rules` CRUD route, validators and OpenAPI, plus the `support.referencePrefix` built-in setting key. *Test:* integration TC-STAFF-SUP-001:
   - CRUD works;
   - a second fallback rule is rejected;
   - deleting or pausing the fallback rule returns 422;
   - a cross-org project is rejected;
   - a project with no default status is rejected;
   - a stale `updatedAt` returns 409.
5. **2.5** The Settings → Support page: categories through `DictionaryTable`, the routing editor with warnings and a preview, and the prefix field. *Test:* Playwright TC-STAFF-SUP-002.

### Phase 3: Project assigners and default assignee

1. **3.1** Migration for `is_assigner`, `default_assignee_staff_member_id` and the partial index. Add `lib/time-tracking/projectAssignment.ts`, with the active-membership predicate shared with the access resolver. Add validators and API fields on the existing members and projects routes (`assignerNeedsUser`, `defaultAssigneeNotMember`). *Test:* unit tests for the predicate (status, assignment window, grace period, deleted); integration TC-STAFF-ASG-001 (toggle, a member without a user account rejected, a non-member default rejected).
2. **3.2** Default assignee in `staff.timesheets.tasks.create`: omitted means default, explicit `null` means unassigned, an unusable default means unassigned. Emit `assignee_changed` (`reason: 'default'`). *Test:* TC-STAFF-ASG-002, which covers every branch plus a project with no default (behavior unchanged).
3. **3.3** The claim and release commands and routes (atomic conditional update, undo, `assignee_changed`). Make `PUT` emit `assignee_changed` with `reason: 'manual'`. *Test:* TC-STAFF-ASG-003:
   - an assigner claims;
   - a non-assigner gets 403;
   - an already-assigned task returns 409;
   - a done task returns 422;
   - parallel claims let exactly one win;
   - release by the assignee works, and by anyone else returns 403.
4. **3.4** `resolveProjectWorkRecipients` (the escalation chain), plus the `time_task.unassigned_created` and `time_task.assigned` notification types, renderers and subscribers. *Test:* unit tests for each chain step, actor exclusion, and the wildcard `projects.manage` fallback.
5. **3.5** UI: the Assigner toggle and Default assignee select on the project, the Claim and Release buttons on the board and drawer, and the Unassigned count. *Test:* Playwright TC-STAFF-ASG-004 (configure the project, create a task, an assigner gets notified and claims it, then releases it).

### Phase 4: Staff-side ticket handling

1. **4.1** The `staff.support_tickets.create_from_portal` command (routing, both references with retry, default status, the project's default assignee through the shared create path, `customer_request_snapshot`, the `support_ticket.created` event). It has no route yet; fixtures call it. *Test:* a command unit test (reference retry, an unroutable category, the snapshot is immutable when the task is updated).
2. **4.2** Comment command and API changes:
   - `visibility`, `author_kind` and `portalVisible` on the comment events;
   - customer-authored comments refused before the `manage_all` exemption;
   - `visibility='customer'` rejected on non-portal tasks.

   *Test:* TC-STAFF-SUP-003:
   - a client that posts without `visibility` gets `internal`;
   - a manager can't edit a customer comment;
   - a customer-visible comment on an internal task returns 422.
3. **4.3** `subscribers/support-ticket-portal-broadcast.ts`, built on `time_task.updated`, `.status_changed`, `time_task_status.updated` (fan-out) and comment events with `portalVisible`, using compare-and-publish against `portal_status_published`. Also the staff notification types and renderers. *Test:* subscriber unit tests:
   - a `PUT` status change publishes;
   - a column flag edit fans out;
   - no change means no emit;
   - recipients are pinned and an empty list means no emit;
   - the payload contains no free text;
   - a retracted or deleted reply publishes.
4. **4.4** Backoffice UI:
   - the Support tickets page;
   - the drawer "Customer request" panel showing the snapshot, with the two-button composer and the "customer sees original" hint;
   - the board badge;
   - the tasks API filters and fields.

   *Test:* Playwright TC-STAFF-SUP-004 against a fixture ticket.

### Phase 5: Portal intake and conversation

1. **5.1** `lib/support/portalTickets.ts`: the ownership clause and portal identity helper (the EP-50 shape, dynamic import), plus the `checkRateLimit` wiring. *Test:* a unit test pinning the clause, including that the project's `customer_id` is never consulted.
2. **5.2** The portal `options`, list, create, detail and messages routes, and the `staff.support_tickets.portal_message` command (reopen on reply), plus `defaultCustomerRoleFeatures`. *Test:* integration TC-STAFF-SUP-005:
   - customers A and B file tickets into one shared project, and each sees only their own;
   - a foreign id returns 404;
   - a viewer can't create;
   - an unroutable category returns 422;
   - responses contain no project, task reference, task title/description, internal comment or money keys;
   - a staff edit of the task description never shows on the portal;
   - a reply on a resolved ticket reopens it;
   - going over the limit returns 429.
3. **5.3** The portal pages (list, new, detail with thread and `usePortalAppEvent` refresh) with i18n, DS tokens and keyboard shortcuts. *Test:* Playwright TC-STAFF-SUP-006:
   - a customer files a ticket;
   - staff reply and add an internal note;
   - the customer sees only the reply;
   - the customer replies back.
4. **5.4** The portal dashboard widget on `portal:dashboard:sections`. *Test:* Playwright TC-STAFF-SUP-007 (the widget renders and is gated by the feature). Then document the new public surfaces (routes, events, spots, the ownership clause, the `portalVisible` field) in a staff `AGENTS.md` section, "Customer support tickets".

### Phase 6: Attachments

1. **6.1** The portal attachments route, modeled on warranty claims but without its static `customer_accounts` import: the `customer-visible` tag, the `customer-upload:<customerUserId>` tag, delete only own uploads, and a streamed download. *Test:* TC-STAFF-SUP-008:
   - upload, list and download work;
   - a foreign ticket returns 404;
   - an untagged staff file is invisible;
   - deleting another user's upload returns 403.
2. **6.2** The new drawer attachments section with "Share with customer", and the portal new/detail upload UI with retry. *Test:* Playwright TC-STAFF-SUP-009.

Each phase ends with the validation gate from `.ai/agentic.config.json`.

## ✅ Final Compliance Report

| Rule (root / staff `AGENTS.md`) | Status |
|---|---|
| No direct ORM relations between modules | ✅ `customers` is coupled by FK id plus snapshot, plus the `data/extensions.ts` link. `dictionaries` uses the established direct-entity pattern and is listed in `requires`. |
| No static `customer_accounts` dependency from `staff` | ✅ Dynamic import for identity; Kysely by table name for recipients |
| Tenant and organization scoping on every query | ✅ The ownership clause and routing resolver carry both; a single clause is pinned by tests |
| Portal broadcast pins recipients and skips an empty list | ✅ `portal_updated` |
| No browser broadcast of customer identity to the whole organization | ✅ Support events are server-side only |
| Atomic claim (no lost update between concurrent assigners) | ✅ Conditional update plus 409; covered by TC-STAFF-ASG-003 |
| Optimistic locking on new user-editable entities | ✅ Routing rules (`updated_at`, CRUD default ON); tasks and comments keep their existing locks |
| Encryption for sensitive free text | ⚠️ Partial. The original request is encrypted; comment and task text stay plaintext as an accepted, documented v1 risk with a listed follow-up |
| i18n, no hard-coded strings, DS status tokens | ✅ Planned per step; checked by `yarn i18n:check-sync` |
| `BACKWARD_COMPATIBILITY.md` | ✅ Additive only. One narrowed behavior (customer comments are immutable) affects no existing data |
| Integration tests for every new API path and key UI path | ✅ TC-STAFF-SUP-001…009 and TC-STAFF-ASG-001…004 |

## Changelog

- **2026-10-06** — Initial draft. Gate answers recorded (Q1–Q8). Revised after an architectural review:
  - the support events are no longer client-broadcast;
  - the customer's request is snapshotted, so the portal never reads staff-editable task text;
  - portal-status publishing covers `PUT` and status-column edits;
  - retracted replies refresh the portal;
  - customer comments are protected from `manage_all` edits;
  - attachment uploader tagging is specified;
  - the drawer attachments section is new;
  - comment-body encryption is deferred;
  - staff-side handling now ships before portal intake;
  - the stale "move ticket" edge case was removed.
- **2026-10-06** — Routing reworked per maintainer feedback:
  - a mandatory **fallback rule** that can't be deleted or paused catches every category without a usable override; paused, broken and orphaned overrides now fall back instead of making the category unavailable;
  - every organization is seeded with a "Customer support" project and a fallback rule pointing to it, with `mercato staff seed-support-defaults` for existing tenants;
  - `support_routed_via` records which rule routed a ticket;
  - new-ticket notifications fall back to holders of `staff.timesheets.projects.manage` when the project has no owner or members.
- **2026-10-06** — Added project **assigners** and a **default assignee** as a new Phase 3 (Q9–Q12):
  - `is_assigner` on project members, which requires a linked user account;
  - `default_assignee_staff_member_id` on projects, applied to every new task when the assignee is omitted (explicit `null` opts out);
  - atomic **claim** and **release** endpoints;
  - a new `time_task.assignee_changed` event and the general `unassigned_created` and `assigned` notifications;
  - a shared recipient escalation chain (audience → assigners → owner → project managers) that replaces the "owner + all members" audience for support notifications.

  Later phases are renumbered 4–6.
