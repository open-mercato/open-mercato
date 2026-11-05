# Auth User Display Name Exposure

## TL;DR
Expose the existing `User.name` field through the standard auth user create/edit UI and the user CRUD API so administrators can manage display names without bypassing the main flow.

## Overview
The `auth` module already persists `User.name` in the database and uses it in internal display logic, but the admin user forms and API schemas do not surface it. This creates a mismatch between the data model and the operator-facing workflow: the field exists, but the primary admin UI cannot edit it.

This spec restores the missing contract by adding `name` to the user create/update payloads, returning it in list/read responses, and rendering a corresponding field in both backend user forms.

## Problem Statement
Administrators can create and edit users in `/backend/users`, but the forms currently only expose:
- `email`
- `password` or invite flow
- `organization`
- `roles`

As a result:
- user display names cannot be set from the standard UI
- list and lookup surfaces fall back to email only
- the API contract is inconsistent with the entity model
- downstream UIs that rely on user labels produce weaker identifiers than necessary

The problem is not a missing database column. The problem is a contract gap between entity, API schema, and form composition.

## Proposed Solution
Add `name` as an optional string field to the auth user create/update API and surface it in the backend create/edit pages.

The solution should:
- accept `name` in user create payloads
- accept `name` in user update payloads
- include `name` in list responses
- render a display-name field in `/backend/users/create`
- render the same field in `/backend/users/[id]/edit`
- preserve existing behavior when `name` is omitted or empty

## Architecture
This change stays within the `auth` module and does not introduce new module boundaries or new entities.

### Source of Truth
- `packages/core/src/modules/auth/data/entities.ts` remains the persistence source for `User.name`
- `packages/core/src/modules/auth/api/users/route.ts` becomes the API contract source for create/update/list exposure
- `packages/core/src/modules/auth/backend/users/create/page.tsx` and `packages/core/src/modules/auth/backend/users/[id]/edit/page.tsx` become the UI contract source for admin editing

### Behavioral Rules
- `name` is optional, not required
- empty strings should be normalized to `null` or omitted consistently at the form/API boundary
- existing users without a name must continue to load and save cleanly
- no cross-module schema changes are needed

### Compatibility Notes
This is an additive contract expansion, not a breaking removal.

Potential callers that already submit unknown fields should remain unaffected if the route schemas already passthrough body data. The spec still requires explicit acceptance of `name` so the contract is documented and stable.

## Data Model
No database migration is required because the entity already has the field.

### Existing Entity
- `User.name` already exists as a nullable text column

### Logical Representation
- `name: string | null`
- create/update payloads should treat it as optional input
- list/read responses should return the stored value directly

## API Contracts

### Create User
Update the create schema so the request body may include:
- `name?: string`

Expected semantics:
- if `name` is provided, persist it on the created user
- if `name` is omitted, leave it unset

### Update User
Update the update schema so the request body may include:
- `name?: string`

Expected semantics:
- if `name` is provided, update the stored display name
- if `name` is omitted, preserve the existing value

### User List / Read Responses
The user list payload should include `name` alongside the existing fields so UIs can display a proper label without needing a separate round trip.

Expected shape additions:
- `name: string | null`

### Profile Self-Read (`GET /api/auth/profile`)
The admin surfaces above let an operator *set* a display name. The signed-in user's own profile endpoint must also *return* it, or any UI rendering the current user — backend chrome, account blocks, profile menus — is forced back to the email address even when a name is stored.

Response shape addition:
- `name: string | null`

Expected semantics:
- return the stored value for the authenticated user
- normalise blank or whitespace-only values to `null`, so "set but empty" never surfaces as a label
- unauthenticated requests are unaffected and still return `401`

This is read-only. Whether a user may edit their *own* display name is a separate product decision: the admin route can already set it and the self-service profile form deliberately does not, so that question is left open rather than answered by implication.

### Internal Serialization
Any existing serialization helper that already maps `user.name` should remain aligned with the route response shape. The spec does not introduce a second serialization path; it requires the API response to match the established internal representation.

## UI Contracts

### Create Form
Add a `name` field to `packages/core/src/modules/auth/backend/users/create/page.tsx`.

Placement:
- in the main details section
- near `email`, before role assignment

### Edit Form
Add the same field to `packages/core/src/modules/auth/backend/users/[id]/edit/page.tsx`.

Placement:
- in the main details section
- prefilled from the loaded user record

### UX Expectations
- label should clearly communicate “display name” or “name”
- field should be optional unless the existing product direction explicitly requires otherwise
- form submission should not regress invite flow, password flow, tenant scoping, or role assignment

## Phases

### Phase 1: API Contract Repair
Update the auth user request/response schemas and persistence mapping so `name` is accepted, stored, and returned consistently.

### Phase 2: Admin Form Exposure
Add the missing field to both user forms and wire it through initial values and submission payloads.

### Phase 3: Regression Coverage
Add integration coverage for create/edit behavior and response shape to ensure the contract stays intact.

## Implementation Plan

### Step 1
Update `packages/core/src/modules/auth/api/users/route.ts`:
- extend create schema with optional `name`
- extend update schema with optional `name`
- include `name` in list/read response items
- forward `name` into the create/update command payloads

### Step 2
Update `packages/core/src/modules/auth/backend/users/create/page.tsx`:
- add a `name` field to the `CrudForm` fields list
- include `name` in initial values
- include `name` in the submission payload

### Step 3
Update `packages/core/src/modules/auth/backend/users/[id]/edit/page.tsx`:
- add the same `name` field to the edit form
- ensure the existing user value hydrates into the field
- include `name` in the update payload

### Step 4
Add or update tests:
- API tests for create/update payload acceptance
- API tests for list response shape including `name`
- integration coverage for create and edit form visibility

## Integration Coverage

### API Paths
- `POST /api/auth/users`
- `PUT /api/auth/users`
- `GET /api/auth/users`
- `GET /api/auth/profile` — covered by `modules/auth/__integration__/TC-AUTH-PROFILE-NAME-001.spec.ts`

### UI Paths
- `/backend/users/create`
- `/backend/users/[id]/edit`

### Test Scenarios
- create a user with `name` and verify it persists
- update an existing user’s `name` and verify the value changes
- list users and verify `name` is returned in the payload
- open create form and confirm `name` is visible
- open edit form and confirm `name` is visible and prefilled

Profile self-read (`TC-AUTH-PROFILE-NAME-001`, executable):
- create a user with a display name through the admin API, authenticate **as that user**, and verify
  the name comes back from `GET /api/auth/profile` — closing the write/read loop that unit tests
  cannot, since they mock the container, ORM and decryption helper
- a user with no display name reads back `null`
- a whitespace-only display name normalises to `null` rather than an empty label
- an unauthenticated read is rejected with `401`

## Risks & Impact Review

### Risk 1: Payload mismatch with existing command handlers
- Severity: Medium
- Impact: Create/update requests could accept `name` in the route schema but fail later if the command layer ignores it
- Mitigation: thread `name` through the route mapping and assert the command accepts it before merging
- Residual risk: minor if the command path currently strips unknown fields

### Risk 2: Empty string handling drifts between UI and API
- Severity: Medium
- Impact: users may see blank-but-not-null names or accidental overwrites
- Mitigation: normalize `name` consistently at the form boundary and in request validation
- Residual risk: low if the form and API agree on optional semantics

### Risk 3: List response shape changes affect downstream consumers
- Severity: Low
- Impact: callers that use strict response typing may need to adopt the new field
- Mitigation: additive-only change; no existing field removal or renaming
- Residual risk: low

### Risk 4: UI regression in the create/edit layout
- Severity: Low
- Impact: the details section may become visually denser
- Mitigation: place the new field with the existing identity fields and keep current form grouping intact
- Residual risk: low

## Final Compliance Report

### Architecture
- [x] Confined to the `auth` module
- [x] No new cross-module dependencies
- [x] No direct ORM relationship changes

### Data & Security
- [x] No new sensitive field introduced
- [x] No encryption map changes required
- [x] Existing tenant scoping remains unchanged

### API & UI
- [x] API schema expanded additively
- [x] Backend forms updated to reflect the data model
- [x] Behavior remains backward compatible for existing records

### Testing
- [x] API contract coverage required
- [x] UI visibility coverage required
- [x] Regression coverage for create/edit flows required

## Migration & Backward Compatibility

No migration is required, for applications or for data.

- **`GET /api/auth/profile`** gains `name` as a new response field. `BACKWARD_COMPATIBILITY.md` §7 permits
  adding optional fields to a response schema; no existing field is removed, renamed, or retyped, and the
  route URL and method are unchanged.
- **Consumers**: `auth/backend/auth/profile/page.tsx` and `auth/backend/profile/change-password/page.tsx`
  widen their local `ProfileResponse` type. Both tolerate the field being absent, so an older client
  reading a newer server, or the reverse, keeps working.
- **`__integration__/TC-AUTH-017.spec.ts`** asserts only `profile.email`, so it is unaffected.
- **No backfill needed.** Users with no stored name receive `null`; blank and whitespace-only values
  normalise to `null` rather than surfacing an empty label. The column already exists, so there is no
  schema change.
- **The admin create/update contract is untouched** by this addition — it already accepted and returned
  `name`.
- **Deliberately not changed**: self-service editing of one's own display name. The profile form still
  does not submit `name`, so no new write path or permission question is introduced here.

## Changelog
- 2026-05-09: Drafted spec to expose `User.name` in auth admin UI and user API payloads.
- 2026-07-31: Review follow-up. `name` is declared `.nullable().optional()` on the response schema so the contract is additive for clients generated against an older schema; the endpoint's OpenAPI description now mentions the display name and roles; and `TC-AUTH-PROFILE-NAME-001` adds executable route-level coverage, listed above.
- 2026-07-30: Added the Profile Self-Read section and implemented it — `GET /api/auth/profile` now returns `name` (blank normalised to `null`). Reported from a downstream app whose backend chrome could only show an email address. Note for a maintainer: the admin-surface phases of this spec appear already implemented on `develop` (`/api/auth/users` accepts `name` on create/update, returns it in list responses, and supports search by display name), so this file may be a candidate for `.ai/specs/implemented/` — not moved here, since confirming that is a maintainer call.
