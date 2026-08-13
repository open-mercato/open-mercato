# Staff Module — Agent Guidelines

The `staff` module is **optional** and slated for extraction into a standalone `@open-mercato/staff` package published from the [official-modules](https://github.com/open-mercato/official-modules) repository. Core modules MUST NOT take direct dependencies on staff entities, helpers, or services — cross-module contact happens through the public surfaces listed below.

See [`.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md`](../../../../../.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md) for the decoupling plan, and [`BACKWARD_COMPATIBILITY.md`](../../../../../BACKWARD_COMPATIBILITY.md) for the contract-surface taxonomy referenced below.

## MUST Rules

1. **MUST NOT import staff entities (`StaffTeam`, `StaffTeamMember`, etc.) from non-staff core modules.** Use the public surfaces below.
2. **MUST treat the entity classes in `data/entities.ts` as module-internal.** They are not part of the public contract.
3. **MUST follow the `BACKWARD_COMPATIBILITY.md` deprecation protocol** before renaming or removing any of the public surfaces listed here — same as any other public contract surface in the platform.

## Public Contract Surfaces

### DI services (BC surface #9 — STABLE)

| Key | Contract |
|-----|----------|
| `staffIdentityResolver` | Request-scoped, read-only resolver for the current active Auth-to-Staff link in one exact tenant and organization. Consumers own authorization and MUST soft-resolve it when Staff is optional. |
| `staffIdentityProjectionResolver` | Request-scoped, read-only hydration of at most 100 known Staff UUIDs into minimal active-or-inactive, non-deleted identity projections in one exact tenant and organization. It is presentation-only; consumers own authorization and MUST soft-resolve it when Staff is optional. |
| `staffCandidateResolver` | Request-scoped, read-only, bounded candidate discovery for active Staff in one exact tenant and organization. `required` linkage includes only Auth-linked Staff; `any` also includes unlinked Staff. Consumers own authorization and MUST soft-resolve it when Staff is optional. |
| `availabilityAccessResolver` | Resolves an `AvailabilityWriteAccess` shape for the authenticated request, including whether the caller may edit availability for all members vs only themselves. Consumed by `planner/api/access.ts` via `container.resolve(..., { allowUnregistered: true })` - planner gracefully degrades to `403 staff_module_not_loaded` when staff is absent. |

`staffIdentityResolver` exposes only the types from
`@open-mercato/core/modules/staff/contracts/identityResolver`. The contract returns a minimal
identity projection and reports duplicate active Auth linkage as `ambiguous`; it never exposes a
Staff entity. Database/decryption failures propagate and MUST NOT be treated as module absence.

`staffIdentityProjectionResolver` exposes only the types from
`@open-mercato/core/modules/staff/contracts/identityProjectionResolver`. It accepts known Staff
UUIDs, includes inactive non-deleted identities for historical display, and returns only Staff UUID,
decrypted display name, and active state. It performs no Auth lookup, search, paging, or authorization.
Database/decryption failures propagate and MUST NOT be treated as module absence.

`staffCandidateResolver` exposes only the types from
`@open-mercato/core/modules/staff/contracts/candidateResolver`. It returns bounded, deterministic
pages containing only active Staff UUID and decrypted display name. It performs no authentication,
RBAC, resource policy, assignment eligibility, or HTTP handling. Consumers MUST derive scope from
authenticated context and authorize the target before calling. Database/decryption failures
propagate and MUST NOT be treated as module absence.

Resolver shape (from `lib/availabilityAccess.ts`):

```ts
type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}
```

`AvailabilityWriteAccess.unregistered?: boolean` is an additive sentinel field (BC surface #2 — STABLE) set to `true` only when staff DI is missing. Existing required fields MUST NOT be removed.

### API routes (BC surface #7 — STABLE)

| Route | Owner | Notes |
|-------|-------|-------|
| `GET /api/staff/team-members/assignable` | staff | Canonical URL for listing assignable staff candidates from customer flows. RBAC is customer-driven (`customers.roles.view` page guard + `customers.roles.manage` OR `customers.activities.manage` handler check) — see the route file for details. |

Replaces the deprecated `GET /api/customers/assignable-staff`, which now returns `308 Permanent Redirect` and will be removed no earlier than the next major release.

### ACL feature IDs (BC surface #10 — FROZEN)

The following feature IDs are stored in role configurations and MUST NOT be renamed or removed:

- `staff.my_availability.manage`
- `staff.my_availability.unavailability`
- Other `staff.*` features declared in [`acl.ts`](./acl.ts)

## Internal-Only Surfaces (NOT public contract)

These are subject to change without deprecation; do not import them from non-staff code:

- Entity classes in [`data/entities.ts`](./data/entities.ts) (`StaffTeam`, `StaffTeamMember`, `StaffTeamRole`, etc.)
- Lib helpers in [`lib/`](./lib/) — internal utilities consumed by staff routes/commands
- Migration files under [`migrations/`](./migrations/)
- Backend pages, widgets, and notifications

If you need data from staff in another core module, the correct path is:
1. Add a new DI-registered service in `di.ts` exposing the narrow contract you need
2. Document it in the table above as a public surface
3. Apply the BC deprecation protocol before changing it later

## Dependencies

Staff currently declares `requires: ['planner', 'resources']` in [`index.ts`](./index.ts). The dependency direction is intentional and asymmetric:

- Staff depends on planner + resources (hard requirement at load time).
- Planner soft-resolves `availabilityAccessResolver` via DI with `allowUnregistered: true` (graceful degradation when staff is absent).

This asymmetry will be reconciled in the Phase 2/3 follow-up when staff becomes its own npm package; for now, planner is the only consumer that must work without staff registered.

## When You Need an Import

| Topic | Where |
|-------|-------|
| DI registrar pattern | [`di.ts`](./di.ts) — call `register(container)` from bootstrap; never call directly from another module |
| Availability access types | `import type { AvailabilityWriteAccess, AvailabilityAccessContext } from '@open-mercato/core/modules/planner/api/access'` (planner re-exports the same shape it consumes; do not import from staff directly) |
| Staff identity resolver types | `import type { StaffIdentityResolver, StaffIdentityLookupResult } from '@open-mercato/core/modules/staff/contracts/identityResolver'` |
| Staff identity projection types | `import type { StaffIdentityProjectionResolver } from '@open-mercato/core/modules/staff/contracts/identityProjectionResolver'` |
| Staff candidate resolver types | `import type { StaffCandidateResolver, StaffCandidatePage } from '@open-mercato/core/modules/staff/contracts/candidateResolver'` |
| Anything else | Go through a public API route - never import entity classes |
