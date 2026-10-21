# Module packaging decision

**Status:** Decision record — app-local modules stay in `apps/mercato/src/modules` through the pilot
**Created:** 2026-10-19
**Applies to:** `financial`, `fleet_management`, `fleet_operations`, `freight_operations`, `vehicle_rentals`, `student_transport`, `hr_management`, `saudi_localization`

## Decision

Do not move the Saudi business modules into `packages/` before the MVP pilot is stable. They remain app-local modules under `apps/mercato/src/modules/` in this cycle.

## Rationale

1. **The pilot needs velocity, not distribution.** A relocation touches every import path, the generator's module discovery, the build graph, the migration snapshots and the template. None of that changes pilot behaviour.
2. **The financial program already designs the move as a relocation, not a rewrite.** When the move happens, it should follow that design in one dedicated change rather than accrete piecemeal.
3. **The scaffold policy is undecided (G10).** The create-app template currently does not carry these modules; moving them into packages would force the packaging question in the form of a template rewrite. Keeping them app-local leaves both options open.
4. **Provider packages are already where they belong.** `@open-mercato/channel-whatsapp` and the other channel packages are workspace packages because they are distributable adapters. The business modules are not.

## Revisit criteria

Re-open this decision when all of the following hold:

- the pilot has completed a full billing and payroll cycle in production;
- the financial relocation spec is approved with an ordered migration plan;
- the template scaffold policy (G10) is settled;
- every app-local module has at least one external consumer that needs it as a package, or the product plan requires shipping them independently.

## Consequences

- The template scaffold policy (G10) is settled: the app-local modules stay out of the scaffold.
  `scripts/template-sync.ts` now ignores their module folders on both sides and strips every
  registration from the template `modules.ts`, so `yarn template:sync` is green without copying
  business-module source into the scaffold.
- The template still contains stale, unregistered source copies under
  `packages/create-app/template/src/modules/{financial,fleet_management,freight_operations,hr_management,saudi_localization,student_transport,transport_operations,vehicle_rentals}`.
  They are dead files: no registration points at them and `template:sync` ignores them. Removing the
  directories is a separate, reviewable cleanup; it was not part of the approved change.
- Standalone apps cannot install these modules as packages yet. That limitation must be stated in the pilot scope.

## Changelog

- 2026-10-20 — G10 settled; `template-sync` ignore list and registration stripping added; sync green.
