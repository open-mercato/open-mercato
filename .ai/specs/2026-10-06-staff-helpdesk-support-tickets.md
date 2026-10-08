# Helpdesk: Customer Support Tickets on Staff Projects

> **Status:** Draft (revised after PR #6965 review)
> **Module:** `staff` (`packages/core/src/modules/staff`). Helpdesk data is kept in a helpdesk-shaped extension entity, so a later `staff` split can move it as a file move (see D1).
> **Reference for the portal surface:** `warranty_claims` (portal intake, customer-pinned ownership, portal attachments) and staff's own EP-50 portal time reports (identity resolution, recipient pinning)
> **Supersedes:** issue [#430](https://github.com/open-mercato/open-mercato/issues/430) "feat: Helpdesk Module" (see D3)
> **Related specs:** `implemented/2026-02-23-core-timesheets.md`, `2026-08-12-time-tracking-module-requirements.md`, `2026-08-24-time-tracking-umes-extension-points.md`, `implemented/2026-05-08-staff-decouple-from-core.md`, `2026-07-03-warranty-rma-claims-desk.md`

## 📝 TLDR

Customer Portal users can register support tickets, follow their status, talk to the team handling them and exchange files.

- **A ticket is a task** (`staff_time_tasks`) in a time-tracking project, so support work shows up on the same board, timesheets and reports the team already uses. Its helpdesk-only data lives in a 1:1 extension entity, `staff_support_tickets`.
- **Categories and routing:** staff administrators keep support ticket categories in a dictionary. A mandatory, seeded **fallback rule** sends every unrouted category to one project ("Customer support"), and optional per-category overrides send a category to its own project. Any target project may belong to a customer or to none.
- **Assigners and default assignee:** projects gain **assigners** (members who are notified about new work and can claim unassigned tasks) and an optional **default assignee** for portal tickets.

## 📝 Decisions

### Gate answers

| # | Question | Decision |
|---|---|---|
| Q1 / Q2 | Rename the module to "Project management" | **Dropped** (D1). The module keeps its current display name. If the module is split later, it shouldn't be renamed into a name it would lose again. |
| Q3 | What a ticket is | A `staff_time_tasks` row with `source = 'portal'` and `customer_id`, plus **one `staff_support_tickets` extension row** keyed 1:1 by `task_id` that holds all helpdesk-only fields (D1). |
| Q4 | Routing | A mandatory **fallback rule** (every category without a usable rule → one project) plus optional **per-category rules** (category → project). A paused or broken per-category rule falls back. The fallback rule and its project are seeded. A target project may or may not have a customer. Ownership of a ticket never derives from the project's customer. |
| Q5 | Category storage | A per-organization dictionary, `staff.support_ticket_category`, owned and seeded by `staff`. It is read for the **exact organization only**, not ancestors (D6). |
| Q6 | Conversation | Two-way thread. Staff replies and customer messages are visible to the customer; staff internal notes never are. |
| Q7 | Portal surface | Portal pages (list, new, detail) in the sidebar, plus a "Support tickets" widget on the portal dashboard. |
| Q8 | Attachments | Included in v1, reusing `attachments` the same way `warranty_claims` does. |
| Q9 | Where assigners and the default assignee are specified | In this spec, as their own phase (Phase 2). Assigners, claim and release are general project features. |
| Q10 | Who can be an assigner | An **"Assigner" flag on an existing project-member row**: an internal team member who has a user account. Assigners are never tied to a customer; customer portal users can't be members, assigners or assignees. |
| Q11 | What assigners can do | Get notified about new portal tickets and released tasks, and **claim unassigned tasks** as their own assignee. They can also release their own claim. Reassigning someone else's task still requires `staff.timesheets.tasks.manage`. |
| Q12 | Scope of the default assignee | **Portal tickets only** (D2). Board and API task creation keep today's rule (US-C1): the creator is the assignee unless the request names someone. |

### PR #6965 review decisions (2026-10-08)

| # | Item | Decision |
|---|---|---|
| D1 | Module boundary (@jtomaszewski; review m2) | **Option B, hedge now.** The feature stays in `staff`, but every helpdesk-only field moves to the extension entity `staff_support_tickets` instead of new columns on `staff_time_tasks`. The display rename (old Phase 1) is dropped. The `staff` → `staff` / `time_tracking` / `projects` / `helpdesk` extraction (option A) is a separate, later spec. When it happens, `staff_support_tickets`, `lib/support/*` and the portal routes move to `helpdesk` as files; only `source` and `customer_id`, which are generic task attributes, stay with tasks. |
| D2 | Default assignee vs creator self-assignment (review B1) | The default assignee applies **only** in `staff.support_tickets.create_from_portal`, where there is no human creator. `staff.timesheets.tasks.create` is **unchanged**: an omitted or `null` `assigneeStaffMemberId` still resolves to the creator through `resolveStaffMemberIdForUser` (`commands/timesheets-tasks.ts:517-520`), and the board's quick-add (`KanbanBoard.tsx`) and "New task" dialog (`NewTaskDialog.tsx`/`TaskBoardScreen.tsx`) keep sending the creator explicitly. No behavior change on existing surfaces. |
| D3 | Issue #430 (review m3) | This spec **supersedes** #430 as the helpdesk design of record. #430's SLA, workload and tag scope remain valid follow-ups that build on this model (see Non-goals). #430's later discussion about building on `messages` is not adopted: the conversation lives in task comments with `visibility`. |
| D4 | Live refresh of backoffice screens (review m1) | Add an id-only client broadcast, `staff.support_ticket.activity`, that open boards, drawers and the Support tickets page refetch on. |
| D5 | Claimable-work notifications outside portal tickets | Replace the general "unassigned task created" notification with **`staff.timesheets.time_task.released`**: assigners are told when a task becomes unassigned (a release, or a manager clearing the assignee). |
| D6 | Category inheritance (review n6) | **Exact organization**, matching `loadWarrantyClaimDictionaryOptions`. Each organization is seeded with its own categories, so categories and routing rules always line up within one organization. |

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
4. **Intake.** Portal routes under `/api/staff/portal/support-tickets/*` create, in one atomic flush:
   - a task in the routed project's default status, with `source = 'portal'`, the filing customer's id, and the project's default assignee if usable (D2);
   - its `staff_support_tickets` extension row, holding the customer snapshot, reporter, category, routing outcome, original request and a customer-facing `support_reference` (e.g. `SUP-1042`).
5. **Ownership.** Portal reads and writes are pinned to `customer_id = auth.customerEntityId` on **the task**, never on the project. This lets the fallback rule send tickets from many customers into one internal project, or into a project that belongs to someone else, without leaking anything.
6. **Conversation.** Task comments gain `visibility` (`internal` | `customer`) and an author kind (`staff` | `customer`). Existing comments and the existing comment API default to `internal`, so current behavior is unchanged.
7. **Customer-facing status** is **derived** from the task's status flags rather than stored, the way Jira Service Management maps workflow statuses to customer-visible status names:
   - `received`: the task is in the project's `isDefault` status.
   - `in_progress`: any other status that is not done.
   - `resolved`: the status has `isDone`.

   A routing target must have an `isDefault` status. The last value published to the portal is kept in `staff_support_tickets.portal_status_published`, so the broadcast subscriber can tell when a change is visible to the customer, whichever path caused it.
8. **What the customer wrote is kept apart from the task text.** The customer's subject and message are stored in `staff_support_tickets.customer_request_snapshot` (encrypted). The task `title`/`description` start as copies, and staff may freely rewrite them for triage. The portal **only** ever reads the snapshot, never the task fields, so internal edits cannot leak.
9. **Assigners and default assignee.**
   - **Assigners** (a general project feature): a project-member row gains `is_assigner`. While their membership is active and inside the assignment window, assigners:
     - are notified when a portal ticket arrives in the project, and when a task in it becomes unassigned (D5);
     - can **claim** an unassigned, not-done task, which sets them as its assignee;
     - can **release** a task they hold, which sets it back to unassigned.

     Claiming does not need `staff.timesheets.tasks.manage`. Being an assigner is the permission, on top of `staff.timesheets.tasks.view`.
   - **Default assignee** (portal tickets only, D2): a project gains `default_assignee_staff_member_id`. `create_from_portal` applies it while that member is an active project member inside the assignment window; otherwise the ticket is created unassigned and the assigners are notified.

### Alternatives considered

| Alternative | Outcome |
|---|---|
| Helpdesk columns directly on `staff_time_tasks` (the first draft) | **Rejected at review (D1).** Nine of the eleven proposed columns were helpdesk-only. Putting them on the tasks table contradicts the root `AGENTS.md` rule for extending data, and would turn a later split into table surgery. |
| **An extension entity `staff_support_tickets`, keyed 1:1 by `task_id`** | **Chosen (D1).** It holds only helpdesk-specific fields. Status, assignee and comments stay on the task, so nothing is duplicated and nothing needs syncing. It moves to a future `helpdesk` module as a file move. |
| A parallel `staff_support_tickets` entity with its own status, assignee and comments | Rejected at Q3. It duplicates status, assignee and comments and needs sync between two records. This is different from the extension entity, which duplicates none of them. |
| A separate `helpdesk` module now (option A) | **Deferred (D1).** It is the right end state, but it depends on first extracting `projects` from `staff` with a stable contract (DI resolvers for task creation and access), plus an answer for the per-module migration ledger (`mikro_orm_migrations_${modId}`). That extraction is its own spec. The extension entity keeps this feature ready to move. |
| Building on the `messages` module (issue #430 discussion) | Rejected (D3). `messages` uses recipient-based access with no public/internal split. Task comments with `visibility` give the split with no new conversation model. |
| Extending `warranty_claims` | Its claim status enum and lifecycle state machine are FROZEN and RMA-specific (SLA pause, dispositions, vendor recovery). |
| Routing stored in time-tracking settings (`ModuleConfigService`) | Those settings are **tenant-global** by contract (`lib/time-tracking/settingKeys.ts`), while project ids are organization-scoped. A tenant-global project id is wrong for every other organization. |
| Stored portal status | It drifts whenever someone moves the task on the board. Deriving it from `isDefault`/`isDone` costs nothing and cannot disagree with the board. |
| A project default assignee for every new task | Rejected at review (D2). Task creation already self-assigns the creator (US-C1) and the board sends the creator explicitly, so the default could never reach board tasks without changing an existing behavior. |

## 📝 Research: what helpdesk leaders do

| Product | Takeaway | Adopted? |
|---|---|---|
| Jira Service Management | A request type maps to a project/queue; workflow statuses map to customer-facing names; public comments vs internal notes | Yes: categories plus routing, derived portal status, `visibility` |
| Zammad / Freescout | A separate ticket number from the internal id; customer replies reopen a resolved ticket; attachments on every message | Yes: `support_reference`, reopen on reply, attachments. Attachments sit at ticket level in v1, not per message |
| Odoo Project + Helpdesk | Tickets as project tasks, visible in the customer portal | Yes: this is Q3 |
| All of the above | SLAs, an email-to-ticket channel, CSAT surveys, canned responses, auto-assignment | **No, out of scope for v1.** Listed under Non-goals. Each layers on top of this model without changing it |

### Non-goals (v1)

- SLA timers and escalation, agent workload views, and ticket tags (#430 scope, follow-ups on this model).
- Email-to-ticket, and email notifications to customers.
- Customer satisfaction ratings.
- Customer-initiated close.
- Round-robin or load-based auto-assignment. Only a fixed per-project default assignee for portal tickets is in scope.
- Per-customer routing overrides.
- Merging tickets.
- Anonymous (not logged-in) submission.
- **Re-routing a ticket to another project.** Tasks cannot change project today: `assertNoProjectMove` returns `task_project_move_unsupported`. A misrouted ticket is handled in the project it landed in; a "move ticket" command is a follow-up.
- Encrypting existing internal comment bodies. This is a separate change, because it needs a tenant-key backfill and a switch of every read site to `findWithDecryption`.
- The display rename of the module (D1).
- The `staff` module extraction (D1).

## 📝 Architecture

```
Portal user ──► /api/staff/portal/support-tickets (customer auth, ownership clause)
                    │ create
                    ▼
            staff.support_tickets.create_from_portal (command, one atomic flush)
                    │ resolveSupportRoute(category) ─► staff_support_routing_rules
                    │ resolveTaskStatus(project)    ─► project's isDefault status
                    │ default assignee              ─► projectAssignment predicate
                    │ allocateTaskReference + allocateSupportReference
                    ▼
            staff_time_tasks (source='portal', customer_id)  +  staff_support_tickets (task_id, …)
                    │ events: staff.timesheets.time_task.created (existing)
                    │         staff.support_ticket.created (new, server-side)
                    │         staff.support_ticket.activity (new, id-only client broadcast)
                    ▼
  Subscribers ─► staff notifications through resolveProjectWorkRecipients
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
- `DictionaryTable`/`DictionaryForm` for the category admin. These are presentational: they take `entries` plus callbacks and no dictionary key, so the settings page wires the fetch and CRUD calls itself, the way the `warranty_claims` settings page does.
- `attachmentScopedUploadService` plus the `customer-visible` tag for files.
- The response-enricher pattern (`data/enrichers.ts`), to attach the extension row to task API responses.
- `notificationService.createForFeature` for the last step of the recipient chain.

**New staff-internal pieces** (all new files)

- `data/entities.ts`: `StaffSupportTicket` (`staff_support_tickets`) and `StaffSupportRoutingRule` (`staff_support_routing_rules`)
- `lib/support/routing.ts` (`resolveSupportRoute`)
- `lib/support/portalStatus.ts` (`derivePortalStatus`)
- `lib/support/portalTickets.ts` (the single ownership clause, written once and pinned by a test, as `portalReports.ts` does)
- `lib/support/dictionaries.ts` (ensure, seed and load categories) and `lib/support/seedDefaults.ts`
- `lib/time-tracking/projectAssignment.ts` (**new**): the active-membership predicate. `isWithinAssignmentWindow` moves here from `lib/time-tracking/access.ts`, and `access.ts` re-imports it, so the access resolver and the new code share one implementation.
- `lib/time-tracking/workRecipients.ts` (`resolveProjectWorkRecipients`)

**Coupling rules** (from `staff/AGENTS.md`, unchanged):

- No static import of `customer_accounts`. Portal identity uses a dynamic import, and recipients are read from `customer_users` by table name through Kysely.
- `customers` data reaches the ticket only as an FK id plus snapshot (the customer's display name at filing time). Staff already does the same for `staff_time_projects.customer_id`. `data/extensions.ts` gains a `staff_time_tasks.customer_id` → `customers:customer_entity` link, in the same form as the existing project → customer link, and a `staff:staff_time_task` → `staff:staff_support_ticket` 1:1 link.
- The portal attachment route copies the warranty-claims flow, but it MUST NOT copy that route's static `customer_accounts` import (reached through `warranty_claims/lib/portalAuthGuard.ts`). Identity goes through the dynamic import.
- Rate limiting uses `checkRateLimit` from `@open-mercato/shared/lib/ratelimit/helpers` (the package index exports only `RateLimiterService`), not the `customer_accounts`-internal limiter.
- `dictionaries` entities are imported directly. That is the established pattern (`staff/lib/seeds.ts`, `warranty_claims/lib/dictionaries.ts`, `sales`, `catalog`), and dictionaries is a core module, so `'dictionaries'` is added to `metadata.requires`.

**Portal broadcast rule** (EP-06 and the warranty-claims rule): `staff.support_ticket.portal_updated` is `portalBroadcast: true` and `excludeFromTriggers: true`. It always carries `recipientUserIds`, resolved from the **ticket's** `customer_id`, and is **not emitted** when that list is empty. The payload carries no free text: only `{ ticketId, supportReference, portalStatus, kind: 'status' | 'reply' }`. The existing `time_task.*` events gain no portal flag, because they are tenant-wide and would leak across customers.

## 📝 Data Model

### `staff_time_tasks`: two generic columns

These two stay on the task because they describe the task itself, not the helpdesk. They would stay with tasks in a future split.

| Column | Type | Notes |
|---|---|---|
| `source` | text, not null, default `'internal'` | `'internal'` \| `'portal'`. Existing rows backfill to `internal` through the default. |
| `customer_id` | uuid, null | FK id into `customers:customer_entity`, the customer the task was filed for. For portal tickets **this column is the portal ownership key**. |

Index: partial `(tenant_id, organization_id, customer_id, updated_at desc) WHERE source = 'portal' AND deleted_at IS NULL`, for the portal list.

### New `staff_support_tickets` (extension, 1:1 with a task)

| Column | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` | standard | Soft-deleted together with its task |
| `task_id` | uuid, not null | FK to `staff_time_tasks` (same module). A partial unique index on live rows enforces 1:1. |
| `customer_snapshot` | jsonb, null | `{ displayName, kind }` at filing time |
| `reported_by_customer_user_id` | uuid, null | The `customer_users` id of the reporter |
| `support_reference` | text, not null | `{prefix}-{n}`, unique per (tenant, org) among live rows. The prefix comes from settings key `support.referencePrefix` (default `SUP`, tenant-global, registered as an EP-42 built-in). It is separate from the task `reference` because the task reference embeds the **project code**, which can name a different customer's project. |
| `support_sequence_number` | integer, not null | Backs `support_reference`. Allocated with max + 1 over all rows, including deleted ones, and retried on a unique-index conflict, the same as task references. |
| `category_value` | text, not null | The dictionary entry `value` |
| `category_snapshot` | jsonb, not null | `{ value, label }`. Dictionary entries are **hard-deleted**, so the label must survive on the ticket. |
| `routed_via` | text, not null | `category` \| `fallback`. Records which rule routed the ticket. |
| `customer_request_snapshot` | jsonb, not null, **encrypted** | `{ subject, body }` exactly as the customer submitted it. The portal reads subject and description only from here. It is immutable after creation. |
| `portal_status_published` | text, null | The last `received` \| `in_progress` \| `resolved` value broadcast to the portal. The subscriber compares against it, so a broadcast fires on every path that changes the derived status. |

Indexes:

- Partial unique `(tenant_id, organization_id, task_id) WHERE deleted_at IS NULL`.
- Partial unique `(tenant_id, organization_id, support_reference) WHERE deleted_at IS NULL`.

The extension row is created only by `create_from_portal`, in the same atomic flush as its task. The task delete command soft-deletes it alongside the task (a cascade in the staff command, not an ORM relation), and the task restore and undo path restores it.

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
| `staff_time_projects.default_assignee_staff_member_id` | uuid, null | Used **only for portal tickets** (D2). Must be an **active** member of the same project when saved (`422 staff.timesheets.errors.defaultAssigneeNotMember`). It does not have to be an assigner. |

The partial index `(tenant_id, organization_id, time_project_id) WHERE is_assigner AND status = 'active' AND deleted_at IS NULL` supports recipient lookups.

"Active assigner" and "usable default assignee" share one predicate with `timeTrackingAccessResolver`: status `active`, not deleted, and `assigned_start_date <= today <= assigned_end_date + assignmentGraceDays`. It lives in the new `lib/time-tracking/projectAssignment.ts` (see Architecture).

### New `staff_support_routing_rules`

| Column | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` | standard | `updated_at` gives optimistic locking |
| `category_value` | text, null | **null = the fallback rule.** Exactly one per organization; it can't be deleted or paused (`422 staff.support.errors.fallbackRuleRequired`) |
| `time_project_id` | uuid, not null | FK id to `staff_time_projects` in the same module, so a real FK is allowed |
| `is_active` | boolean, default true | Lets an admin pause a per-category rule without deleting it. Its tickets then go to the fallback project. Always true on the fallback rule. |

Partial unique index on `(tenant_id, organization_id, coalesce(category_value, ''))` where `deleted_at IS NULL`. This allows at most one fallback rule and one rule per category. The "exactly one" half is guaranteed by seeding plus the delete/pause refusal. It is an expression index that entity decorators cannot express, so it is hand-written in the migration and the snapshot is reconciled manually.

### Categories dictionary

The dictionary key is `staff.support_ticket_category`. It is per-organization and read for the **exact organization only** (D6), the same way `loadWarrantyClaimDictionaryOptions` does, and ancestors are not consulted. Ensure and seed run in `setup.ts` `seedDefaults` and in the idempotent CLI `mercato staff seed-support-defaults` for existing tenants (which also seeds the fallback project and rule). The portal only offers entries that are on an active dictionary **and** resolve to a usable route (see the routing algorithm).

### Encryption and search

- `staff_support_tickets.customer_request_snapshot` is declared in `encryption.ts`. It is a new column with no legacy rows, it is not indexed for search, and it is read only through `findOneWithDecryption`/`findWithDecryption` in the portal routes and the drawer panel.
- Task `title`/`description` and all comment bodies **stay unencrypted**, the same as today. Customer-authored comments are plaintext as well. This is an accepted v1 risk, recorded under Risks. Encrypting comment bodies is a separate change (see Non-goals), because existing comments are indexed (`commentCrudIndexer`) and read through plain `em.find` at several sites.
- Global search is unchanged: `staff:staff_time_task` keeps its fields, and search on tasks already requires `staff.timesheets.projects.manage`. Finding a ticket by `support_reference` is done on the Support tickets page, through the tasks API `supportReference` filter.

### Routing algorithm (`resolveSupportRoute`)

```
usable(project) = live, same tenant+org, status in ('active','on_hold'), has an isDefault task status

rule = active rule for categoryValue
if rule && usable(rule.project)        → { project: rule.project, via: 'category' }
if usable(fallbackRule.project)        → { project: fallbackRule.project, via: 'fallback' }
return null
```

- **A category with no rule, a paused rule, or a rule whose project became unusable** goes to the fallback project. The ticket stores `via` in `routed_via`, so staff and admins can see a misconfigured override at work. The routing page warns on every override that is currently falling back.
- **The fallback project itself is unusable** (an admin completed or deleted the seeded project, or removed its default status). This is the only state in which no ticket can be created for categories without a usable override: `options.categories` lists only the categories that still route, and the routing page shows a blocking error asking the admin to repoint the fallback rule.
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
staff_time_tasks t JOIN staff_support_tickets s ON s.task_id = t.id
WHERE t.tenant_id = auth.tenantId AND t.organization_id = auth.orgId
  AND t.customer_id = auth.customerEntityId AND t.source = 'portal'
  AND t.deleted_at IS NULL AND s.deleted_at IS NULL
```

Detail and sub-resources **load with** this clause, never "load, then check", following EP-50.

`portal.support_tickets.view` is granted to `buyer` and `viewer`, and `portal.support_tickets.manage` to `buyer`, through `setup.defaultCustomerRoleFeatures`. Existing tenants run `mercato customer_accounts sync-customer-role-acls`. These features are **not** added to `acl.ts`, which is the staff feature catalog (the same convention as `portal.time_reports.view`).

### Backoffice (additive only)

| Surface | Change |
|---|---|
| `GET /api/staff/timesheets/tasks` | New filters `source`, `customerId`, `supportCategory`, `supportReference`, `portalStatus`. New response fields `source` and `customerId`, plus a `supportTicket` object (`supportReference`, `category`, `routedVia`, `portalStatus`, `customerSnapshot`, `reportedByCustomerUserId`) attached by a response enricher from the extension row. It is null for internal tasks. |
| `POST/PUT /api/staff/timesheets/tasks` | **Unchanged behavior.** Omitted or `null` `assigneeStaffMemberId` still means "the creator" (US-C1). `source`, `customer_id` and the extension row are **read-only** through this route, so backoffice can't create `source = 'portal'` tasks. |
| `/api/staff/timesheets/tasks/{id}/comments` | `POST` accepts an optional `visibility` (default `internal`). Responses add `visibility`, `authorKind`, `authorName`. The comment command changes as follows. **(1)** `author_kind = 'customer'` comments are refused for edit and delete **before** the `manage_all` exemption in `requireEditableComment`, which today lets a manager edit any comment. **(2)** `visibility = 'customer'` is rejected with 422 unless `task.source = 'portal'`. **(3)** Changing `customer` → `internal` is allowed, to retract a reply. |
| `GET/POST/PUT/DELETE /api/staff/timesheets/support-routing-rules` | `makeCrudRoute`. Feature `staff.timesheets.settings.manage`. Optimistic locking default ON. Validation: the project belongs to the same org and has an `isDefault` status; `categoryValue` exists in the organization's dictionary when not null. |
| `POST /api/staff/timesheets/tasks/{id}/claim` | **New.** Requires `staff.timesheets.tasks.view`, a staff profile, and active assigner membership of the task's project. The task must be unassigned and not in an `isDone` status. It is an atomic conditional update (`… SET assignee = :me WHERE id = :id AND assignee_staff_member_id IS NULL`); losing a race returns `409 staff.timesheets.errors.taskAlreadyClaimed`. Accepts the optimistic-lock header. |
| `POST /api/staff/timesheets/tasks/{id}/release` | **New.** Only the current assignee may release (`403` otherwise); the task becomes unassigned. Managers keep using `PUT /tasks`. |
| Project members CRUD (existing route) | Accepts and returns `isAssigner`. |
| Projects CRUD (existing route) | Accepts and returns `defaultAssigneeStaffMemberId`. Removing a member, or making them inactive, while they are the default assignee is allowed; the project then shows a warning, and new portal tickets fall to the assigners. |
| `GET/PUT /api/staff/timesheets/settings` | Gains the built-in key `support.referencePrefix` (`^[A-Z][A-Z0-9]{1,9}$`, default `SUP`) |

### Commands

| Command id | Purpose | Undo |
|---|---|---|
| `staff.support_tickets.create_from_portal` | Route; allocate both references; create the task in the default status with the usable default assignee (else unassigned) and its extension row in one flush; save the first message as the description | Soft-deletes the task and its extension row. Not offered to customers; staff undo is available through the task delete command. |
| `staff.support_tickets.portal_message` | Append a customer-visible comment with `author_kind = 'customer'`, and reopen if resolved | Soft-deletes the comment and restores the prior status |
| `staff.timesheets.task_comments.create` (extended) | Accepts `visibility` | unchanged |
| `staff.timesheets.tasks.delete` / restore (extended) | Cascades soft-delete and restore to the task's extension row | unchanged |
| `staff.timesheets.tasks.claim` | An assigner sets themselves as assignee on an unassigned task | Restores the unassigned state, provided the task is still assigned to the claimer |
| `staff.timesheets.tasks.release` | The assignee unassigns themselves | Restores the previous assignee, provided the task is still unassigned |

### Events (new, additive)

| Id | Flags | Payload |
|---|---|---|
| `staff.support_ticket.created` | persistent | `{ taskId, projectId, customerId, supportReference, categoryValue }` |
| `staff.support_ticket.customer_replied` | persistent | `{ taskId, projectId, commentId, supportReference }` |
| `staff.support_ticket.activity` | clientBroadcast | `{ taskId, projectId, kind: 'created' \| 'customer_replied' \| 'portal_status' }`. **Ids only, no customer data.** Open boards, drawers and the Support tickets page refetch on it (D4). |
| `staff.support_ticket.portal_updated` | portalBroadcast, excludeFromTriggers | `{ ticketId, supportReference, portalStatus, kind, recipientUserIds }` |
| `staff.timesheets.time_task.assignee_changed` | persistent, clientBroadcast | `{ taskId, projectId, previousAssigneeStaffMemberId, assigneeStaffMemberId, reason: 'default' \| 'claim' \| 'release' \| 'manual' }`. Ids only, the same shape as the existing `status_changed`. Emitted by `create_from_portal` (when the default is applied), claim, release, and any `PUT` that changes the assignee. |

`support_ticket.created` and `customer_replied` carry `customerId` and are therefore **not** client-broadcast. `clientBroadcast` reaches every signed-in user of the organization with no feature or project-membership check, and staff already keeps `customerId` out of browser broadcasts (`events.ts`, `time_report.closed`). Live refresh comes from the separate id-only `activity` event. This is needed because only `time_task.status_changed` is bridged to the browser today; `time_task.created`, `time_task.updated` and `time_task_comment.*` are not.

The existing `time_task_comment.created|updated|deleted` events gain an additive payload field, `portalVisible: boolean`. It is true when the comment's visibility **before or after** the change is `customer`, so retracting or deleting a reply also refreshes the portal.

`subscribers/support-ticket-portal-broadcast.ts` emits `portal_updated` (always with pinned recipients, and never when the recipient list is empty) on:

- `time_task.status_changed` **and** `time_task.updated`, for `source = 'portal'` tasks. A `PUT /tasks` that changes `taskStatusId` emits only `updated`. The subscriber recomputes `derivePortalStatus` and emits with `kind: 'status'` only when the result differs from `portal_status_published`, which it then updates.
- `time_task_status.updated` (an `isDone`/`isDefault` flag edit re-labels a whole column): fans out over the live portal tasks in that status, applying the same compare-and-publish rule. The fan-out is bounded by a batch size and runs in the persistent subscriber.
- `time_task_comment.*` with `portalVisible = true` (`kind: 'reply'`).

The same subscriber emits `activity` with `kind: 'portal_status'` whenever it publishes a status change.

### Notifications (staff)

All recipient lists go through one **escalation chain**, `resolveProjectWorkRecipients` (new, `lib/time-tracking/workRecipients.ts`). Each step is used only when the previous one is empty, and the user who caused the event is always excluded.

1. **The type's own audience** (see the table below).
2. **The project's active assigners.**
3. **The project owner.**
4. **Holders of `staff.timesheets.projects.manage` in the event's organization.**
   - It is sent through `notificationService.createForFeature` with `{ tenantId, organizationId }`. That service resolves holders with the wildcard-aware `getRecipientUserIdsForFeature` (`notifications/lib/notificationRecipients.ts`, tenant-scoped) and then narrows to the organization.
   - So managers of other organizations in the same tenant are never notified.
   - `RbacService` has no "list users by feature" method, so it is not used.

This means a ticket in the seeded fallback project is never unseen, even before anyone is assigned.

| Type | Audience (step 1) |
|---|---|
| `staff.support_ticket.created` | The assignee, if the default was applied, **plus** the active assigners. Ticket intake is always visible to the dispatching team. |
| `staff.support_ticket.customer_replied` | The assignee; if the ticket is unassigned, the chain starts at step 2. |
| `staff.timesheets.time_task.released` (**new, general**, D5) | Starts at step 2: a task in the project became unassigned (a release, or a `PUT` that cleared the assignee). It tells assigners there is claimable work. |
| `staff.timesheets.time_task.assigned` (**new, general**) | The new assignee, when someone else assigned them or the portal default was applied. A claim is self-assignment, so it is not sent for claims. |

All notifications are rendered with i18n keys and link to the board drawer, which has a **Claim** action.

## 📝 UI/UX

### Portal (customer)

- **`/{orgSlug}/portal/support`** (list):
  - Page meta: `requireCustomerAuth`, `requireCustomerFeatures: ['portal.support_tickets.view']`, `nav { label: 'Support', labelKey: 'staff.portal.support.nav', group: 'main', order: 45, icon: 'life-buoy' }`. `label` is the fallback that `PortalNavMetadata` requires.
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

- **Sidebar.** The existing "Time tracking" group (label unchanged, D1) gains a **Support tickets** page (`/backend/staff/time-tracking/support`, feature `staff.timesheets.tasks.view`).
  - The page is a `DataTable` over the tasks API with `source=portal`.
  - Columns: support reference, subject, customer, category, portal status, project, assignee, last activity.
  - Filters: portal status, category, project, customer, assignee, and a reference search.
  - Visible projects are limited by `timeTrackingAccessResolver`.
  - It refetches on `staff.support_ticket.activity` and `assignee_changed`.
  - A row opens the existing `TaskDrawer` (`?task=`).
- **`TaskDrawer`** for a `source = 'portal'` task:
  - A **Customer request** panel shows the customer, the reporter, the category, the support reference, the routing outcome and the portal status the customer currently sees.
  - The comment composer has **two explicit buttons**, "Reply to customer" and "Add internal note". There is no hidden default, so an internal note cannot be sent to a customer by accident.
  - Customer-visible comments carry a "Visible to customer" marker, and customer-authored ones are styled as incoming.
  - A **new attachments section** (the drawer has none today), shown for portal tasks only. It lists files, marks customer-visible ones, and staff uploads include a "Share with customer" checkbox, unchecked by default.
  - Editing the task title or description shows a hint: "The customer sees their original request, not this text."
  - It refetches on `staff.support_ticket.activity` for its task.
- **Project form and members tab:**
  - an "Assigner" toggle per member, disabled with a tooltip for members without a user account;
  - a "Default assignee for portal tickets" select limited to active members;
  - a warning when the default assignee's membership is inactive or outside its assignment window.
- **Board and drawer:**
  - an unassigned task shows a **Claim** button to active assigners, and the assignee sees **Release**;
  - **a new "Unassigned" chip in `BoardFilterChips`**, which today offers only "Assigned to me", assignee, status and tag. It shows the count of unassigned tasks, so assigners can find work to claim;
  - board create flows (quick-add, "New task") are **unchanged** and still assign the creator (D2).
- **Board cards** for portal tasks show a small "Customer request" badge and the support reference.
- **Settings → Support** (`/backend/staff/time-tracking/settings/support`, feature `staff.timesheets.settings.manage`):
  1. **Categories:** `DictionaryTable`/`DictionaryForm` for `staff.support_ticket_category`. The page loads the organization's dictionary and wires the entry CRUD calls itself, as the `warranty_claims` settings page does, because the components are presentational.
  2. **Routing:**
     - A required **"Fallback project"** select, pre-filled with the seeded "Customer support" project. It can be repointed but not cleared.
     - A table of category → project overrides, with add, edit, delete and pause.
     - Each override row shows a warning badge, "Falling back to <fallback project>", when it is paused, its project is unusable (completed, deleted, or has no default status), or its category no longer exists.
     - A preview column shows the project each category actually routes to right now.
     - A blocking error banner appears when the fallback project is unusable.
     - A warning appears when the fallback project has no active assigner, no usable default assignee and no owner. In that state, new-ticket notifications go to the organization's project managers (see Notifications).
  3. **Reference prefix**.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| A fresh organization with no configuration | Seeded: the "Customer support" project, the fallback rule and four categories. The portal accepts tickets immediately. |
| An existing tenant upgrades | Until `mercato staff seed-support-defaults` runs, there is no fallback rule and `options.categories` is empty. The portal shows "Support requests are not available yet", and the routing page offers a "Create fallback project" action that runs the same seeding for that organization. |
| An override's target project is completed or deleted after tickets were filed | Existing tickets stay where they are, and the portal still shows them. New tickets in that category go to the fallback project, and the routing page warns on the override. |
| The fallback project is completed, deleted, or loses its default status | No new tickets are possible except through still-usable overrides. The routing page shows a blocking error; the portal shows "not available" for the affected categories. |
| An admin tries to delete or pause the fallback rule | `422 staff.support.errors.fallbackRuleRequired` |
| The dictionary entry is deleted (hard delete) | Tickets keep `category_snapshot.label`. The orphaned override is flagged on the routing page; the portal stops offering the category because it is no longer in the dictionary. |
| A child organization has no categories of its own | Categories are read for the exact organization (D6), so it offers none until it is seeded. Seeding runs per organization in `seedDefaults`, and the CLI covers existing ones. |
| A rule is saved targeting a project with no `isDefault` task status (legacy projects, which status seeding did not backfill) | Rejected with `staff.support.errors.projectHasNoDefaultStatus`. |
| An admin deletes the seeded "Customer support" project and then re-runs seeding | Seeding is idempotent per rule. A fallback rule that exists, even one pointing at a deleted project, is never overwritten; the admin repoints it. A project is only created when no fallback rule exists. |
| Concurrent creates race for `support_sequence_number` | The unique index rejects one, and the command retries up to 3 times (the same strategy as `task_reference_conflict`). After that it returns `409`, and the portal asks the user to resubmit. |
| A task is deleted, then restored | The extension row is soft-deleted and restored with it, so the portal hides and then shows the ticket again. |
| A staff member changes the ticket's status (board drag, status endpoint or `PUT /tasks`) | The portal status is re-derived, and `portal_updated` fires only if it changed. |
| An admin edits a status column's `isDone`/`isDefault` flag | Every portal ticket in that column is re-derived through the `time_task_status.updated` fan-out. |
| A ticket was routed to the wrong project | Tasks cannot change project (`task_project_move_unsupported`). Staff handle it where it landed. Re-routing is a listed follow-up. |
| A staff member retracts a reply (flips it to internal) or deletes it | `portalVisible` is true on that event, so the portal refreshes and the message disappears. |
| Two assigners claim the same task at the same time | The conditional update lets exactly one win; the other gets `409 taskAlreadyClaimed`, and the board refreshes from `assignee_changed`. |
| The default assignee left the project, their assignment window expired, or they were deleted | New portal tickets are created unassigned, and the escalation chain notifies the assigners. The project form shows a warning. Nothing fails. |
| A staff member creates a task on the board in a project that has a default assignee | The creator is the assignee, exactly as today (D2). The project default applies only to portal tickets. |
| A member's team member loses their user account while flagged as an assigner | They drop out of the recipient lists (no user to notify) and can't claim (no session). The members tab flags the row. |
| An assigner tries to claim a task in a done status, or one that is already assigned | `422 staff.timesheets.errors.taskNotClaimable` or `409 taskAlreadyClaimed`. Taking over someone else's task is out of scope (Q11). |
| A staff member deletes the task | The portal answers `404` for it and it drops out of the list. |
| A customer user is deactivated, or the customer has no active portal users | The ticket stays visible to the company's other users. `portal_updated` is not emitted for an empty recipient list. |
| The portal session has no `customerEntityId` | `403 staff.errors.customerAccountNotLinked`, the same as EP-50 |
| The `customer_accounts` dynamic import fails (module disabled) | `401`; the pages are unreachable because their guards fail |
| Spam or flooding from one account | Portal `POST` routes call `checkRateLimit` (`@open-mercato/shared/lib/ratelimit/helpers`), keyed by customer user. The defaults are 10 tickets and 60 messages per hour; exceeding them returns `429` with the shared rate-limit error key. |
| A staff member without project membership searches globally | Task search already requires `staff.timesheets.projects.manage`, so they find nothing. |
| An attachment upload fails after the ticket was created | The ticket exists; the detail page lists the failed file with a retry. |

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| A cross-customer leak through a shared project | High | Ownership comes from the task's `customer_id` and is written in one clause, which tests pin. The portal never selects project fields, the task reference or internal comments. Portal broadcasts always pin recipients; the browser `activity` event carries ids only. |
| An internal note shown to a customer | High | `visibility` defaults to `internal` on every existing path; the composer uses explicit buttons; the portal query filters `visibility = 'customer'` in SQL. The portal never reads the staff-editable task title or description, only the immutable `customer_request_snapshot`. |
| The task and its extension row drift apart (an orphan or a missing row) | Medium | Both are written in one atomic flush; delete and restore cascade in the task commands; a unique index enforces 1:1. The portal clause joins both, so a missing row hides a ticket instead of exposing a half-record. A unit test covers the cascade. |
| Personal data in plaintext customer comments and in the task title/description copy | Medium | An accepted v1 tradeoff, the same as all task comments today. The original request is encrypted; the form copy discourages secrets; comment encryption is a listed follow-up. |
| A broadcast disclosing customers to staff outside the project | Medium | The events that carry `customerId` are server-side only. Notifications follow the escalation chain, which is limited to the project's people and, last, the organization's project managers. |
| A future `staff` split | Low | Helpdesk data is isolated in `staff_support_tickets`, `staff_support_routing_rules` and `lib/support/*`. Only two generic task columns sit on the tasks table, so the split is a file move (D1). |
| A migration on the large `staff_time_tasks` table | Low | Only two additive columns, nullable or with a constant default, which is a metadata-only change on PostgreSQL 11+. The one new index is partial. |

**Backward compatibility** (checked against `BACKWARD_COMPATIBILITY.md`):

- **Additive:** the DB columns and the two new tables; API fields, filters and routes; event ids; notification types; portal feature ids; injection spot ids; the `requires` entry; the `portalVisible` payload field on the existing comment events.
- **Unchanged (explicitly):** task creation's assignee rule (US-C1, omitted or `null` → creator) and the board's create flows (D2); the module's display name (D1); all ACL ids; the module id.
- **Behavior change on an existing surface:** comment `PUT`/`DELETE` now refuses customer-authored comments even for `manage_all` holders. No such comments exist before this feature, so no existing caller is affected.
- **Rollback:** the feature is gated by the portal features and by routing rules. With no rules, no tickets can be created. Columns and tables can stay in place; a down migration drops them.

## 📋 Phasing

Staff-side handling ships **before** portal intake, so customers never get a channel where nobody can answer them.

| Phase | Ships | Works without later phases? |
|---|---|---|
| 1. Data model, categories and routing admin | Migration (task columns, `staff_support_tickets`, routing rules); seeding of categories, the "Customer support" project and the fallback rule; routing rules CRUD and the settings page | Yes. Admins can configure; nothing is customer-facing yet. |
| 2. Project assigners and default assignee | `is_assigner`, the portal default-assignee setting, claim and release, `assignee_changed`, the `released`/`assigned` notifications, the recipient escalation chain, and the Unassigned chip | Yes. Useful on its own for every project. |
| 3. Staff-side ticket handling | The ticket create command, comment visibility and guards, the drawer "Customer request" panel, the Support tickets page, staff notifications, the portal-status subscriber, the `activity` broadcast | Yes. It is inert until portal tickets exist, and tested with tickets created through the command in fixtures. |
| 4. Portal intake and conversation | Portal API, the list/new/detail pages with two-way messages, the dashboard widget, the portal broadcast and `defaultCustomerRoleFeatures` | Yes. This is the first customer-visible release. |
| 5. Attachments | Portal and staff customer-visible files, including the new drawer section | Yes |

## 📋 Implementation Plan

### Phase 1: Data model, categories and routing

1. **1.1** Entities and migration:
   - `source` and `customer_id` on `staff_time_tasks`, with the portal list index;
   - the new `staff_support_tickets` table with its unique indexes;
   - the comment columns;
   - the `staff_support_routing_rules` table, with a hand-written expression unique index and the snapshot reconciled;
   - `customer_request_snapshot` in `encryption.ts`;
   - the task → customer and task → support-ticket links in `data/extensions.ts`.

   *Test:* an entity/migration unit test; an encryption-map test for the new column.
2. **1.2** `lib/support/seedDefaults.ts` and `lib/support/dictionaries.ts`, called from `setup.ts` `seedDefaults` and from the CLI `mercato staff seed-support-defaults`. They ensure:
   - the `staff.support_ticket_category` dictionary and its four entries, per organization;
   - the "Customer support" project, with a resolver-generated code and the standard statuses;
   - the fallback rule.

   The category loader reads the exact organization only (D6). Add `'dictionaries'` to `requires`. *Test:* a seeding unit test:
   - running it twice creates nothing new;
   - an existing fallback rule, even one pointing at a deleted project, is never overwritten;
   - a project-code collision gets a different code;
   - a new organization ends up with a usable route;
   - the loader ignores a parent organization's entries.
3. **1.3** `lib/support/routing.ts` `resolveSupportRoute`, and `lib/support/portalStatus.ts` `derivePortalStatus`. *Test:* unit tables covering:
   - the fallback rule only;
   - a usable per-category override;
   - paused, unusable and orphaned overrides all fall back, with `via: 'fallback'` recorded;
   - an unusable fallback with a usable override (the override still works);
   - an unusable fallback with no override (returns null);
   - `on_hold` vs `completed` projects;
   - a project with no `isDefault` status.
4. **1.4** The `support-routing-rules` CRUD route, validators and OpenAPI, plus the `support.referencePrefix` built-in setting key. *Test:* integration TC-STAFF-SUP-001:
   - CRUD works;
   - a second fallback rule is rejected;
   - deleting or pausing the fallback rule returns 422;
   - a cross-org project is rejected;
   - a project with no default status is rejected;
   - a stale `updatedAt` returns 409.
5. **1.5** The Settings → Support page:
   - categories, with the caller-side fetch and CRUD wiring around the presentational `DictionaryTable`/`DictionaryForm`, modeled on the `warranty_claims` settings page;
   - the routing editor with warnings and a preview;
   - the prefix field.

   *Test:* Playwright TC-STAFF-SUP-002.

### Phase 2: Project assigners and default assignee

1. **2.1** Migration for `is_assigner`, `default_assignee_staff_member_id` and the partial index. Create **new** `lib/time-tracking/projectAssignment.ts`: move `isWithinAssignmentWindow` there from `lib/time-tracking/access.ts` (which re-imports it), and add the active-member and active-assigner predicates. Add validators and API fields on the existing members and projects routes (`assignerNeedsUser`, `defaultAssigneeNotMember`). *Test:* unit tests for the predicate (status, assignment window, grace period, deleted); the existing `access.ts` tests still pass; integration TC-STAFF-ASG-001 (toggle, a member without a user account rejected, a non-member default rejected).
2. **2.2** The claim and release commands and routes (atomic conditional update, undo, `assignee_changed`). Make `PUT /tasks` emit `assignee_changed` with `reason: 'manual'`. *Test:* TC-STAFF-ASG-002:
   - an assigner claims;
   - a non-assigner gets 403;
   - an already-assigned task returns 409;
   - a done task returns 422;
   - parallel claims let exactly one win;
   - release by the assignee works, and by anyone else returns 403.
3. **2.3** `resolveProjectWorkRecipients` (the escalation chain; step 4 through `notificationService.createForFeature` with the organization), plus the `time_task.released` and `time_task.assigned` notification types, renderers and subscribers. *Test:* unit tests for:
   - each chain step;
   - actor exclusion;
   - the wildcard `projects.manage` fallback;
   - a manager in a sibling organization of the same tenant is **not** notified;
   - a `PUT` that clears the assignee sends `released`.
4. **2.4** UI:
   - the Assigner toggle and the "Default assignee for portal tickets" select on the project;
   - the Claim and Release buttons on the board and drawer;
   - the **new "Unassigned" chip** in `BoardFilterChips`, with a count.

   *Test:* Playwright TC-STAFF-ASG-003: configure the project; a manager unassigns a task; an assigner is notified, finds it through the Unassigned chip (asserting the chip and its count), claims it and releases it.
5. **2.5** A regression guard for D2. *Test:* TC-STAFF-ASG-004 runs on a project with a default assignee:
   - `POST /tasks` with the assignee omitted, with `null`, and with an explicit id;
   - a board quick-add create.

   Every case assigns the creator or the explicit id, never the project default.

### Phase 3: Staff-side ticket handling

1. **3.1** The `staff.support_tickets.create_from_portal` command:
   - routing, and both references with retry;
   - the default status;
   - the usable default assignee, otherwise unassigned;
   - the task and extension row in one flush, with `customer_request_snapshot`;
   - the `support_ticket.created` and `activity` events.

   Also the delete and restore cascade in the task commands. There is no route yet; fixtures call the command. *Test:* a command unit test covering:
   - reference retry;
   - an unroutable category;
   - default assignee applied, unusable, and absent;
   - the snapshot stays immutable when the task is updated;
   - delete and restore cascade to the extension row.
2. **3.2** Comment command and API changes:
   - `visibility`, `author_kind` and `portalVisible` on the comment events;
   - customer-authored comments refused before the `manage_all` exemption;
   - `visibility='customer'` rejected on non-portal tasks.

   *Test:* TC-STAFF-SUP-003:
   - a client that posts without `visibility` gets `internal`;
   - a manager can't edit a customer comment;
   - a customer-visible comment on an internal task returns 422.
3. **3.3** `subscribers/support-ticket-portal-broadcast.ts`, built on `time_task.updated`, `.status_changed`, `time_task_status.updated` (fan-out) and comment events with `portalVisible`, using compare-and-publish against `portal_status_published` and emitting `activity` alongside. Also the support notification types and renderers through the escalation chain. *Test:* subscriber unit tests:
   - a `PUT` status change publishes;
   - a column flag edit fans out;
   - no change means no emit;
   - recipients are pinned and an empty list means no emit;
   - the payload contains no free text;
   - a retracted or deleted reply publishes;
   - the `activity` payload holds ids only.
4. **3.4** Backoffice UI:
   - the Support tickets page, with a reference search and live refresh on `activity`;
   - the drawer "Customer request" panel showing the snapshot, with the two-button composer and the "customer sees original" hint;
   - the board badge;
   - the tasks API filters, plus the `supportTicket` response enricher.

   *Test:* Playwright TC-STAFF-SUP-004 against a fixture ticket. It includes an open Support tickets page updating when a second fixture ticket is created.

### Phase 4: Portal intake and conversation

1. **4.1** `lib/support/portalTickets.ts`: the ownership clause (the task joined with the extension row) and the portal identity helper (the EP-50 shape, dynamic import), plus the `checkRateLimit` wiring from `@open-mercato/shared/lib/ratelimit/helpers`. *Test:* a unit test pinning the clause, including that the project's `customer_id` is never consulted.
2. **4.2** The portal `options`, list, create, detail and messages routes, and the `staff.support_tickets.portal_message` command (reopen on reply), plus `defaultCustomerRoleFeatures`. *Test:* integration TC-STAFF-SUP-005:
   - customers A and B file tickets into one shared project, and each sees only their own;
   - a foreign id returns 404;
   - a viewer can't create;
   - an unroutable category returns 422;
   - responses contain no project, task reference, task title/description, internal comment or money keys;
   - a staff edit of the task description never shows on the portal;
   - a reply on a resolved ticket reopens it;
   - going over the limit returns 429.
3. **4.3** The portal pages (list, new, detail with thread and `usePortalAppEvent` refresh) with i18n, DS tokens, keyboard shortcuts and the nav `label` fallback. *Test:* Playwright TC-STAFF-SUP-006:
   - a customer files a ticket;
   - staff reply and add an internal note;
   - the customer sees only the reply;
   - the customer replies back.
4. **4.4** The portal dashboard widget on `portal:dashboard:sections`. *Test:* Playwright TC-STAFF-SUP-007 (the widget renders and is gated by the feature). Then document the new public surfaces in a staff `AGENTS.md` section, "Customer support tickets": routes, events, spots, the ownership clause, the `portalVisible` field and the extension-entity layout.

### Phase 5: Attachments

1. **5.1** The portal attachments route, modeled on warranty claims but without its static `customer_accounts` import: the `customer-visible` tag, the `customer-upload:<customerUserId>` tag, delete only own uploads, and a streamed download. *Test:* TC-STAFF-SUP-008:
   - upload, list and download work;
   - a foreign ticket returns 404;
   - an untagged staff file is invisible;
   - deleting another user's upload returns 403.
2. **5.2** The new drawer attachments section with "Share with customer", and the portal new/detail upload UI with retry. *Test:* Playwright TC-STAFF-SUP-009.

Each phase ends with the validation gate from `.ai/agentic.config.json`.

## ✅ Final Compliance Report

| Rule (root / staff `AGENTS.md`) | Status |
|---|---|
| Extend data through a separate extension entity plus `data/extensions.ts` | ✅ Helpdesk-only fields live in `staff_support_tickets`; the links are declared in `data/extensions.ts` |
| No direct ORM relations between modules | ✅ `customers` is coupled by FK id plus snapshot, plus the `data/extensions.ts` link. `dictionaries` uses the established direct-entity pattern and is listed in `requires`. |
| No static `customer_accounts` dependency from `staff` | ✅ Dynamic import for identity; Kysely by table name for recipients |
| Tenant and organization scoping on every query | ✅ The ownership clause and routing resolver carry both; notification step 4 is narrowed to the organization |
| Portal broadcast pins recipients and skips an empty list | ✅ `portal_updated` |
| No browser broadcast of customer identity to the whole organization | ✅ Events carrying `customerId` are server-side only; `activity` carries ids only |
| Atomic claim (no lost update between concurrent assigners) | ✅ Conditional update plus 409; covered by TC-STAFF-ASG-002 |
| Optimistic locking on new user-editable entities | ✅ Routing rules (`updated_at`, CRUD default ON); tasks and comments keep their existing locks |
| Encryption for sensitive free text | ⚠️ Partial. The original request is encrypted; comment and task text stay plaintext as an accepted, documented v1 risk with a listed follow-up |
| i18n, no hard-coded strings, DS status tokens | ✅ Planned per step; checked by `yarn i18n:check-sync` |
| `BACKWARD_COMPATIBILITY.md` | ✅ Additive only. Task-create assignment is explicitly unchanged (D2). One narrowed behavior (customer comments are immutable) affects no existing data |
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
  - a mandatory **fallback rule** that can't be deleted or paused catches every category without a usable override;
  - every organization is seeded with a "Customer support" project and a fallback rule pointing to it;
  - `routed_via` records which rule routed a ticket;
  - new-ticket notifications fall back to project managers when the project has no one assigned.
- **2026-10-06** — Added project **assigners** and a **default assignee** (Q9–Q12), with claim and release, the `assignee_changed` event and a recipient escalation chain.
- **2026-10-08** — Revised after the PR #6965 review (D1–D6):
  - **Boundary (option B):** helpdesk-only fields moved from `staff_time_tasks` into the new extension entity `staff_support_tickets`; only `source` and `customer_id` stay on tasks. The "Project management" display rename (old Phase 1) is dropped, and phases are renumbered 1–5.
  - **B1:** the default assignee now applies to portal tickets only. Task creation's US-C1 rule (omitted or `null` → creator) and the board create flows are explicitly unchanged, with a regression test (TC-STAFF-ASG-004).
  - **m1:** a new id-only client broadcast, `staff.support_ticket.activity`, drives live refresh, because only `time_task.status_changed` was bridged before.
  - **m2:** the extension entity is now evaluated (and chosen) in Alternatives.
  - **m3:** this spec supersedes issue #430.
  - **m4:** escalation step 4 uses `notificationService.createForFeature` (`getRecipientUserIdsForFeature`), narrowed to the organization.
  - **m5:** the board's "Unassigned" chip is specified as new.
  - The general `unassigned_created` notification is replaced by `time_task.released` (D5).
  - **Nits:**
    - the stray table header is removed;
    - the `checkRateLimit` import path is corrected to `…/ratelimit/helpers`;
    - the extensions link now cites the project → customer link;
    - `projectAssignment.ts` is marked new, with `isWithinAssignmentWindow` moved there from `access.ts`;
    - the presentational `DictionaryTable` wiring is spelled out;
    - category reading is exact-organization (D6);
    - the portal nav gets a `label` fallback.
