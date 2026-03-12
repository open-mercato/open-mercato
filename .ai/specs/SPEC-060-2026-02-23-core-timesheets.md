# Timesheets Spec (Draft)

## TLDR
**Key Points:**
- Implement timesheets functionality inside the existing `staff` module with phased delivery: core tracking + project catalog (Phase 1) → approvals + locking (Phase 2) → policy enforcement + billing (Phase 3).
- Support manual entry and timer-based tracking with multi-channel capture and break handling; policy enforcement is deferred.
- Provide a fast monthly time entry UI for employees ("My Timesheets"), a project management UI for admins, and two Phase 1 dashboard widgets.

**Scope:**
- Phase 1: Time entries (create/edit/delete), timer actions, break handling, project catalog, employee assignment (no rates), "My Timesheets" monthly grid UI, basic reporting, and two dashboard widgets (Timer + Hours by Project Summary).
- Phase 2: Approval workflow and period locking, using existing `staff_team_members` and `user_id` links to system users.
- Phase 3: Policy enforcement, billing/export integrations, utilization analytics.

**Concerns (if any):**
- FK targets for employees must reference `staff_team_members` (staff module), not the `directory` module.
- Do not introduce a duplicate employee identity model; reuse `staff_team_members` + `user_id`.
- Locking semantics must be consistent across UI, API, and data model.
- `status` on `TimeEntry` is Phase 2 only — added via migration, not present in Phase 1 schema.

---

## Overview

Add first-class timesheets for employees to record work hours. This `staff`-module extension supports manual entry and timer-based tracking, with phased expansion into project structure, approvals/locking, and downstream billing/analytics.

> **Market Reference**: Personio timesheets and Odoo Timesheets. Adopted: multi-channel capture (web/mobile/shared device), break handling, monthly grid UI. Rejected/Deferred: payroll integration until Phase 3+.

---

## Problem Statement

Tracking hours against projects and accounts is core to every business, but Open Mercato lacks a structured, auditable timesheets system connecting employee work to project and account records. This creates gaps in operational visibility, billing accuracy, and utilization reporting.

---

## Proposed Solution

Extend the existing `staff` module with a `timesheets` domain:
- Time entries linked to projects, stored as first-class entities.
- Manual entry and timer-based tracking with work/break segments.
- Multi-channel capture (web, mobile, shared device/kiosk) with optional location capture.
- Billable vs non-billable configured per project by admins is deferred to Phase 3; employees do not set it per entry.
- Employee assignment per project; rates and cost calculations deferred to Phase 3.
- Report views by employee, project, and date range.
- Dashboard widgets in Phase 1:
  - Quick Timer widget: start/stop timer for a selected project/task context from dashboard.
  - Hours by Project Summary widget: grouped hours by project for a selected period using the same date-range selector behavior as the AOV widget.
- Policy-driven controls are in scope but deferred; Phase 1 has no enforcement.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Monthly grid UI for employee entry | Fast scanning and bulk entry across many projects/days. |
| `duration_minutes` stored as integer | Avoids float precision issues; UI converts to/from decimal hours. |
| `started_at`/`ended_at` on `TimeEntry` = outer timer boundary | Segments track work/break sub-periods within a session; entry holds the overall window. |
| Defer rate history to Phase 3 | Avoids billing/cost semantics in Phase 1. |
| Reuse `staff_team_members` + `user_id` link | Avoids duplicate employee identity and aligns with existing staff architecture. |
| `status` on `TimeEntry` deferred to Phase 2 | Avoids unused schema column in Phase 1; added via backward-compatible migration. |
| Phase approvals and locking in Phase 2 | Enables governance while keeping Phase 1 focused on capture. |
| Dashboard widgets reuse existing APIs | No dedicated widget backend endpoints in Phase 1; widgets call existing `/api/staff/timesheets/*` and `/api/dashboards/widgets/data`. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Per-entry billable flag | Inconsistent billing attribution; project-level config is simpler and less error-prone. |
| Store duration as decimal hours | Float precision issues at scale; integer minutes is canonical. |
| Standalone `timesheets` module | Adds unnecessary module surface and duplicates identity linkage already present in `staff`. |

---

## User Stories / Use Cases

1. As an **employee**, I can log hours by project each day so my time is accurate and auditable.
2. As an **employee**, I can start/stop a timer that auto-fills duration so I don't have to calculate manually.
3. As an **admin**, I can manage projects and assign employees.
4. As a **manager**, I can review and approve monthly time for my reportees (Phase 2).
5. As **finance**, I can rely on locked time periods for consistent reporting (Phase 2+).
6. As an **employee**, I can use a dashboard time-reporting widget to quickly start/stop a timer for the task I am currently working on.
7. As an **employee**, I can use a dashboard summary widget to see how many hours I tracked per project for a selected timeframe.

---

## Architecture

Extension of existing module: `staff` in `packages/core/src/modules/staff/`.

- Store timesheet entities in `staff` module tables (`staff_time_*`); use FK IDs only for cross-module references.
- Employee references use `staff_member_id` → `staff_team_members.id`.
- Current user identity resolution reuses existing link `staff_team_members.user_id` → authenticated system user.
- Customer/deal/order references use FK IDs → respective tables in `customers`/`sales` modules.
- Do not add a separate employee identity or reporting-line entity for Phase 1/2.
- Emit events for all mutations to drive downstream integrations.
- All queries scoped by `organization_id` and `tenant_id`.

**Module ownership**: No new module registration. Timesheets are implemented as a domain within `staff`.

### Required Module Files

| File | Purpose |
|------|---------|
| `acl.ts` | Extend feature definitions with `staff.timesheets.*` |
| `setup.ts` | Extend `defaultRoleFeatures` for timesheets permissions |
| `data/entities.ts` | Add timesheets entities (`TimeEntry`, `TimeEntrySegment`, `TimeProject`, `TimeProjectMember`, `TimePeriod`) |
| `data/validators.ts` | Add Zod schemas for timesheets inputs |
| `api/openapi.ts` | Reuse `createStaffCrudOpenApi` for timesheets route docs |
| `api/timesheets/*` | New timesheets API routes under `/api/staff/timesheets/*` |
| `events/timesheets.ts` | Typed timesheets event declarations via `createModuleEvents` |
| `commands/timesheets-*.ts` | New undoable command handlers for entries/projects/periods |
| `commands/index.ts` | Register new timesheets command modules |
| `backend/staff/timesheets/*` | New staff backend pages for My Timesheets, Projects, and Approvals |
| `widgets/dashboard/timesheets-*/*` | Dashboard widgets for quick timer and hours summary |
| `analytics.ts` | Register timesheets analytics entity mapping for `/api/dashboards/widgets/data` summary |
| `dashboards/api/widgets/data/route.ts` | Enforce self-scope for timesheets summary widget when caller lacks `manage_all` |
| `search.ts` | Extend staff search with timesheets project indexing |
| `i18n/en.json` | Add `staff.timesheets.*` locale keys |

### Commands & Events

#### Phase 1 Commands

| Command | Undoable | Side Effects (reversible?) | Notes |
|---------|----------|---------------------------|-------|
| `staff.timesheets.time_entry.create` | Yes — undo = soft delete | Event `created` (ephemeral — no undo needed), cache invalidation | |
| `staff.timesheets.time_entry.update` | Yes — undo = restore `before` snapshot | Event `updated` (ephemeral), cache invalidation | duration, notes, project, customer |
| `staff.timesheets.time_entry.delete` | Yes — undo = restore `deleted_at = null` + fields | Event `deleted` (ephemeral), cache invalidation | |
| `staff.timesheets.time_entry.timer_start` | No | Event `timer_started` (ephemeral); creates initial `work` segment | Real-time capture; undo would corrupt audit trail |
| `staff.timesheets.time_entry.timer_stop` | No | Event `timer_stopped` (ephemeral); closes active segment, recalculates `duration_minutes` | Calculates `duration_minutes` from work segment durations |
| `staff.timesheets.time_entry.add_segment` | Yes — undo = delete segment | Cache invalidation | |
| `staff.timesheets.time_project.create` | Yes — undo = soft delete | Event `created` (ephemeral), search reindex, cache invalidation | |
| `staff.timesheets.time_project.update` | Yes — undo = restore `before` snapshot | Event `updated` (ephemeral), search reindex, cache invalidation | |
| `staff.timesheets.time_project.delete` | Yes — undo = restore `deleted_at = null` + fields | Event `deleted` (ephemeral), search reindex, cache invalidation | |
| `staff.timesheets.time_project_member.assign` | Yes — undo = soft delete assignment | Cache invalidation (project employee list) | |
| `staff.timesheets.time_project_member.unassign` | Yes — undo = restore assignment | Cache invalidation (project employee list) | |

Dashboard widgets in Phase 1 do not introduce new commands/events; they orchestrate existing `time_entry.*` and `time_project.*` contracts.

#### Phase 2 Commands (Approvals)

| Command | Undoable | Side Effects (reversible?) | Notes |
|---------|----------|---------------------------|-------|
| `staff.timesheets.time_period.submit` | Yes — undo = revert to `open` | Event `submitted` (persistent — notification to manager); notification is not retracted on undo | |
| `staff.timesheets.time_period.approve` | Yes — undo = revert to `submitted` | Event `approved` (persistent — notification to employee); notification is not retracted on undo | Emits notification to employee |
| `staff.timesheets.time_period.reject` | Yes — undo = revert to `submitted` | Event `rejected` (persistent — notification to employee) | Requires rejection reason |
| `staff.timesheets.time_period.lock` | No | Event `locked` (persistent) | Finance-only; intentionally irreversible |

#### Phase 1 Events

```
staff.timesheets.time_entry.created
staff.timesheets.time_entry.updated
staff.timesheets.time_entry.deleted
staff.timesheets.time_entry.timer_started
staff.timesheets.time_entry.timer_stopped
staff.timesheets.time_project.created
staff.timesheets.time_project.updated
staff.timesheets.time_project.deleted
```

#### Phase 2 Events

```
staff.timesheets.time_period.submitted
staff.timesheets.time_period.approved
staff.timesheets.time_period.rejected
staff.timesheets.time_period.locked
```

### Access Control (`acl.ts`)

```typescript
export const features = [
  { id: 'staff.timesheets.view',             title: 'View own time entries',          module: 'staff' },
  { id: 'staff.timesheets.manage_own',       title: 'Create/edit/delete own entries', module: 'staff' },
  { id: 'staff.timesheets.manage_all',       title: 'Manage all employees entries',   module: 'staff' },
  { id: 'staff.timesheets.projects.view',    title: 'View time projects',             module: 'staff' },
  { id: 'staff.timesheets.projects.manage',  title: 'Manage time projects',           module: 'staff' },
  { id: 'staff.timesheets.approve',          title: 'Approve reportee time (Phase 2)', module: 'staff' },
  { id: 'staff.timesheets.lock',             title: 'Lock time periods (Phase 2)',    module: 'staff' },
]
```

### Setup (`setup.ts`) defaultRoleFeatures

```typescript
defaultRoleFeatures: {
  superadmin: ['staff.timesheets.*'],
  admin:      ['staff.timesheets.*'],
  employee:   ['staff.timesheets.view', 'staff.timesheets.manage_own', 'staff.timesheets.projects.view'],
}
```

---

## Data Models

### TimeEntry

Fields present in Phase 1 schema. `status` is added in Phase 2 via migration (see Migration & Compatibility section).

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK, required for tenant scoping |
| `tenant_id` | UUID | FK |
| `staff_member_id` | UUID | FK → `staff_team_members.id` |
| `date` | text (YYYY-MM-DD) | The calendar day of the entry |
| `duration_minutes` | integer | Stored as integer minutes; UI converts to/from decimal hours |
| `started_at` | timestamptz \| null | Outer timer session start (set on `timer_start`) |
| `ended_at` | timestamptz \| null | Outer timer session end (set on `timer_stop`) |
| `notes` | text \| null | |
| `time_project_id` | UUID \| null | FK → `staff_time_projects.id` |
| `customer_id` | UUID \| null | FK → `customer_entities.id` (customers module) |
| `deal_id` | UUID \| null | FK → `customer_deals.id` (customers module) |
| `order_id` | UUID \| null | FK → `sales_orders.id` (sales module) |
| `source` | text enum | `manual` \| `timer` \| `kiosk` \| `mobile` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz \| null | Soft delete |

**Phase 2 addition** (via migration, NOT in Phase 1 schema):

| Field | Type | Notes |
|-------|------|-------|
| `status` | text enum | `draft` \| `submitted` \| `approved` \| `rejected` \| `locked` |

**Timer / segment relationship**: `started_at`/`ended_at` on `TimeEntry` represent the outer timer session boundary (when the global timer starts and stops). `TimeEntrySegment` records individual work and break sub-periods within that session. `duration_minutes` is recalculated as the sum of all `work` segment durations when a timer stops. For manual entries, `started_at`, `ended_at`, and segments are all null.

---

### TimeEntrySegment

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK |
| `tenant_id` | UUID | FK |
| `time_entry_id` | UUID | FK → `staff_time_entries.id` |
| `started_at` | timestamptz | Segment start |
| `ended_at` | timestamptz \| null | Null while segment is active |
| `segment_type` | text enum | `work` \| `break` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz \| null | |

---

### TimeProject

Phase 1 schema excludes billing fields; `billing_mode` and `default_currency` are added in Phase 3 via migration.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK |
| `tenant_id` | UUID | FK |
| `name` | text | |
| `customer_id` | UUID | FK → `customer_entities.id` (customers module) |
| `code` | text | Unique within `(organization_id, tenant_id)` scope |
| `description` | text \| null | Free-text project description |
| `project_type` | text \| null | e.g. `client`, `internal`, `research` — free-text or dictionary-driven |
| `status` | text enum | `active` \| `on_hold` \| `completed`; default `active`. Replaces boolean `is_active` to support richer lifecycle states. |
| `billing_mode` | text enum | Phase 3: `billable` \| `non_billable` |
| `default_currency` | text \| null | Phase 3: ISO 4217 currency code |
| `owner_user_id` | UUID \| null | FK → `users.id` |
| `cost_center` | text \| null | |
| `start_date` | date (YYYY-MM-DD) \| null | Project start date |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz \| null | |

---

### TimeProjectMember

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK |
| `tenant_id` | UUID | FK |
| `time_project_id` | UUID | FK → `staff_time_projects.id` |
| `staff_member_id` | UUID | FK → `staff_team_members.id` |
| `role` | text \| null | Role on the project |
| `status` | text enum | `active` \| `inactive` |
| `assigned_start_date` | date (YYYY-MM-DD) | |
| `assigned_end_date` | date \| null | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz \| null | |

---

### TimePeriod (Phase 2)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK |
| `organization_id` | UUID | FK |
| `tenant_id` | UUID | FK |
| `staff_member_id` | UUID | FK → `staff_team_members.id` |
| `month` | text (YYYY-MM) | Calendar month |
| `status` | text enum | `open` \| `submitted` \| `approved` \| `rejected` \| `locked` |
| `approved_by_user_id` | UUID \| null | FK → `users.id` |
| `approved_at` | timestamptz \| null | |
| `locked_at` | timestamptz \| null | |
| `rejection_reason` | text \| null | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz \| null | |

**Approval scope resolution (Phase 2)**:
- Resolve employee context via existing `staff_team_members.user_id` mapping for the authenticated user.
- Resolve manager scope through existing staff permissions/team visibility (no new reporting-line table in Phase 1/2).

---

## API Contracts

Timesheets routes under `/api/staff/timesheets/*` MUST export an `openApi` object using `createStaffCrudOpenApi` from `api/openapi.ts`. Staff list endpoints use `page` + `pageSize` pagination (`pageSize` ≤ 100). Duration is accepted and returned in **minutes** (`duration_minutes`); the UI converts to/from decimal hours client-side.

Exception: dashboard summary widget aggregation reuses `/api/dashboards/widgets/data` and follows dashboards API/OpenAPI conventions.

### Time Entries

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `GET` | `/api/staff/timesheets/time-entries` | Required | `staff.timesheets.view` (own) or `staff.timesheets.manage_all` |
| `POST` | `/api/staff/timesheets/time-entries` | Required | `staff.timesheets.manage_own` |
| `POST` | `/api/staff/timesheets/time-entries/bulk` | Required | `staff.timesheets.manage_own` |
| `PATCH` | `/api/staff/timesheets/time-entries/{id}` | Required | `staff.timesheets.manage_own` |
| `DELETE` | `/api/staff/timesheets/time-entries/{id}` | Required | `staff.timesheets.manage_own` |
| `POST` | `/api/staff/timesheets/time-entries/{id}/timer-start` | Required | `staff.timesheets.manage_own` |
| `POST` | `/api/staff/timesheets/time-entries/{id}/timer-stop` | Required | `staff.timesheets.manage_own` |

#### Timer Behavior

**`timer-start`**: Sets `started_at = now()` on the `TimeEntry` and creates an initial `TimeEntrySegment` with `segment_type = 'work'`, `started_at = now()`, `ended_at = null`. If the entry already has `started_at` set, returns 409 Conflict. Sets `source = 'timer'` on the entry.

**`timer-stop`**: Sets `ended_at = now()` on the active `TimeEntrySegment` (where `ended_at IS NULL`). Sets `ended_at = now()` on the `TimeEntry`. Recalculates `duration_minutes` as the sum of all `work`-type segment durations (in minutes, rounded to nearest integer). If no active segment exists, returns 409 Conflict.

**GET query params**: `staffMemberId`, `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `projectId`, `page`, `pageSize`

### Time Entry Segments

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `POST` | `/api/staff/timesheets/time-entries/{id}/segments` | Required | `staff.timesheets.manage_own` |
| `PATCH` | `/api/staff/timesheets/time-entries/{id}/segments/{segmentId}` | Required | `staff.timesheets.manage_own` |

#### Bulk Save — `POST /api/staff/timesheets/time-entries/bulk`

The "My Timesheets" monthly grid uses a single bulk save endpoint to persist all changed cells in one atomic request. This avoids N individual PATCH requests and ensures all-or-nothing semantics via `withAtomicFlush({ transaction: true })`.

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `POST` | `/api/staff/timesheets/time-entries/bulk` | Required | `staff.timesheets.manage_own` |

**Request body**:
```json
{
  "entries": [
    {
      "id": "uuid|null",
      "date": "2026-02-20",
      "timeProjectId": "uuid",
      "durationMinutes": 480,
      "notes": "string|null"
    }
  ]
}
```

- `id = null` → create new entry; `id = uuid` → update existing entry.
- `durationMinutes = 0` on an existing entry → soft delete.
- Max batch size: **200 entries** (≈ 31 days × 6 projects). Returns 400 if exceeded.
- All entries in the batch must belong to the same `staffMemberId` (inferred from session).

**Response (success)**:
```json
{ "ok": true, "created": 3, "updated": 12, "deleted": 1 }
```

**Response (partial failure — 422)**:
```json
{
  "ok": false,
  "errors": [
    { "index": 2, "field": "durationMinutes", "message": "Must be >= 0" }
  ]
}
```

On any validation error, the entire batch is rolled back (atomic transaction).

**POST request body** (single entry):
```json
{
  "staffMemberId": "uuid",
  "date": "2026-02-20",
  "durationMinutes": 480,
  "timeProjectId": "uuid|null",
  "customerId": "uuid|null",
  "dealId": "uuid|null",
  "notes": "string|null",
  "source": "manual"
}
```

### Time Projects

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `GET` | `/api/staff/timesheets/time-projects` | Required | `staff.timesheets.projects.view` |
| `POST` | `/api/staff/timesheets/time-projects` | Required | `staff.timesheets.projects.manage` |
| `PATCH` | `/api/staff/timesheets/time-projects/{id}` | Required | `staff.timesheets.projects.manage` |
| `DELETE` | `/api/staff/timesheets/time-projects/{id}` | Required | `staff.timesheets.projects.manage` |

**GET query params**: `projectType` (optional free-text filter), `status` (`active` | `on_hold` | `completed`), `customerId`, `q` (fulltext search over project fields), `page`, `pageSize`

**Create/Update fields**: `name`, `customerId` (required), `projectType`, `status`, `startDate`, `description`, `code`

### Project Employee Assignments

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `GET` | `/api/staff/timesheets/time-projects/{id}/employees` | Required | `staff.timesheets.projects.view` |
| `POST` | `/api/staff/timesheets/time-projects/{id}/employees` | Required | `staff.timesheets.projects.manage` |
| `PATCH` | `/api/staff/timesheets/time-projects/{id}/employees/{staffMemberId}` | Required | `staff.timesheets.projects.manage` |
| `DELETE` | `/api/staff/timesheets/time-projects/{id}/employees/{staffMemberId}` | Required | `staff.timesheets.projects.manage` |

### Dashboard Widgets (Phase 1, Reuse Existing APIs)

No dedicated widget-specific endpoints are added in Phase 1:
- Timer widget reuses existing `/api/staff/timesheets/*` endpoints.
- Summary widget reuses existing `/api/dashboards/widgets/data` endpoint.

| Widget action | Method | Path | Notes |
|---------------|--------|------|-------|
| Load candidate projects | `GET` | `/api/staff/timesheets/time-projects` | Populate project/task picker in Timer widget |
| Load current-day running entry | `GET` | `/api/staff/timesheets/time-entries?from=YYYY-MM-DD&to=YYYY-MM-DD` | Detect active timer (`started_at != null && ended_at == null`) |
| Start timer from widget | `POST` + `POST` | `/api/staff/timesheets/time-entries` then `/api/staff/timesheets/time-entries/{id}/timer-start` | Create timer-sourced entry first, then start |
| Stop timer from widget | `POST` | `/api/staff/timesheets/time-entries/{id}/timer-stop` | Uses existing timer-stop behavior |
| Load summary data | `POST` | `/api/dashboards/widgets/data` | Same endpoint used by AOV widget |

Date-range presets for summary widget MUST match AOV widget behavior (`today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_year`, `last_7_days`, `last_30_days`, `last_90_days`) and be passed as `dateRange.preset` to `/api/dashboards/widgets/data`.

Summary widget request contract (`/api/dashboards/widgets/data`):
- `entityType = "staff:staff_time_entries"`
- `metric = { "field": "durationMinutes", "aggregate": "sum" }`
- `groupBy = { "field": "timeProjectId", "limit": 20, "resolveLabels": true }`
- `dateRange = { "field": "date", "preset": "<AOV preset>" }`

Security rule for summary widget calls:
- If caller lacks `staff.timesheets.manage_all`, backend MUST enforce current-user scope by injecting/overwriting `staffMemberId = <resolved current staff member>`.
- This enforcement is implemented in existing dashboard widget data endpoint handling (no new endpoint).

### Approvals (Phase 2)

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `GET` | `/api/staff/timesheets/time-periods` | Required | `staff.timesheets.view` |
| `POST` | `/api/staff/timesheets/time-periods/{id}/submit` | Required | `staff.timesheets.manage_own` |
| `POST` | `/api/staff/timesheets/time-periods/{id}/approve` | Required | `staff.timesheets.approve` |
| `POST` | `/api/staff/timesheets/time-periods/{id}/reject` | Required | `staff.timesheets.approve` |
| `POST` | `/api/staff/timesheets/time-periods/{id}/lock` | Required | `staff.timesheets.lock` |
| `PATCH` | `/api/staff/timesheets/time-periods/{id}` | Required | `staff.timesheets.approve` |

---

## Internationalization (i18n)

All user-facing strings MUST use locale keys. Locale file: `i18n/en.json` under the `staff.timesheets` namespace.

| Key | Default value |
|-----|---------------|
| `staff.timesheets.my_timesheets.title` | My Timesheets |
| `staff.timesheets.my_timesheets.month_locked` | This month is closed. Time entries cannot be modified. |
| `staff.timesheets.my_timesheets.month_approved` | Your time entries have been approved and are locked for editing. |
| `staff.timesheets.my_timesheets.save_changes` | Save Changes |
| `staff.timesheets.my_timesheets.confirm_save.title` | Confirm Changes |
| `staff.timesheets.my_timesheets.confirm_save.body` | Are you sure you want to save your timesheet changes? |
| `staff.timesheets.my_timesheets.confirm_save.cancel` | Cancel |
| `staff.timesheets.my_timesheets.confirm_save.confirm` | Yes, Save |
| `staff.timesheets.my_timesheets.export` | Export |
| `staff.timesheets.my_timesheets.total_hours` | Total Hours |
| `staff.timesheets.my_timesheets.working_days` | Working Days |
| `staff.timesheets.my_timesheets.daily_average` | Daily Average |
| `staff.timesheets.projects.title` | Projects |
| `staff.timesheets.projects.subtitle` | Manage all projects, assignments, and configurations |
| `staff.timesheets.projects.add` | Add Project |
| `staff.timesheets.projects.total` | Total Projects |
| `staff.timesheets.projects.active` | Active Projects |
| `staff.timesheets.projects.on_hold` | On Hold Projects |
| `staff.timesheets.projects.total_employees` | Unique Employees |
| `staff.timesheets.projects.add_employee` | Add Employee |
| `staff.timesheets.projects.active_employees` | Active Employees |
| `staff.timesheets.projects.inactive_employees` | Inactive Employees |
| `staff.timesheets.projects.filter_customer` | Customer |
| `staff.timesheets.approvals.title` | Team Approvals |
| `staff.timesheets.approvals.subtitle` | Review and approve reportee time for the month |
| `staff.timesheets.approvals.approve` | Approve Month |
| `staff.timesheets.approvals.reject` | Reject with Reason |
| `staff.timesheets.widgets.timer.title` | Time Reporting |
| `staff.timesheets.widgets.timer.start` | Start Timer |
| `staff.timesheets.widgets.timer.stop` | Stop Timer |
| `staff.timesheets.widgets.timer.select_project` | Select Project |
| `staff.timesheets.widgets.timer.task_placeholder` | What are you working on? |
| `staff.timesheets.widgets.summary.title` | Hours by Project |
| `staff.timesheets.widgets.summary.empty` | No tracked hours in selected period |
| `staff.timesheets.nav.my_timesheets` | My Timesheets |
| `staff.timesheets.nav.projects` | Projects |
| `staff.timesheets.nav.approvals` | Team Approvals |

---

## UI/UX

### Sidebar Placement (Employees Group)

- `My Timesheets` and `Projects` are placed under the existing **Employees** left-sidebar group (`staff.nav.group`), alongside current items such as Teams, Team members, Team roles, Leave requests, My leave requests, and My availability.
- Visual style must match existing Employees navigation (icon size, spacing, typography, hover/active states).
- Suggested order in Employees group:
  - Teams
  - Team members
  - Team roles
  - Leave requests
  - My leave requests
  - My availability
  - My Timesheets
  - Projects
  - Team Approvals (Phase 2 only, manager-visible)
- Route mapping:
  - My Timesheets: `/backend/staff/timesheets`
  - Projects: `/backend/staff/timesheets/projects`
  - Team Approvals (Phase 2): `/backend/staff/timesheets/approvals`

### "My Timesheets" Tab (Employee Time Entry)

- **Header**: "My Timesheets", month navigator (prev/next), actions: `Export`, `Save Changes` (Phase 2: disabled when locked/approved).
- **Summary Cards (4)**: Total Hours, Working Days, Daily Average, Status badges (Month: Open/Closed; Approval: Approved/Pending/Rejected).
- **Info Banner (Phase 2)**: Warning when month is locked:
  - "This month is closed. Time entries cannot be modified."
  - "Your time entries have been approved and are locked for editing."
- **Time Entry Table** (monthly grid):
  - Left sticky project column: color dot, project name, project code.
  - Day columns with weekday + date header; weekends grayed and disabled.
  - Right sticky totals per project.
  - Bottom "Daily Total" row with per-day totals.
- **Input Behavior**:
  - Decimal hour inputs (e.g., `0.5`, `7.5`) converted to minutes before save (`hours × 60`, rounded to nearest integer).
  - Placeholder `0`; weekend cells show `-`.
  - Entered values appear bold.
  - Real-time recalculation of row/column totals and summary cards.
  - Clicking `Save Changes` opens a confirmation dialog first.
  - Save confirmation uses existing shared confirmation pattern (`ConfirmDialog` / native dialog migration pattern from UI specs), not a custom modal implementation.
  - On confirm, save shows success toast; Phase 2 disables edits when approved/closed.
- **Locking Rules**:
  - Open: editable.
  - Approved by PM: read-only.
  - Closed by Finance: read-only.

### Phase 1 ASCII Mockups

These are low-fidelity layout references only. Final implementation MUST reuse existing Open Mercato UI primitives and layout patterns (cards, badges, DataTable/list patterns, date-range controls, dialog patterns, and dashboard widget chrome) rather than introducing bespoke styling.

#### Mockup 1 — My Timesheets

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ My Timesheets                                      [ < Feb 2026 > ]              [Export] [Save Changes]    │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Total Hours: 132.5]   [Working Days: 18]   [Daily Avg: 7.4]   [Month: Open] [Approval: Pending]         │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Project (sticky)            | Mon 1 | Tue 2 | Wed 3 | Thu 4 | Fri 5 | Sat 6 | Sun 7 | ... | Row Total    │
├─────────────────────────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────┼──────────────┤
│ ● E-Commerce Redesign       |  7.5  |  8.0  |  6.0  |  8.0  |  7.0  |   -   |   -   | ... |    82.5      │
│   ECP-2024                  |       |       |       |       |       |       |       |     |              │
│ ● Mobile App                |  0.5  |  0.0  |  2.0  |  0.0  |  1.5  |   -   |   -   | ... |    18.0      │
│   APP-118                   |       |       |       |       |       |       |       |     |              │
│ ● Internal Ops              |  0.0  |  1.0  |  0.0  |  0.0  |  0.5  |   -   |   -   | ... |    32.0      │
│   OPS-001                   |       |       |       |       |       |       |       |     |              │
├─────────────────────────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┼─────┼──────────────┤
│ Daily Total (sticky)        |  8.0  |  9.0  |  8.0  |  8.0  |  9.0  |   -   |   -   | ... |   132.5      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Mockup 1a — Save Confirmation

```text
┌──────────────────────────────────────────────────────────┐
│ Confirm Changes                                          │
├──────────────────────────────────────────────────────────┤
│ Are you sure you want to save your timesheet changes?   │
│ This will update logged hours for the selected month.    │
│                                                          │
│                                  [Cancel] [Yes, Save]   │
└──────────────────────────────────────────────────────────┘
```

#### Mockup 2 — Projects

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Projects                                                                                 [ + Add Project ] │
│ Manage all projects, assignments, and configurations                                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Total: 12] [Active: 8] [Unique Employees: 37] [On Hold: 2]                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ Search project / code / customer .................................................... ] [Customer ▾]      │
│ [All (12)] [Active (8)] [On Hold (2)] [Completed (2)]                                                         │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ E-Commerce Redesign                    [Active]                                           [View Details →]    │
│ Customer: Acme Corp   Start: Jan 2026   Employees: 8   Project ID: ECP-2024                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Mobile App Launch                      [On Hold]                                          [View Details →]    │
│ Customer: Beta SA     Start: Nov 2025   Employees: 5   Project ID: APP-118                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Mockup 3 — Dashboard Widget: Time Reporting

```text
┌───────────────────────────────────────────────┐
│ Time Reporting                                │
├───────────────────────────────────────────────┤
│ Project                                       │
│ [ E-Commerce Redesign (ECP-2024)        ▾ ]  │
│ Task / Note                                  │
│ [ Homepage estimation..................... ]  │
│                                               │
│ Status: Not running                           │
│ [ Start Timer ]                               │
└───────────────────────────────────────────────┘
```

#### Mockup 4 — Dashboard Widget: Hours by Project Summary

```text
┌───────────────────────────────────────────────┐
│ Hours by Project                 [This Month ▾]│
├───────────────────────────────────────────────┤
│ E-Commerce Redesign                82.5 h      │
│ ████████████████████████                       │
│                                               │
│ Internal Ops                      32.0 h       │
│ ███████████                                    │
│                                               │
│ Mobile App                        18.0 h       │
│ ██████                                         │
│                                               │
│ Total                             132.5 h      │
└───────────────────────────────────────────────┘
```

### Dashboard Widgets (Phase 1)

Widgets are available in the standard dashboard widget picker (same infrastructure as existing sales/analytics widgets).
Widget visibility/access requirements:
- Time Reporting widget: `dashboards.view` + `staff.timesheets.manage_own`.
- Hours by Project Summary widget: `dashboards.view` + `analytics.view` + `staff.timesheets.view`.

#### 1) Time Reporting Widget

- Purpose: quick start/stop timer for the current work item without opening the full "My Timesheets" page.
- Main controls:
  - Project selector (assigned projects only).
  - Optional task text input (stored in `TimeEntry.notes` in Phase 1).
  - `Start Timer` / `Stop Timer` primary action.
- Runtime behavior:
  - If no active timer exists today, `Start Timer` creates a timer entry and starts it.
  - If an active timer exists, widget shows running elapsed time and `Stop Timer`.
  - If a different timer is already running, widget blocks creating another concurrent running entry.
- Data source: existing timesheets endpoints only (no widget-specific API route).

#### 2) Hours by Project Summary Widget

- Purpose: show how many hours the current user tracked per project in a selected timeframe.
- Visual: compact list/bar summary sorted by total tracked hours descending.
- Timeframe control:
  - Uses the same date-range dropdown behavior/presets as the AOV widget.
  - Preset selection updates totals immediately.
- Data source:
  - Existing `/api/dashboards/widgets/data` endpoint (same as AOV widget).
  - Aggregation is backend-side via `sum(duration_minutes)` grouped by `timeProjectId` with label resolver.

### "Projects" Tab (Admin Project Management)

#### Screen 1: Projects List

- **Header**: "Projects" / "Manage all projects, assignments, and configurations". `Add Project` button (top-right).
- **Stats Cards (4)**: Total Projects, Active Projects, Unique Employees, On Hold Projects.
- **Filters**: Search bar (project name or code). Optional customer filter (typeahead → `customerId`). Status pills with counts: `All`, `Active`, `On Hold`, `Completed` (mapped to `TimeProject.status` enum: `active`, `on_hold`, `completed`).
- **Project Cards**: Name, status badge, project type label, customer, start date, employee count, code (monospace).
- **Empty State**: "No projects found" with folder icon.

#### Add Project Modal

Fields: Project Name, Customer, Project Type, Start Date, Description, Code (optional, auto-generate).
Actions: `Cancel`, `Create Project` (`Cmd/Ctrl+Enter` submit, `Escape` cancel).

#### Screen 2: Project Settings (Detail)

- **Header**: Back arrow, "Project Settings" subtitle, `Edit Project` button.
- **Project Information**: Name, customer, status badge, type, start date, description, code (monospace).
- **Summary Cards (2)**: Active Employees, Inactive Employees.
- **Assigned Employees** (collapsible cards):
  - Collapsed: employee name, role, status badge, assignment start date, expand toggle.
  - Expanded: assignment details (role, dates). Inactive employees dimmed.

#### Add Employee Modal

Fields: Select Employee (shows department), Role on Project, Assignment Start Date.
Actions: `Cancel`, `Add Employee`.

### "Team Approvals" Tab (Phase 2 — Manager)

#### Screen: Team Approvals

- **Header**: "Team Approvals" / "Review and approve reportee time for the month". Month navigator (prev/next).
- **Summary Cards (3)**: Pending Approvals, Approved, Rejected.
- **Filters**: Search by employee name or ID. Status pills: `All`, `Pending`, `Approved`, `Rejected`.
- **Reportee List**: Columns: Employee, Total Hours, Working Days, Status badge, Last Updated. Row action: `Review`.

#### Screen: Reportee Month Detail

- Back arrow, employee name, month label, status badge.
- Monthly Summary: Total Hours, Working Days, Daily Average, Notes count.
- Time Entry Grid: read-only "My Timesheets" monthly grid view for the employee.
- Actions: `Approve Month` (primary), `Reject with Reason` (secondary, requires comment).

#### Approval Rules

- Approval only available for open months.
- Approving locks the employee's month for editing.
- Rejection unlocks the month for edits and records the manager comment.

---

## Performance, Cache & Index Strategy

### Database Indexes

| Table | Index columns | Query pattern |
|-------|---------------|---------------|
| `staff_time_entries` | `(organization_id, staff_member_id, date)` | "My Timesheets" monthly grid |
| `staff_time_entries` | `(organization_id, time_project_id, date)` | Project time reports |
| `staff_time_project_members` | `(organization_id, time_project_id)` | Project employee listing |
| `staff_time_project_members` | `(organization_id, staff_member_id)` | Employee's assigned projects |
| `staff_time_periods` | `(organization_id, staff_member_id, month)` | Period status lookup (Phase 2) |

### Cache Strategy

| Endpoint | Strategy | TTL | Invalidated by |
|----------|----------|-----|----------------|
| "My Timesheets" monthly grid | Memory, tenant-scoped `(tenantId, staffMemberId, month)` | 1 min | Any write to `staff_time_entries` for that member/month |
| Projects list | Memory, tenant-scoped `(tenantId, organizationId)` | 5 min | Any write to `staff_time_projects` |
| Project employee list | Memory, key `(tenantId, projectId)` | 5 min | Any write to `staff_time_project_members` for that project |
| Dashboard Time Reporting widget | Reuses "My Timesheets" + projects caches | Same as source endpoints | Same as source endpoints |
| Dashboard Hours by Project widget | Reuses `widget-data` cache (`/api/dashboards/widgets/data`) | 2 min (dashboard default) | Any write to `staff_time_entries` |

All cache keys are tenant-scoped to prevent cross-tenant data leakage. Cache is resolved via DI (never raw Redis/SQLite).

### Cache Miss Behavior

On cache miss, each endpoint falls back to the standard query:
- **"My Timesheets" grid**: `findWithDecryption` on `staff_time_entries` filtered by `(organization_id, staff_member_id, date BETWEEN from AND to)`. Result is cached with the key above.
- **Projects list**: `findWithDecryption` on `staff_time_projects` filtered by `(organization_id, tenant_id)` with pagination. Cached per page.
- **Project employee list**: `findWithDecryption` on `staff_time_project_members` filtered by `(organization_id, time_project_id)`. Cached per project.

### Cache Invalidation Chains

Child entity mutations must invalidate parent caches:
- **Segment change** (`add_segment`, `timer_stop`) → invalidates `"My Timesheets" grid` cache for the affected member/month (tag: `staff:timesheets:my_timesheets:{staffMemberId}:{month}`)
- **Project employee assignment/unassignment** → invalidates both `project employee list` (tag: `staff:timesheets:project_members:{projectId}`) and `projects list` (tag: `staff:timesheets:projects:{organizationId}`)
- **Time entry create/update/delete** → invalidates `"My Timesheets" grid` cache (tag: `staff:timesheets:my_timesheets:{staffMemberId}:{month}`)
- **Any time entry write** (`create`, `update`, `delete`, `timer_start`, `timer_stop`, segment mutation) → invalidates dashboard aggregation tags `widget-data` + `widget-data:staff:staff_time_entries`

### N+1 Mitigation — "My Timesheets" Grid

The "My Timesheets" monthly grid is the highest-traffic read path. Expected query count for a single grid load (cache miss):
1. **1 query**: Fetch all `staff_time_entries` for the staff member within the date range (index: `organization_id, staff_member_id, date`)
2. **1 query**: Fetch all `staff_time_project_members` for the staff member (index: `organization_id, staff_member_id`) — to resolve assigned projects
3. **1 query**: Fetch all `staff_time_projects` by IDs from step 2 (batch `WHERE id IN (...)`)

**Total: 3 queries** (constant, not proportional to project/day count). Avoid per-cell or per-project queries. The grid is assembled client-side from these three result sets.

---

## Security Considerations

### Input Validation & Injection

- All API inputs are validated with Zod schemas (`data/validators.ts`). No raw SQL is constructed; all queries use MikroORM's query builder, which parameterizes inputs by default.
- `notes` fields on `TimeEntry` and `TimeEntrySegment` accept free-text. These are stored as plain text and rendered with proper escaping in the UI (React's default JSX escaping prevents XSS). No HTML/markdown rendering is applied to notes fields.
- `code` field on `TimeProject` is validated as alphanumeric + dashes only (Zod regex: `/^[a-zA-Z0-9-]+$/`).

### Sensitive Data

- No secrets, passwords, or PII beyond employee names are stored in timesheets entities.
- `notes` fields should not contain sensitive data; no encryption is applied (unlike customer contact fields).
- Project data is business-confidential but not encrypted; access is controlled via RBAC (`staff.timesheets.projects.view` / `staff.timesheets.projects.manage`).

### Authorization Boundaries

- Employees can only view/edit their own time entries (`staff_member_id` must match session user's staff member).
- `manage_all` feature is required to view/edit other employees' entries.
- Project management requires `staff.timesheets.projects.manage`.
- Summary widget (`/api/dashboards/widgets/data` with `staff:staff_time_entries`) enforces own-staff-member scope unless caller has `staff.timesheets.manage_all`.
- All queries enforce `organization_id` scoping to prevent cross-tenant access.

---

## Migration & Compatibility

### Phase 1

New tables only. No changes to existing tables. Zero-downtime deployment.

Tables created: `staff_time_entries`, `staff_time_entry_segments`, `staff_time_projects`, `staff_time_project_members`.

### Phase 2

**`ALTER TABLE staff_time_entries ADD COLUMN status text NOT NULL DEFAULT 'draft'`**

- Non-breaking: existing entries automatically receive `status = 'draft'`.
- No traffic interruption required; `NOT NULL DEFAULT` avoids row locking on large tables.
- After migration, no backfill needed — the default handles all existing rows.

**New table `staff_time_periods`** — no existing data affected.

---

## Phasing

- **Phase 1**: Core time entries, timer actions, break handling, project catalog, employee assignment, basic reporting, "My Timesheets" monthly grid UI, and dashboard widgets (Time Reporting + Hours by Project Summary). No approvals or policy enforcement; no rates or billing.
- **Phase 2**: Approval workflow and period locking, with manager scope resolved from existing `staff_team_members`/`user_id` linkage.
- **Phase 3**: Policy enforcement (tracking profiles, edit windows, overtime rules), billing/export integration, utilization analytics, payroll prep integration.

---

## Implementation Plan

### Phase 1: Core Tracking + Project Catalog + Dashboard Widgets

#### Step 1 — Staff Module Extension Scaffold
- Extend `acl.ts` with `staff.timesheets.*` feature flags.
- Extend `setup.ts` `defaultRoleFeatures` with timesheets permissions.
- Register new command modules in `commands/index.ts`.

#### Step 2 — Data Model & Migrations
- Define `TimeEntry`, `TimeEntrySegment`, `TimeProject`, `TimeProjectMember` entities in `data/entities.ts`
- Define Zod schemas in `data/validators.ts`
- Run `yarn db:generate` and verify migrations; run `yarn db:migrate`

#### Step 3 — Events & Commands
- Add timesheets events using `createModuleEvents` in a dedicated timesheets event file under `staff`.
- Implement `commands/timesheets-entries.ts` — create/update/delete with undo; timer_start/stop without undo.
- Implement `commands/timesheets-projects.ts` — create/update/delete + assign/unassign with undo.

#### Step 4 — API Routes
- Reuse existing `api/openapi.ts` (`createStaffCrudOpenApi`) for route docs.
- Implement `api/timesheets/time-entries/route.ts` (CRUD) with `openApi` export and `makeCrudRoute` + `indexer`.
- Implement `api/timesheets/time-entries/bulk/route.ts` — atomic batch save for "My Timesheets" grid; max 200 entries; uses `withAtomicFlush({ transaction: true })`.
- Implement timer routes: `api/timesheets/time-entries/[id]/timer-start/route.ts`, `timer-stop/route.ts`.
- Implement `api/timesheets/time-entries/[id]/segments/route.ts`.
- Implement `api/timesheets/time-entries/[id]/segments/[segmentId]/route.ts` for segment updates.
- Implement `api/timesheets/time-projects/route.ts` (CRUD) with `openApi` export.
- Implement `api/timesheets/time-projects/[id]/employees/route.ts`.

#### Step 5 — Search
- Extend `search.ts` with fulltext indexing for `TimeProject` (name, code, description).

**`search.ts` sketch**:
```typescript
import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'staff:staff_time_project',
      enabled: true,
      priority: 7,
      fieldPolicy: {
        searchable: ['name', 'code', 'description', 'project_type', 'cost_center'],
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return {
          title: String(ctx.record.name ?? ''),
          subtitle: [ctx.record.code, ctx.record.project_type].filter(Boolean).join(' · '),
          icon: 'clock',
          badge: t('staff.timesheets.projects.title', 'Projects'),
        }
      },
      resolveUrl: async (ctx) => `/backend/staff/timesheets/projects/${encodeURIComponent(String(ctx.record.id))}`,
    },
  ],
}

export default searchConfig
export const config = searchConfig
```

#### Step 6 — Backend UI: Projects Admin
- Implement `backend/staff/timesheets/projects/page.tsx` — Projects list with `DataTable`, stats cards, filters
- Implement `backend/staff/timesheets/projects/create/page.tsx` — Add Project page with `CrudForm`
- Implement `backend/staff/timesheets/projects/[id]/page.tsx` — Project Settings detail with employee assignments
- Add `page.meta.ts` for projects pages with `pageGroupKey: 'staff.nav.group'` and nav label key `staff.timesheets.nav.projects`

#### Step 7 — Backend UI: My Timesheets
- Implement `backend/staff/timesheets/page.tsx` — tabbed view with "My Timesheets" monthly grid
- Monthly grid component: project rows × day columns, decimal hour inputs, real-time totals, transactional bulk save
- Add `backend/staff/timesheets/page.meta.ts` with `pageGroupKey: 'staff.nav.group'` and nav label key `staff.timesheets.nav.my_timesheets`

#### Step 8 — Dashboard Widgets
- Implement `widgets/dashboard/timesheets-time-reporting/widget.ts` + `widget.client.tsx` (Start/Stop timer widget).
- Implement `widgets/dashboard/timesheets-hours-by-project/widget.ts` + `widget.client.tsx` (summary by project).
- Reuse existing endpoints only:
  - `time-entries` and timer routes for Start/Stop.
  - `/api/dashboards/widgets/data` for summary aggregation (AOV-style).
- Reuse existing design-system/pattern components:
  - `DateRangeSelect` / `InlineDateRangeSelect` for timeframe behavior (AOV parity).
  - Existing dashboard widget shell metadata conventions (`lazyDashboardWidget`, tags/category/features).
  - Existing confirmation dialog pattern for save confirmation (no custom modal implementation).
- Add/update `staff/analytics.ts` so `staff:staff_time_entries` supports `durationMinutes`, `date`, `timeProjectId`, and `staffMemberId` mapping (for secure self-scope filter enforcement).
- Update `dashboards/api/widgets/data/route.ts` to enforce `staffMemberId = current staff member` for summary calls when user lacks `staff.timesheets.manage_all`.
- Reuse the same date-range preset UI behavior used by AOV.

#### Step 9 — i18n
- Add all i18n keys to `i18n/en.json` under the `staff.timesheets` namespace.

### Phase 2: Approvals & Period Locking

#### Step 1 — Manager Scope Wiring
- Resolve current employee using existing `staff_team_members.user_id`.
- Resolve manager-visible reportees using existing staff-team visibility/permissions.
- Do not introduce a separate reporting-line table in this phase.

#### Step 2 — TimeEntry Status & TimePeriod
- Add `status` column to `staff_time_entries` via migration (`DEFAULT 'draft' NOT NULL`)
- Add `staff_time_periods` table; define `TimePeriod` entity and validators

#### Step 3 — Approval Commands & Events
- Implement `commands/timesheets-periods.ts` — submit/approve/reject (with undo); lock (no undo).
- Add Phase 2 events to the timesheets event registry.

#### Step 4 — Approval API Routes
- Implement `api/timesheets/time-periods/route.ts` and action sub-routes (submit, approve, reject, lock).

#### Step 5 — Backend UI: Team Approvals
- Implement `backend/staff/timesheets/approvals/page.tsx` — manager approval list
- Implement `backend/staff/timesheets/approvals/[staffMemberId]/page.tsx` — reportee month detail
- Add `backend/staff/timesheets/approvals/page.meta.ts` with `pageGroupKey: 'staff.nav.group'`, nav label key `staff.timesheets.nav.approvals`, and manager-only `requireFeatures`

### File Manifest (Phase 1)

| File | Action | Purpose |
|------|--------|---------|
| `src/modules/staff/acl.ts` | Modify | Add `staff.timesheets.*` features |
| `src/modules/staff/setup.ts` | Modify | Add timesheets role mappings |
| `src/modules/staff/data/entities.ts` | Modify | Add `TimeEntry`, `TimeEntrySegment`, `TimeProject`, `TimeProjectMember` |
| `src/modules/staff/data/validators.ts` | Modify | Add timesheets Zod schemas |
| `src/modules/staff/api/openapi.ts` | Modify | Reuse staff OpenAPI builder for timesheets |
| `src/modules/staff/events/timesheets.ts` | Create | Typed timesheets events |
| `src/modules/staff/api/timesheets/time-entries/route.ts` | Create | Time entry CRUD |
| `src/modules/staff/api/timesheets/time-entries/bulk/route.ts` | Create | Bulk save (My Timesheets grid) |
| `src/modules/staff/api/timesheets/time-entries/[id]/timer-start/route.ts` | Create | Timer start |
| `src/modules/staff/api/timesheets/time-entries/[id]/timer-stop/route.ts` | Create | Timer stop |
| `src/modules/staff/api/timesheets/time-entries/[id]/segments/route.ts` | Create | Segments CRUD |
| `src/modules/staff/api/timesheets/time-entries/[id]/segments/[segmentId]/route.ts` | Create | Segment update |
| `src/modules/staff/api/timesheets/time-projects/route.ts` | Create | Project CRUD |
| `src/modules/staff/api/timesheets/time-projects/[id]/employees/route.ts` | Create | Employee assignment |
| `src/modules/staff/commands/timesheets-entries.ts` | Create | Time entry commands + undo |
| `src/modules/staff/commands/timesheets-projects.ts` | Create | Project commands + undo |
| `src/modules/staff/commands/index.ts` | Modify | Register timesheets command files |
| `src/modules/staff/backend/staff/timesheets/page.tsx` | Create | My Timesheets tab |
| `src/modules/staff/backend/staff/timesheets/page.meta.ts` | Create | Sidebar placement under Employees group |
| `src/modules/staff/backend/staff/timesheets/projects/page.tsx` | Create | Projects list |
| `src/modules/staff/backend/staff/timesheets/projects/page.meta.ts` | Create | Sidebar entry metadata for Projects |
| `src/modules/staff/backend/staff/timesheets/projects/create/page.tsx` | Create | Create project |
| `src/modules/staff/backend/staff/timesheets/projects/[id]/page.tsx` | Create | Project settings |
| `src/modules/staff/widgets/dashboard/timesheets-time-reporting/widget.ts` | Create | Dashboard widget metadata: quick timer |
| `src/modules/staff/widgets/dashboard/timesheets-time-reporting/widget.client.tsx` | Create | Dashboard widget UI: start/stop timer |
| `src/modules/staff/widgets/dashboard/timesheets-hours-by-project/widget.ts` | Create | Dashboard widget metadata: hours summary |
| `src/modules/staff/widgets/dashboard/timesheets-hours-by-project/widget.client.tsx` | Create | Dashboard widget UI: grouped hours by project |
| `src/modules/staff/backend/staff/timesheets/approvals/page.meta.ts` | Create | Sidebar entry metadata for Team Approvals (Phase 2) |
| `src/modules/staff/analytics.ts` | Create | Analytics mapping for summary widget via `/api/dashboards/widgets/data` |
| `src/modules/dashboards/api/widgets/data/route.ts` | Modify | Enforce self-scope for timesheets summary requests |
| `src/modules/staff/search.ts` | Modify | Add timesheets project search config |
| `src/modules/staff/i18n/en.json` | Modify | Add `staff.timesheets.*` labels |

---

## Integration Test Coverage

All integration tests MUST be self-contained: create fixtures via API in setup, clean up in teardown/finally.

### Phase 1 — API Coverage

| Test | Path | Scenario |
|------|------|----------|
| Create time entry | `POST /api/staff/timesheets/time-entries` | Valid entry created; duration stored in minutes |
| Update time entry | `PATCH /api/staff/timesheets/time-entries/{id}` | Duration and notes updated |
| Delete time entry | `DELETE /api/staff/timesheets/time-entries/{id}` | Soft-deleted; excluded from grid fetch |
| Get entries for month | `GET /api/staff/timesheets/time-entries?staffMemberId=&from=&to=` | Returns correct entries for date range |
| Timer start | `POST /api/staff/timesheets/time-entries/{id}/timer-start` | `started_at` set; `source = 'timer'` |
| Timer stop | `POST /api/staff/timesheets/time-entries/{id}/timer-stop` | `ended_at` set; `duration_minutes` calculated from work segments |
| Add segment | `POST /api/staff/timesheets/time-entries/{id}/segments` | Work segment created |
| Update segment | `PATCH /api/staff/timesheets/time-entries/{id}/segments/{segmentId}` | Segment timestamps updated and totals recalculated |
| Create project | `POST /api/staff/timesheets/time-projects` | Project created; appears in list |
| Assign employee | `POST /api/staff/timesheets/time-projects/{id}/employees` | Assignment created |
| Bulk save (create + update + delete) | `POST /api/staff/timesheets/time-entries/bulk` | Atomic batch: creates new, updates existing, soft-deletes zero-duration; all-or-nothing on validation error |
| Bulk save exceeds max batch size | `POST /api/staff/timesheets/time-entries/bulk` | Returns 400 when entries array exceeds 200 items |
| Tenant isolation | `GET /api/staff/timesheets/time-entries` | Returns only entries scoped to current organization |
| Dashboard timer start flow | `POST /api/staff/timesheets/time-entries` + `POST /api/staff/timesheets/time-entries/{id}/timer-start` | Widget can start timer without custom endpoint |
| Dashboard timer stop flow | `POST /api/staff/timesheets/time-entries/{id}/timer-stop` | Widget can stop active timer without custom endpoint |
| Dashboard summary data source | `POST /api/dashboards/widgets/data` | Returns grouped hours by project for selected preset range |
| Dashboard summary self-scope enforcement | `POST /api/dashboards/widgets/data` | Non-`manage_all` caller cannot query other `staffMemberId` values |

### Phase 1 — UI Coverage

| Test | Path | Scenario |
|------|------|----------|
| My Timesheets grid loads | `/backend/staff/timesheets` | Monthly grid renders with project rows and day columns |
| Decimal hour input saves | `/backend/staff/timesheets` | `7.5` saved as `450 minutes`; totals update in real time |
| Projects list | `/backend/staff/timesheets/projects` | Projects list loads with stats cards and filters |
| Time Reporting widget start/stop | `/backend` | User starts and stops timer from dashboard widget; state and elapsed time update |
| Hours by Project widget date-range switch | `/backend` | Switching preset (AOV-style selector) recalculates grouped totals |

### Phase 2 — API Coverage

| Test | Path | Scenario |
|------|------|----------|
| Submit period | `POST /api/staff/timesheets/time-periods/{id}/submit` | Status changes to `submitted` |
| Approve period | `POST /api/staff/timesheets/time-periods/{id}/approve` | Status `approved`; time entries become read-only |
| Reject period | `POST /api/staff/timesheets/time-periods/{id}/reject` | Status `rejected`; entries editable again |
| Lock period | `POST /api/staff/timesheets/time-periods/{id}/lock` | Status `locked`; irreversible |

### Phase 2 — UI Coverage

| Test | Path | Scenario |
|------|------|----------|
| Locked month is read-only | `/backend/staff/timesheets` | When month is approved, all inputs are disabled |

---

## Risks & Impact Review

### Data Integrity Failures

#### Inconsistent Locking (Phase 2)
- **Scenario**: UI shows locked month but API allows edits due to stale client state.
- **Severity**: High
- **Affected area**: API, UI, billing accuracy
- **Mitigation**: Enforce lock rules at API layer; UI reflects server state. Cache TTL ≤ 1 min limits stale window.
- **Residual risk**: Brief window where UI shows stale status after lock.

#### Partial Bulk Grid Save
- **Scenario**: Monthly grid bulk save partially fails, leaving mismatched entry totals.
- **Severity**: Medium
- **Affected area**: Time entry accuracy
- **Mitigation**: Use `withAtomicFlush` with `{ transaction: true }` for bulk save; return per-row error reporting in response.
- **Residual risk**: User may need manual retry on partial errors.

#### Duplicate Project Assignment
- **Scenario**: The same employee is assigned to the same project multiple times due to concurrent requests.
- **Severity**: Medium
- **Affected area**: Project staffing data and summary metrics
- **Mitigation**: Enforce unique assignment constraint on `(organization_id, tenant_id, time_project_id, staff_member_id)` and return 409 on conflict.
- **Residual risk**: Brief stale UI state until refetch.

#### Project Deletion With Existing Time Entries
- **Scenario**: A project is deleted while historical time entries still reference it.
- **Severity**: High
- **Affected area**: Historical reporting consistency
- **Mitigation**: Keep project deletion soft-only and preserve FK references from existing time entries.
- **Residual risk**: Report filters must explicitly handle soft-deleted projects.


#### Concurrent Approval Transitions (Phase 2)
- **Scenario**: Two managers concurrently approve/reject the same period, leading to conflicting state.
- **Severity**: High
- **Affected area**: Approval workflow, `staff_time_periods` status
- **Mitigation**: Use optimistic locking (check `updated_at` before status transition); return 409 on conflict.
- **Residual risk**: Users must retry on conflict; rare in practice.

### Cascading Failures & Side Effects

#### Timer Without Stop
- **Scenario**: User navigates away with an active timer; entry left with `started_at` set and no `ended_at`.
- **Severity**: Medium
- **Affected area**: Time entry accuracy, "My Timesheets" grid totals
- **Mitigation**: UI shows persistent "timer running" indicator. Background worker detects entries with `started_at` > 24h ago and no `ended_at`; marks them with a warning flag for user review.
- **Residual risk**: Duration underreported until user manually corrects.

#### Event Subscriber Failure
- **Scenario**: A persistent subscriber (e.g., approval notification) fails; event is retried.
- **Severity**: Low
- **Affected area**: Notifications
- **Mitigation**: Use persistent subscribers with retry; side effects must be idempotent.
- **Residual risk**: Duplicate notifications on retry if subscriber is not idempotent.

### Tenant & Data Isolation Risks

#### Cross-Tenant Data Leakage
- **Scenario**: Time entries reference customer data without organization scoping.
- **Severity**: High
- **Affected area**: Data isolation
- **Mitigation**: Enforce `organization_id` on all queries; use `findWithDecryption` with tenant context throughout.
- **Residual risk**: Misconfigured queries in new report endpoints.

### Migration & Deployment Risks

#### Phase 2 Status Column Migration
- **Scenario**: `ALTER TABLE staff_time_entries ADD COLUMN status` runs slowly on a large table.
- **Severity**: Medium
- **Affected area**: Phase 2 deployment
- **Mitigation**: `NOT NULL DEFAULT 'draft'` avoids per-row rewrite on PostgreSQL 11+. Run during low-traffic window. Migration is backward-compatible — Phase 1 code ignores the column.
- **Residual risk**: Brief metadata lock at migration start; negligible on modern PostgreSQL.

### Operational Risks


---

## Final Compliance Report — 2026-03-12 (Phase 1 Scope, Rerun 5)

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK IDs only; cross-module fetches via separate API calls |
| root AGENTS.md | Filter by `organization_id` | Compliant | All entities include `organization_id`; all queries scoped |
| root AGENTS.md | Modules: plural snake_case | Compliant | No new module introduced; implementation is scoped under existing `staff` module |
| root AGENTS.md | Event IDs: singular entity, past tense | Compliant | e.g. `staff.timesheets.time_entry.created` |
| root AGENTS.md | Feature naming: `<module>.<action>` | Compliant | e.g. `staff.timesheets.manage_own` |
| root AGENTS.md | Validate all inputs with Zod | Compliant | Validators declared in `data/validators.ts` |
| root AGENTS.md | Use `findWithDecryption` for queries | Compliant | Noted in architecture; enforced during implementation |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | i18n keys defined for all strings |
| root AGENTS.md | Every dialog: Cmd+Enter submit, Escape cancel | Compliant | Applied to Add Project and Add Employee modals; save confirmation uses shared dialog pattern |
| root AGENTS.md | `pageSize` ≤ 100 | Compliant | All list endpoints enforce this |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | `/api/staff/timesheets/*` routes use `createStaffCrudOpenApi`; summary widget uses existing `/api/dashboards/widgets/data` conventions |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` with `indexer` | Compliant | Noted in Implementation Plan |
| packages/core/AGENTS.md | Tables plural snake_case | Compliant | `staff_time_entries`, `staff_time_projects`, `staff_time_project_members`, etc. |
| packages/core/AGENTS.md | setup.ts: declare `defaultRoleFeatures` | Compliant | Defined in Architecture section |
| packages/core/AGENTS.md | Module files checklist complete | Compliant | All required files in File Manifest |
| packages/core/AGENTS.md | Use `withAtomicFlush` for multi-phase mutations | Compliant | Bulk save commands use `withAtomicFlush` |
| packages/ui/AGENTS.md | Use `CrudForm` for create/edit forms | Compliant | Specified in UI section |
| packages/ui/AGENTS.md | Use `DataTable` for list pages | Compliant | Specified in UI section |
| packages/ui/src/backend/AGENTS.md | Use `apiCall`/`apiCallOrThrow` | Compliant | Enforced via backend page pattern |
| packages/ui/src/backend/AGENTS.md | Use `LoadingMessage`/`ErrorMessage` | Compliant | Applied to all backend pages |
| packages/events/AGENTS.md | Use `createModuleEvents` for typed events | Compliant | Timesheets event registry uses `createModuleEvents` with `as const` |
| packages/events/AGENTS.md | Persistent subscribers for notifications/indexing | Compliant | Phase 2 approval subscribers use `persistent: true` |
| packages/cache/AGENTS.md | Tag-based invalidation, tenant-scoped keys, DI resolution | Compliant | Cache keys, invalidation chains, miss behavior, and DI resolution documented in Cache Strategy |
| packages/search/AGENTS.md | `search.ts` declares `searchConfig` | Compliant | Search sketch follows staff-module `entities[]`/`entityId` style with `fieldPolicy.searchable`, `formatResult`, `resolveUrl` |
| packages/shared/AGENTS.md | Use `useT`/`resolveTranslations` for i18n | Compliant | Noted in i18n section |
| .ai/specs/AGENTS.md | Integration coverage for all affected API paths | Compliant | Integration Test Coverage section covers all Phase 1+2 paths |
| .ai/specs/AGENTS.md | All required spec sections present | Compliant | All sections included |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Project `customer_id` mapped to create/update; bulk save endpoint for grid |
| API contracts match UI/UX section | Pass | UI actions mapped; customer filter supported via `customerId` |
| Widget API wording is consistent | Pass | Timer widget uses `/api/staff/timesheets/*`; summary widget uses `/api/dashboards/widgets/data` |
| Risks cover all write operations | Pass | All mutation commands have a corresponding risk entry |
| Commands defined for all mutations | Pass | Full command table with undo contracts for all entities |
| Cache strategy covers all read APIs | Pass | Cache table covers primary read endpoints; miss behavior, invalidation chains, and N+1 mitigation documented |
| i18n keys defined for all UI strings | Pass | i18n table covers all user-facing strings |
| FK targets reference correct tables | Pass | `staff_member_id` → `staff_team_members`; `owner_user_id` → `users` |
| Phase boundaries clean | Pass | `status` on `TimeEntry` explicitly deferred to Phase 2 migration |
| Phase plan consistency | Pass | Only Phase 1, Phase 2, and Phase 3 remain; no Phase 4 references in scope |
| Search design matches staff architecture | Pass | Search sketch uses staff module pattern (`entities[]`, `entityId`, async presenter) |
| Existing staff identity linkage used | Pass | Uses `staff_team_members` and `user_id` mapping; no duplicate employee identity model |

### Non-Compliant Items

None. All previously identified gaps have been resolved.

### Verdict

- **Fully compliant**: Approved — ready for Phase 1 implementation.

---

## Changelog

### 2026-03-12 — Phase 1 widgets and consistency updates
- Added two Phase 1 dashboard widgets: `Time Reporting` (start/stop timer) and `Hours by Project` (AOV-style date presets).
- Added save confirmation before `Save Changes` in the My Timesheets grid using the shared confirmation dialog pattern.
- Added Phase 1 ASCII mockups, removed Notes from UI forms, and aligned KPI naming to `Unique Employees`.
- Clarified API wording: timesheets routes use `/api/staff/timesheets/*`; summary widget uses existing `/api/dashboards/widgets/data`.
- Updated access requirements for summary widget (`dashboards.view` + `analytics.view` + `staff.timesheets.view`) and reran compliance checks.

### 2026-02-20 — First version
- First proposal after multiple internal revisions.
