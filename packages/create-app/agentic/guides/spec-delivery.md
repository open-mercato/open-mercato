# Specification Delivery

Use this guide for a new application, multi-module feature, or other non-trivial business slice.

## Authoring readiness gate

1. Invoke `om-spec-writing` before authoring or revising. Mentioning the skill or reading only `SPEC-000-template.md` is not sufficient.
2. After invocation, read `.ai/specs/SPEC-000-template.md` and preserve every section; use `N/A — reason` only when a section genuinely does not apply.
3. Keep status `Draft` until no blocking open question remains and every requirement maps to an acceptance criterion, implementation phase, and self-contained test oracle.
4. For each affected UI route, inspect and cite the closest existing Open Mercato page plus `.ai/guides/backend-ui.md`; specify its text mockup/structure, actions, data source and mutations, permissions, canonical shell/components, and loading/empty/error/conflict/keyboard/a11y/responsive/light/dark states. Tabular admin data names `DataTable`; CRUD create/edit names `CrudForm`; backend reads name shared API helpers; every exception has an explicit rationale.
5. New applications and multi-module requests also define domain vocabulary/invariants, measurable success, navigation/widgets, module ownership and extension points, architecture/data flow, and concrete risk scenarios. A page inventory alone is not an app architecture.
6. Phases are dependency-ordered complete vertical slices with concrete deliverables, acceptance IDs, bounded slices, tests, validation commands, business value, and observable exit gates. Do not defer required behavior to a catch-all “integration/polish” phase.
7. Mark the spec `Ready for implementation` only after the traceability and final compliance matrices pass and the user approves implementation.

## Implementation phase gate

- Use `om-implement-spec` for local delivery and `om-auto-implement-spec` for whole-spec PR delivery.
- Only the current unblocked phase may be in progress. Parallelize independent slices inside that phase only; never start a dependent module/phase before its prerequisite exit gate passes.
- Delegation does not bypass routing. Before any UI slice, actually invoke `om-backend-ui-design` and read `.ai/guides/backend-ui.md`; naming them in an agent prompt is not invocation. Every implementation brief names the active phase, routed guides/skills, closest reference page, canonical primitives, acceptance IDs, owned files, and validation oracle.
- Reject raw backend tables/forms/fetch, copied component families, arbitrary values, hard-coded palette/status colors, and light-only styling unless the approved spec records a necessary exception. UI phase evidence exercises affected routes in light and dark mode and at narrow width, including loading/empty/error/conflict and keyboard behavior.
- A phase remains open while it has stubs, missing integration evidence, unmet acceptance IDs, or failing validation. Generated discovery, file count, and typecheck alone do not prove completion.
- If no remote/tracker exists, report PR delivery unavailable and invoke local `om-implement-spec` phase-by-phase; never improvise a concurrent whole-spec build.
