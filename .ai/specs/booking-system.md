# Booking Module Specification (Self-Contained Attendees + Extensions)

Goal: Build a tenant-aware booking module with self-contained attendees, availability, and conflict checks, plus a negotiation phase (waiting list), catalog product/variant linkage, admin widget injection, undo/redo command support, encryption defaults, and RBAC features. Module stays isomorphic (no cross-module ORM relationships) and admin-only.

## Progress (Last Updated 2026-01-07)

Completed:
- Added booking module scaffolding under `src/modules/booking` with `acl.ts`, `index.ts`, commands, API helpers, entities, and validators.
- Implemented commands + CRUD APIs for resources, resource types, and availability with `makeCrudRoute` and `indexer` enabled.
- Enabled module in `src/modules.ts` and ran `npm run modules:prepare` to refresh generated registries.
- Added encryption defaults for booking entities in `packages/core/src/modules/entities/lib/encryptionDefaults.ts`.
- Updated admin role seeding to include `booking.*` features in `packages/core/src/modules/auth/lib/setup-app.ts`.
- Introduced a shared `ensureOrganizationScope` helper in `packages/shared/src/lib/commands/scope.ts` and re-exported it from module shared helpers (catalog/sales/customers/booking).

Next steps:
- Run `npm run db:generate` and `npm run db:migrate` to generate/apply booking migrations.
- Implement services, team roles/members, events, attendees, allocations, confirmations, and product/variant link APIs + commands.
- Build Phase 1 admin UI: resource list/detail and the shared schedule/calendar components.
- Add negotiation flow commands/endpoints (confirmations, accept/cancel, undo/redo).
- Add tests for negotiation transitions, confirmation modes, product/variant links, and undo/redo.

## 0) Core Constraints

- Keep modules independent; never add cross-module ORM relations.
- All entities include `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`.
- Soft delete is default; queries exclude `deleted_at` by default.
- Inputs validated with zod in `src/modules/booking/data/validators.ts`.
- Use DI (Awilix) for services; no direct `new` in handlers.
- Use `findWithDecryption`/`findOneWithDecryption` when needed.
- Avoid `src/` app routes; place everything under `src/modules/booking`.

## 1) Module Layout

```
src/modules/booking/
  acl.ts
  api/
    services.ts
    events.ts
    team-members.ts
    team-roles.ts
    resources.ts
    resource-types.ts
    availability.ts
  data/
    entities.ts
    validators.ts
    extensions.ts
  widgets/
    injection/
      booking-service-product-assignment.tsx
      booking-service-product-assignment.meta.ts
    injection-table.ts
```

Optional:
- `src/modules/booking/cli.ts` if admin CLI needed.
- `src/modules/booking/index.ts` for module metadata.
- `src/modules/booking/di.ts` for registration.

## 2) Entities (MikroORM)

All tables: plural snake_case with UUID PKs.

### 2.0 Entity Implementation Notes

Files:
- `src/modules/booking/data/entities.ts` contains all entities.
- Use MikroORM decorators with `@Entity({ tableName })`.
- Use `@Property({ type: 'jsonb', default: [] })` for array/json fields.
- Use `@Enum` for constrained string enums.
- Add `@Property({ nullable: true })` for optional fields.
- Add indexes for `(tenant_id, organization_id)` and common filters (status, subject_id).

Soft delete:
- Prefer query filters to exclude `deleted_at` by default.

No cross-module relations:
- Product and variant IDs are plain strings.
- All entities support custom fields using shared helpers:
  - Use `collectCustomFieldValues()` for CRUD submissions and normalize with `normalizeCustomFieldSubmitValue`.
  - Reuse `splitCustomFieldPayload`, `normalizeCustomFieldValues`, and `normalizeCustomFieldResponse` from `packages/shared`.

### 2.1 booking_services

```
id: uuid
tenant_id: string
organization_id: string
name: string
description?: string
duration_minutes: number
capacity_model: 'one_to_one' | 'one_to_many' | 'many_to_many'
max_attendees?: number
required_roles: { role_id: string; qty: number }[]
required_members: { member_id: string; qty?: number }[]
required_resources: { resource_id: string; qty: number }[]
required_resource_types: { resource_type_id: string; qty: number }[]
tags: string[]
is_active: boolean
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.2 booking_team_roles

```
id: uuid
tenant_id: string
organization_id: string
name: string
description?: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.3 booking_team_members

```
id: uuid
tenant_id: string
organization_id: string
display_name: string
user_id?: string
role_ids: string[]
tags: string[]
is_active: boolean
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.4 booking_resource_types

```
id: uuid
tenant_id: string
organization_id: string
name: string
description?: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.5 booking_resources

```
id: uuid
tenant_id: string
organization_id: string
name: string
resource_type_id?: string
capacity?: number
tags: string[]
is_active: boolean
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.6 booking_availability_rules

```
id: uuid
tenant_id: string
organization_id: string
subject_type: 'member' | 'resource'
subject_id: string
timezone: string
rrule: string
exdates: string[]
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.7 booking_events

```
id: uuid
tenant_id: string
organization_id: string
service_id: string
title: string
starts_at: Date
ends_at: Date
timezone?: string
rrule?: string
exdates: string[]
status: 'draft' | 'negotiation' | 'confirmed' | 'cancelled'
requires_confirmations: boolean
confirmation_mode: 'all_members' | 'any_member' | 'by_role'
confirmation_deadline_at?: Date
confirmed_at?: Date
tags: string[]
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.8 booking_event_attendees (self-contained)

```
id: uuid
tenant_id: string
organization_id: string
event_id: string
first_name: string
last_name: string
email?: string
phone?: string
address_line1?: string
address_line2?: string
city?: string
region?: string
postal_code?: string
country?: string
attendee_type?: string
external_ref?: string
tags: string[]
notes?: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.9 booking_event_members

```
id: uuid
tenant_id: string
organization_id: string
event_id: string
member_id: string
role_id?: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.10 booking_event_resources

```
id: uuid
tenant_id: string
organization_id: string
event_id: string
resource_id: string
qty: number
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.11 booking_event_confirmations (negotiation phase)

```
id: uuid
tenant_id: string
organization_id: string
event_id: string
member_id: string
status: 'pending' | 'accepted' | 'declined'
responded_at?: Date
note?: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.12 booking_service_products

```
id: uuid
tenant_id: string
organization_id: string
service_id: string
product_id: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

### 2.13 booking_service_product_variants

```
id: uuid
tenant_id: string
organization_id: string
service_id: string
variant_id: string
created_at: Date
updated_at: Date
deleted_at?: Date
```

Notes:
- No ORM relations across modules; use string IDs only.
- Consider unique constraints on `(service_id, product_id)` and `(service_id, variant_id)`.

## 2A) Validators (Zod Schemas)

File: `src/modules/booking/data/validators.ts`

General:
- Define create/update schemas for each entity.
- Use `z.string().uuid()` for IDs.
- Use `z.enum([...])` for `capacity_model`, `status`, `confirmation_mode`.
- Use `z.coerce.date()` for date inputs.
- Export DTO types using `z.infer`.

Schema outline:

```
bookingServiceCreateSchema
bookingServiceUpdateSchema
bookingTeamRoleCreateSchema
bookingTeamRoleUpdateSchema
bookingTeamMemberCreateSchema
bookingTeamMemberUpdateSchema
bookingResourceTypeCreateSchema
bookingResourceTypeUpdateSchema
bookingResourceCreateSchema
bookingResourceUpdateSchema
bookingAvailabilityRuleCreateSchema
bookingAvailabilityRuleUpdateSchema
bookingEventCreateSchema
bookingEventUpdateSchema
bookingEventAttendeeCreateSchema
bookingEventAttendeeUpdateSchema
bookingEventMemberCreateSchema
bookingEventMemberUpdateSchema
bookingEventResourceCreateSchema
bookingEventResourceUpdateSchema
bookingEventConfirmationCreateSchema
bookingEventConfirmationUpdateSchema
bookingServiceProductLinkCreateSchema
bookingServiceProductLinkUpdateSchema
bookingServiceVariantLinkCreateSchema
bookingServiceVariantLinkUpdateSchema
```

Validation rules:
- `duration_minutes` > 0.
- `max_attendees` required for `one_to_many` and `many_to_many`.
- `starts_at` < `ends_at`.
- `rrule` required when recurring.
- `exdates` ISO datetime strings.
- `confirmation_deadline_at` must be after `starts_at` if present.
- Enforce presence of `tenant_id` and `organization_id` via scoped helpers.

## 2B) OpenAPI Specification (Admin API)

Generate via existing API docs module if present; otherwise define in booking module metadata for auto-discovery.

Base path: `/api/booking`.

Common response envelope:
```
{ ok: boolean; result: T; error?: { message: string; details?: any } }
```

Endpoints (high-level):

Services:
- `GET /services`
- `POST /services`
- `PATCH /services/{id}`
- `DELETE /services/{id}`
- `GET /services/{id}/product-links`
- `POST /services/{id}/product-links`
- `DELETE /services/{id}/product-links/{linkId}`

Team roles:
- `GET /team-roles`
- `POST /team-roles`
- `PATCH /team-roles/{id}`
- `DELETE /team-roles/{id}`

Team members:
- `GET /team-members`
- `POST /team-members`
- `PATCH /team-members/{id}`
- `DELETE /team-members/{id}`

Resources:
- `GET /resources`
- `POST /resources`
- `PATCH /resources/{id}`
- `DELETE /resources/{id}`

Resource types:
- `GET /resource-types`
- `POST /resource-types`
- `PATCH /resource-types/{id}`
- `DELETE /resource-types/{id}`

Availability:
- `GET /availability` (filters: subjectType, subjectIds, dateRange)
- `POST /availability`
- `PATCH /availability/{id}`
- `DELETE /availability/{id}`

Events:
- `GET /events` (filters: status, dateRange, subjectIds, serviceIds)
- `POST /events`
- `PATCH /events/{id}`
- `POST /events/{id}/confirmations`
- `POST /events/{id}/accept`
- `POST /events/{id}/cancel`
- `POST /events/{id}/undo`
- `POST /events/{id}/redo`

Attendees:
- `GET /events/{eventId}/attendees`
- `POST /events/{eventId}/attendees`
- `PATCH /events/{eventId}/attendees/{id}`
- `DELETE /events/{eventId}/attendees/{id}`

Members allocation:
- `GET /events/{eventId}/members`
- `POST /events/{eventId}/members`
- `PATCH /events/{eventId}/members/{id}`
- `DELETE /events/{eventId}/members/{id}`

Resources allocation:
- `GET /events/{eventId}/resources`
- `POST /events/{eventId}/resources`
- `PATCH /events/{eventId}/resources/{id}`
- `DELETE /events/{eventId}/resources/{id}`

OpenAPI fields:
- Define schemas for each entity DTO.
- Reuse `pagination`, `filters`, and `error` component schemas if available.
- Include `security` for admin auth.

## 3) Negotiation Phase (Waiting List)

### 3.1 Status Rules

- `draft` is initial state when an event is created.
- When `requires_confirmations` is true and at least one member is assigned, `draft -> negotiation`.
- When confirmations meet `confirmation_mode`, `negotiation -> confirmed` and set `confirmed_at`.
- Decline behavior: policy-defined (default: `negotiation -> cancelled`).
- If `requires_confirmations` is false, allow `draft -> confirmed` directly.

### 3.2 Confirmation Modes

- `all_members`: every assigned member must accept.
- `any_member`: first accept wins, event confirmed.
- `by_role`: at least one accept per required role (based on service requirements).

### 3.3 Confirmation Lifecycle

- Entering `negotiation` creates confirmations for all assigned members.
- Changing event time or member allocations resets confirmations to `pending`.
- Optional `confirmation_deadline_at` triggers auto-cancel on expiry.

## 4) APIs (Admin Only)

API files are grouped by resource and export handlers for multiple verbs.

### 4.1 Services

`src/modules/booking/api/services.ts`:
- `GET /api/booking/services`
- `POST /api/booking/services`
- `PATCH /api/booking/services/:id`
- `DELETE /api/booking/services/:id`

Product links:
- `GET /api/booking/services/:id/product-links`
- `POST /api/booking/services/:id/product-links`
- `DELETE /api/booking/services/:id/product-links/:linkId`

### 4.2 Events

`src/modules/booking/api/events.ts`:
- `POST /api/booking/events`
- `PATCH /api/booking/events/:id`
- `POST /api/booking/events/:id/confirmations`
- `POST /api/booking/events/:id/accept` (admin override)
- `POST /api/booking/events/:id/cancel`
- `POST /api/booking/events/:id/undo`
- `POST /api/booking/events/:id/redo`

### 4.3 Team Members / Roles / Resources / Availability

Dedicated files:
- `team-members.ts`
- `team-roles.ts`
- `resources.ts`
- `resource-types.ts`
- `availability.ts`

All CRUD via `makeCrudRoute` with `indexer: { entityType }`.

### 4.4 Validation

All input schemas in `src/modules/booking/data/validators.ts`.
- Define create/update schemas per entity.
- Export `z.infer` types for DTOs.

## 5) Catalog Linkage

### 5.1 Service Link Semantics

- Services can be linked to multiple products and variants.
- Products/variants can link to multiple services.
- For product edit UI, load current links and allow assignment/unassignment.
- Link edits are tenant+organization scoped.

### 5.2 Product Edit Widget (Admin)

Files:
- `src/modules/booking/widgets/injection/booking-service-product-assignment.tsx`
- `src/modules/booking/widgets/injection/booking-service-product-assignment.meta.ts`
- `src/modules/booking/widgets/injection-table.ts`

Slot: `crud-form:catalog.product`.

UI behavior:
- Fetch list of services and current product/variant links.
- Allow multi-select of services and variants.
- Two-way visibility: product edit shows linked services; service detail shows linked products/variants.
- Save using `apiCall` helpers.
- Support `Cmd/Ctrl + Enter` to save and `Escape` to cancel.
- Use `LoadingMessage` and `ErrorMessage` for state.

## 6) Undo/Redo

### 6.1 Command Strategy

Use existing command framework if present; otherwise add `booking_commands`.

Command types:
- `booking.event.create`
- `booking.event.update`
- `booking.event.cancel`
- `booking.event.confirm`
- `booking.event.reschedule`
- `booking.event.assign_member`
- `booking.event.assign_resource`

Each command includes:
- `payload` (applied data)
- `inverse_payload` (revert data)
- `status`: `applied` or `reverted`

Endpoints:
- `POST /api/booking/events/:id/undo`
- `POST /api/booking/events/:id/redo`

## 7) Encryption Defaults

Update `packages/core/src/modules/entities/lib/encryptionDefaults.ts`:

- booking_services: `name`, `description`, `tags`
- booking_team_roles: `name`, `description`
- booking_team_members: `display_name`, `tags`
- booking_resource_types: `name`, `description`
- booking_resources: `name`, `tags`
- booking_availability_rules: `rrule`, `exdates` (if sensitive)
- booking_events: `title`, `tags`
- booking_event_attendees: `first_name`, `last_name`, `email`, `phone`, `address_*`, `notes`, `tags`
- booking_event_confirmations: `note`

Decryption:
- Use `findWithDecryption`/`findOneWithDecryption` for populated relations without tenant/org scope.

## 8) RBAC Features

`src/modules/booking/acl.ts`:

```
export const features = [
  'booking.view',
  'booking.create',
  'booking.edit',
  'booking.delete',
  'booking.manage_services',
  'booking.manage_resources',
  'booking.manage_team',
  'booking.manage_events',
  'booking.manage_availability',
  'booking.manage_confirmations',
  'booking.manage_product_links',
  'booking.manage_commands',
];
```

Apply `requireFeatures` in metadata for all pages and API handlers.
Update default admin role seeding in `packages/core/src/modules/auth/cli.ts`.

## 9) Indexing + Query Engine

- All CRUD routes should include `indexer: { entityType }`.
- Use `queryEngine` via DI for complex list filtering.
- Use `ce.ts` only for custom entities/field seeding, not core table registration.

## 10) Migrations + Codegen

- Update `src/modules/booking/data/entities.ts`.
- Run `npm run db:generate` to create module migrations.
- Run `npm run modules:prepare` to rebuild generated artifacts.
- Never hand-write migrations.

## 11) Testing

Minimum coverage:
- negotiation transitions and confirmation modes
- deadline expiry behavior
- product/variant link CRUD
- undo/redo flows
- tenant/org scoping

## 12) UI Plan (Admin)

### 12.1 Page Inventory

Booking core pages (admin-only):
- Events list: `/backend/booking/events`
- Event detail: `/backend/booking/events/[id]`
- Negotiation/waiting list: `/backend/booking/negotiations`
- Services list: `/backend/booking/services`
- Service detail: `/backend/booking/services/[id]`
- Team members list: `/backend/booking/team-members`
- Team member detail: `/backend/booking/team-members/[id]`
- Resources list: `/backend/booking/resources`
- Resource detail: `/backend/booking/resources/[id]`
- Availability hub (calendar/list toggle): `/backend/booking/availability`
- My schedule (admin view scoped to current user): `/backend/booking/my-schedule`

Notes:
- Negotiation/waiting list is a dedicated page but reuses the same table/calendar components as events.
- My schedule is a separate admin page with a calendar-first view.

### 12.2 Reusable Calendar/List Component

Create a shared, rich availability component reusable across:
- Availability hub
- Team member detail
- Resource detail
- Events list (calendar toggle)
- My schedule
- Negotiation/waiting list (optional: calendar toggle)

Component requirements:
- Toggle: calendar view vs list view.
- Calendar click-to-create: click a date/time block to open a dialog.
- Dialog supports create/edit for availability rules and exceptions.
- Reusable filtering toolbar: date range, subject type, member/resource, service.
- Shared dialog and form controls; no page-specific form logic.
- Prefer placing shared UI in `packages/ui` if broadly reusable.
- Availability sources are injectable so the same component can render team member or resource availability.

#### 12.2.1 Calendar Feature Details

Core behaviors:
- Views: day, week, month, agenda (list) with a unified toggle.
- Timezone: display per user organization settings with explicit timezone selector.
- Working hours: show highlighted working hours per subject when available.
- Availability overlays: show repeating availability windows and exception blocks.
- Booking overlays: show confirmed events with distinct styling from negotiation/draft.
- Drag interactions:
  - Drag to create a new availability window.
  - Drag to reschedule an availability rule occurrence (create exception).
  - Drag events if user has edit permission (optional for MVP).
- Click interactions:
  - Click empty slot: open create dialog pre-filled with start/end.
  - Click availability block: open edit dialog for rule/exception.
  - Click event block: open event detail drawer/dialog.
- Conflict visualization:
  - Warn if new availability overlaps existing exceptions or blocked periods.
  - Warn if event time overlaps confirmed allocations.
- Inline creation: calendar uses the same shared create dialogs as list view.

#### 12.2.2 Data Model Coverage (Calendar Sources)

Calendar must fetch and merge:
- Availability rules: `booking_availability_rules`.
- Availability exceptions: stored in `exdates` per rule.
- Events: `booking_events` with status and allocations.
- Optional: unconfirmed negotiation events in a separate layer.

Filtering inputs:
- `subjectType`: `member` | `resource` | `event`.
- `subjectIds`: array of member/resource IDs.
- `serviceIds`: array of service IDs (for events).
- `status`: event status filters.
- `dateRange`: start/end for query.

Availability injection:
- `availabilityProvider` prop or hook injects availability items (team members or resources).
- Provider returns normalized items plus metadata (source type, subject mapping).
- Default provider uses booking availability APIs; custom providers allowed for other modules.

#### 12.2.3 Shared Components (Suggested)

Place in `packages/ui` if reusable outside booking:
- `ScheduleView`: main calendar/list wrapper with view toggle.
- `ScheduleToolbar`: date range picker, view toggle, filters, timezone selector.
- `ScheduleGrid`: day/week/month grid with time slots.
- `ScheduleAgenda`: list view with grouped sections by day.
- `ScheduleItem`: base component for availability/event blocks.
- `ScheduleLegend`: color key for availability vs events.
- `ScheduleDialog`: shared dialog host for create/edit.

Booking-specific wrappers in `packages/core`:
- `BookingScheduleView`: wires to booking APIs and transforms data.
- `BookingScheduleItem`: styles for booking statuses and subject types.

#### 12.2.4 Interaction Contracts (Props/Events)

`ScheduleView` core props:
- `items`: normalized schedule items.
- `availabilityProvider`: `(filters) => Promise<ScheduleItem[]>`.
- `view`: `'day' | 'week' | 'month' | 'agenda'`.
- `timezone`: string.
- `range`: `{ start: Date; end: Date }`.
- `onRangeChange(nextRange)`.
- `onViewChange(nextView)`.
- `onItemClick(item)`.
- `onSlotClick(slotRange)`.
- `onItemDrag(item, nextRange)` (optional).

Normalized item shape:
```
{
  id: string
  kind: 'availability' | 'event' | 'exception'
  title: string
  startsAt: Date
  endsAt: Date
  status?: 'draft' | 'negotiation' | 'confirmed' | 'cancelled'
  subjectType?: 'member' | 'resource'
  subjectId?: string
  color?: string
  metadata?: Record<string, unknown>
}
```

#### 12.2.5 Dialogs and Inline Creation

Shared dialog components:
- `AvailabilityDialog` (create/edit rule + exceptions)
- `EventDialog` (create/edit event, assign members/resources, attendees)

Dialog behavior:
- Prefill start/end from calendar slot click.
- `Cmd/Ctrl + Enter` submits; `Escape` cancels.
- Form uses `CrudForm` with shared validation.
- Errors displayed with `ErrorMessage`.

#### 12.2.6 UX and Visual Rules

- Availability blocks: subtle fill with border; exceptions use diagonal hatch.
- Events: solid fill, status badge (draft/negotiation/confirmed).
- Negotiation items: amber tone with pending icon.
- Cancelled items: muted and struck-through.
- Use consistent colors for member vs resource views.
- Keep keyboard navigation usable for day/week grid.

#### 12.2.7 API Expectations for Calendar

Required endpoints:
- `GET /api/booking/availability` with date range + subject filters.
- `GET /api/booking/events` with date range + subject/service/status filters.
- `POST /api/booking/availability` create rule/exceptions.
- `PATCH /api/booking/availability/:id`.
- `DELETE /api/booking/availability/:id`.

All APIs built via CRUD factory + commands.

### 12.3 Inline Creation Flows

All pages with list views should support inline creation:
- Create service from services list.
- Create member and availability from members list/detail.
- Create resource and availability from resources list/detail.
- Create event from events list or calendar.

Implementation:
- Use shared dialog components and shared form controls.
- Use `CrudForm` and CRUD helpers.
- `Cmd/Ctrl + Enter` submits, `Escape` cancels.

### 12.4 Two-Way Product/Variant Links

Expose links in both directions:
- Product edit widget shows services linked to the product and variant.
- Service detail includes a panel listing linked products/variants with add/remove.

Use the same shared selector component in both places.

## 13) Delivery Phases

Phase 1 (MVP foundation):
- Build reusable calendar/list component with click-to-create availability dialog.
- List and create/edit resources.

Phase 2:
- List and create/edit team members.
- Team member availability management using the shared calendar/list component.

Phase 3:
- Services list and detail with requirements and product/variant link panel.

Phase 4:
- Events list/detail with negotiation status.
- Negotiation/waiting list page.
- My schedule page.

All phases:
- CRUD APIs built via CRUD factory + commands.
- Shared UI controls for inline creation.
- Apply RBAC features to all pages.
