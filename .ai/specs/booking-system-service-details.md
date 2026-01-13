# Booking Service Details - Specification

Goal: Extend the booking module data model, commands, and APIs so that a single booking service can model very different scenarios (1:1 specialist, 1:n ticketed events, resource rental, room rental) via pluggable allocation strategies and reusable UI components.

This spec focuses on booking service definition, allocation strategy, scheduling constraints, questionnaire, and booking page configuration. The next implementation step will follow this plan.

## 1) Principles and Constraints

- Modules remain isomorphic; no cross-module ORM relations. Store foreign keys as string IDs.
- All tenant-scoped entities include `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`.
- Validate all inputs in `src/modules/booking/data/validators.ts` with zod.
- Commands and APIs must be undoable where it makes sense and emit indexer side effects.
- Use DI for services; no `new` in handlers.
- Keep code in `src/modules/booking` or `packages/*` only (avoid `src/`).

## 2) Terminology

- Service: defines how a booking can be scheduled and what is required to fulfill it.
- Allocation: resolving required members/resources based on rules and availability.
- Strategy: interchangeable algorithm that handles selection and conflicts.
- Questionnaire: fields requested during booking; answers stored on booking events.
- Booking page: public-facing metadata (title, slug, copy, look & feel).

## 3) Scenarios Mapping

1) Hairdresser 1:1 with specialist + optional resources
- User selects a member or system assigns based on availability (round robin, least busy, etc.).
- Requires availability for chosen member and required resources.

2) 1:n event (concert)
- Fixed time, capacity-limited ticketing. No member assignment required.
- Capacity may also be constrained by a resource (venue).

3) Car rental
- User selects a resource (specific car) OR selects a resource type (economy), system assigns any available.

4) Room rental
- Similar to car rental; resources are rooms, optional resource-type selection (2-person rooms).

Additional constraints:
- Resources have `capacity` (quantity). Multiple bookings can consume partial capacity.
- Bookings can be multi-day and span hours across days.
- Buffer time between bookings is configurable per service.
- Recurring bookings are supported by service config.
- Booking window: earliest booking lead time and max horizon.
- Waitlist: allow booking even when requirements cannot be fulfilled; capture missing requirements.

## 4) Data Model Extensions

### 4.1 booking_services (extend existing definition)

Add fields (snake_case in DB, camelCase in code):

- `strategy_id`: string
  - Identifier for allocation strategy (e.g. `member.one_to_one`, `resource.any_available`, `event.capacity_only`).
- `strategy_config`: jsonb
  - Strategy-specific config (see section 5).
- `booking_window`: jsonb
  - `{ min_notice_minutes: number, max_advance_days: number, min_start_at?: Date, max_start_at?: Date }`
- `buffer_minutes`: number
  - Minimum gap before/after bookings for this service.
- `slot_granularity_minutes`: number
  - Granularity for availability slots (e.g. 5, 10, 15).
- `booking_mode`: enum
  - `scheduled` | `fixed_time`
  - `fixed_time` means booking time is predefined (e.g. concerts).
- `fixed_time_rules`: jsonb
  - Optional rules for fixed-time services (list of windows or rules).
- `allow_waitlist`: boolean
- `waitlist_behavior`: enum
  - `capture_shortage` | `require_manual_confirm`
- `requires_member_selection`: boolean
  - If true, booking UI must choose a specific member.
- `member_allocation_policy`: enum
  - `all_required` | `any_available` | `round_robin` | `least_busy`
- `resource_allocation_policy`: enum
  - `all_required` | `any_available` | `by_type_any` | `by_specific`
- `capacity_mode`: enum
  - `one_to_one` | `one_to_many` | `resource_capacity`
- `capacity_limit`: number | null
  - For 1:n services or capacity-only services.
- `recurrence_policy`: jsonb
  - `{ enabled: boolean, allow_rrule: boolean, max_occurrences?: number }`
- `questionnaire_id`: string | null
  - FK to booking_service_questionnaires (see below).

Keep existing fields: name, description, duration_minutes, required_* arrays, tags, is_active.

Notes:
- `strategy_id` + `strategy_config` is the primary extension point. If a new algorithm is needed, implement a new strategy in DI without altering the service schema.
- `capacity_mode` and `capacity_limit` support 1:n and resource-quantity scenarios.

### 4.2 booking_service_questionnaires (new)

Stores reusable questionnaires to be attached to services.

Fields:
- `id`, `tenant_id`, `organization_id`
- `name`
- `description` (optional)
- `fields`: jsonb array of field definitions (see 4.3)
- `created_at`, `updated_at`, `deleted_at`

### 4.3 Questionnaire Field Definition (jsonb)

Each field in `booking_service_questionnaires.fields`:

```
{
  id: string,              // stable key
  label: string,
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'file',
  required: boolean,
  options?: { value: string; label: string }[],
  accept?: string[],       // for file types; file extensions or mime categories
  maxFiles?: number,
  helpText?: string
}
```

### 4.4 booking_event_answers (new)

Store user answers and file references per booking event.

Fields:
- `id`, `tenant_id`, `organization_id`
- `event_id`: string
- `questionnaire_id`: string
- `answers`: jsonb
  - `{ [fieldId: string]: string | string[] | boolean | { fileId: string; name: string; size: number }[] }`
- `created_at`, `updated_at`, `deleted_at`

### 4.5 booking_pages (new)

Represents the booking page configuration for a service or group of services.

Fields:
- `id`, `tenant_id`, `organization_id`
- `service_id` (nullable if page aggregates multiple services)
- `title`
- `slug` (unique per tenant/org)
- `intro_text` (optional)
- `hero_image_id` (optional)
- `theme_config`: jsonb
  - color, typography tokens, layout flags (future expansion)
- `is_active`: boolean
- `created_at`, `updated_at`, `deleted_at`

### 4.6 booking_event_allocations (optional new table)

Captures allocation decisions and shortages for waitlist/manual resolution.

Fields:
- `id`, `tenant_id`, `organization_id`
- `event_id`
- `status`: `allocated` | `partial` | `unallocated`
- `missing_requirements`: jsonb
  - `{ members?: { role_id?: string; qty: number }[], resources?: { resource_id?: string; resource_type_id?: string; qty: number }[] }`
- `notes` (optional)
- `created_at`, `updated_at`, `deleted_at`

If we keep this inline, we can place `allocation_status` + `missing_requirements` directly on `booking_events` instead.

## 5) Allocation Strategy Design

### 5.1 Strategy Interface (DI)

Create a service interface to compute availability and allocate resources/members.

```
interface BookingAllocationStrategy {
  id: string
  getAvailability(ctx: AvailabilityContext): Promise<AvailabilityResult>
  allocate(ctx: AllocationContext): Promise<AllocationResult>
  explainShortage?(ctx: AllocationContext): Promise<MissingRequirements>
}
```

Context includes:
- service config
- candidate members/resources (filtered by role/type and active status)
- time range and timezone
- current bookings for overlap checks

### 5.2 Common Strategy Types

1) `member.one_to_one`
- Required members: exact member or role-based selection.
- Policy can be `all_required`, `any_available`, `round_robin`, `least_busy`.

2) `resource.any_available`
- User selects resource type; system picks any available resource.

3) `resource.specific`
- User selects a specific resource; allocation checks availability and capacity.

4) `event.capacity_only`
- No members/resources required; only capacity limit is enforced.

5) `mixed.member_and_resource`
- Requires member(s) and resources together; availability is intersection of both.

Strategies share helper functions for:
- Availability calculation using `bookingAvailabilityService`.
- Capacity checks for resource quantity.
- Buffer time before/after events.

### 5.3 Round Robin and Least Busy

- Round robin uses a stored cursor per service/role or per service/member group.
- Least busy uses recent event counts (last N days) or total allocated minutes.
- Store cursor state in `booking_service_strategy_state` (optional) or in `strategy_config`.

### 5.4 Role-Based Allocation

- When `required_roles` are set, system determines eligible members by role.
- Use `required_roles[].qty` to select N available members.
- If `member_allocation_policy = all_required`, require all selected to be available.
- If `any_available`, choose any N available.

### 5.5 Resource Type Allocation

- For resource type selection, build a candidate list of resources with matching `resource_type_id`.
- For resources with `capacity > 1`, allow multiple overlapping bookings up to capacity.

## 6) Availability and Conflict Rules

### 6.1 Inputs

Availability is computed from:
- Availability rules for members/resources (`booking_availability_rules`).
- Existing bookings (events) for overlaps.
- `buffer_minutes` from service.
- Resource quantity/capacity.

### 6.2 Overlap Definition

- For time-based bookings, overlap occurs when requested range intersects any confirmed or negotiation event with allocated member/resource.
- For multi-day bookings, treat the time window as continuous; use inclusive/exclusive boundaries consistently.
- Apply buffer minutes to both start and end when checking overlaps.

### 6.3 Recurrence

- If service allows recurrence, booking UI allows specifying an rrule and end conditions.
- Allocation must validate that all occurrences are possible; if any fail and waitlist disabled, reject.
- If waitlist enabled, allow creation with `allocation_status = partial` and store missing requirements per occurrence.

## 7) Waitlist Behavior

- If `allow_waitlist = true`, booking can be created even if requirements are not satisfied.
- Capture shortages in `missing_requirements` and mark status `partial` or `unallocated`.
- Booking UI should surface which requirements are missing (resource, role, capacity).
- Staff can later resolve allocations and confirm the booking.

## 8) Commands and APIs

### 8.1 Commands

Add command handlers for new entities and for allocation logic:

- `booking.service.create/update/delete`
- `booking.service.set_questionnaire`
- `booking.questionnaire.create/update/delete`
- `booking.page.create/update/delete`
- `booking.event.allocate` (assign members/resources, compute shortages)
- `booking.event.answer_questionnaire` (store answers)

Ensure command payloads include custom field snapshots if used.

### 8.2 CRUD APIs

New API routes under `src/modules/booking/api`:

- `services.ts`
  - CRUD for services
  - `POST /services/:id/allocate-preview` (optional preview availability and required allocations)

- `questionnaires.ts`
  - CRUD for booking questionnaires

- `event-answers.ts`
  - CRUD for event answers (used by booking flow)

- `pages.ts`
  - CRUD for booking pages

All use `makeCrudRoute` with `indexer: { entityType }` and tenant/org scoping.

### 8.3 Booking Availability API

- Extend existing availability endpoint to accept `service_id` and `strategy_id`.
- Response includes availability slots and, optionally, allocation hints.

## 9) UI (Admin) - Editing Service Definition

### 9.1 Service Edit Form (CrudForm)

Sections:
- Basics: name, description, duration, active
- Strategy: strategy selector and dynamic config editor
- Requirements: members, roles, resources, resource types
- Capacity: mode and limit
- Booking window: min notice, max advance, fixed time rules
- Buffer and slot granularity
- Waitlist and recurrence
- Questionnaire: attach existing or create new

Dynamic UI:
- Strategy selector drives which config fields are visible.
- Member/resource requirements appear only for relevant strategies.

### 9.2 Strategy Config Editor

A reusable component that renders JSON config via schema-driven fields.

Suggested approach:
- Define a map of `strategy_id -> configSchema` (zod or JSON schema).
- Use a shared form renderer for consistent UI.

### 9.3 Questionnaire Editor

- CRUD list of questionnaires with inline builder UI.
- Field types: text, select, multiselect, checkbox, file.
- Options editor for select/multiselect fields.
- Validation: required and type-specific limits.

### 9.4 Booking Page Editor

- CRUD for booking pages.
- Select service or group.
- Configure title, slug, intro, hero image, and theme tokens.

## 10) Booking Flow (Public)

Not implemented in this step, but service definition must support:

- Availability search using `bookingAvailabilityService` and chosen strategy.
- Member or resource selection (if required by service).
- Questionnaire submission stored on event answers.
- Waitlist path if requirements not met.

## 11) Validation Rules

- `duration_minutes` > 0
- `buffer_minutes` >= 0
- `slot_granularity_minutes` in {5,10,15,30,60}
- `capacity_limit` required for `one_to_many` and `capacity_only`
- `booking_window.min_notice_minutes` >= 0
- `booking_window.max_advance_days` >= 0
- `strategy_id` must exist in registry
- Questionnaire fields have unique `id` per questionnaire

## 12) Indexing

- Ensure CRUD routes include `indexer: { entityType }` for new entities.
- Provide search config for booking services and booking pages if needed.

## 13) Migration Plan

1) Update `src/modules/booking/data/entities.ts` with new fields/tables.
2) Update `src/modules/booking/data/validators.ts`.
3) Run `npm run db:generate` to create migrations.
4) Run `npm run modules:prepare`.

## 14) Testing Plan

- Allocation strategies: availability intersections for members + resources.
- Round robin and least busy selection.
- Resource capacity (qty) with overlapping bookings.
- Waitlist creation with missing requirements.
- Questionnaire CRUD and answers.
- Booking page CRUD.

## 15) Implementation Phases

Phase 1: Data model
- Extend booking_services, add questionnaires, event answers, pages.

Phase 2: Allocation layer
- Strategy interface + default strategies.
- Availability API enhancement.

Phase 3: Commands + APIs
- CRUD for new entities and allocation preview.

Phase 4: Admin UI
- Service editor with strategy config.
- Questionnaire builder and booking page editor.

