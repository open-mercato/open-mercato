# Specification Delivery

Use this guide for a new application, multi-module feature, or other non-trivial business slice.

## Spec-first decision gate

`AGENTS.md` owns the ordered rule; this section only expands it with examples and the surrounding delivery procedure. Apply it before writing code, in order:

1. Search the configured specs path (`.ai/specs`, plus any enterprise directory the config names) once for a covering specification. Open the one match; a plan-only request stops there.
2. A new user-facing or platform capability, an architecture decision, a schema or public API contract, cross-module behavior, or multi-phase behavior means authoring or amending a spec **before** coding (`spec-first`). Examples: "add a rental-booking module", "let customers self-serve returns", "introduce a second pricing engine".
3. A bug fix, minor behavioral correction, small documentation change, dependency maintenance, or an isolated refactor that adds no architecture and no public contract proceeds without a spec (`direct`). Examples: "the overdue filter is off by one day", "rename an internal helper", "bump the queue dependency".
4. A covering spec already exists: implement against it and update it in place (`reuse-spec`). Never open a second spec for the same capability.
5. A new feature skips the spec **only** when the user's current request explicitly says to skip or bypass it. Silence, urgency, an "it's small" estimate, and an earlier generic preference are not overrides; neither is your own time estimate.
6. When the classification is genuinely ambiguous **and** the answer materially changes the workflow, ask one bounded question (`ask`). Do not ask when repository evidence — an existing spec, an existing module, a reproducible defect — already resolves it.

After `spec-first` or `reuse-spec`, implementation routing is a one-way handoff: module work loads `om-module-scaffold`, which starts at `src/modules/example/README.md` and its `references/surface-inventory.json`, and adapts only the capability-linked source files. UI-bearing work additionally loads `om-backend-ui-design`. Never propose a second teaching module, copy the example tree wholesale, or treat `ratelimit_probe` as a blueprint. Every newly added or materially changed extension surface names its own self-contained integration test in the plan.

## Extension-surface traceability

Every added or materially changed runtime or discovery extension surface gets its own row in the spec's requirement traceability table. Putting a new surface inside an existing capability row does not waive the row. Each row names:

- the requirement it satisfies (`REQ-001`, …);
- the reference capability ID and the exact `src/modules/example/**` source file it adapts — an exact file, never a directory or wildcard, and never a path `references/surface-inventory.json` does not map;
- the implementation phase that lands it;
- its own self-contained integration test; and
- exactly one mechanism classification: `emitted-example` when the reference module already emits that mechanism, `framework-only` for an app-level setting that never becomes a module contribution, `catalog-only` when the framework describes the surface but the reference contributes nothing for it, `currently-unbound` when the value is reserved by the public set but no code path emits it, and `negative-fixture` when only a deliberately broken fixture produces it.

Only the reference module's own coverage ledger justifies the last four, and `negative-fixture` is never a valid classification for a surface you are proposing to ship.

The reference module is source-present and unregistered. Its activations, targets, routes, and grants apply only after an explicit opt-in, so a plan says so rather than describing them as behavior the app already has.

## Delivery skills

- Pinned delivery skills install with `yarn install-skills` (refresh: `--update`). When a skill is absent, run `yarn install-skills` once; never substitute a similarly named skill or improvise its workflow.
- `om-implement-spec` runs approved phases locally; `om-auto-implement-spec`, `om-auto-create-pr`, `om-auto-fix-issue`, and `om-auto-review-pr` own whole-spec, commit+ready PR, issue, and review delivery.
- Integration, E2E, and UI QA delivery uses `om-integration-tests` and `om-auto-qa-pr`.
- Routing note: specs themselves are `spec-pr` work; implementation owns the domain guides. Do not load delivery skills when no PR or spec workflow was requested.

## Authoring readiness gate

1. Invoke `om-spec-writing` before authoring or revising. Mentioning the skill or reading only `SPEC-000-template.md` is not sufficient.
2. After invocation, read `.ai/specs/SPEC-000-template.md` and preserve every section; use `N/A — reason` only when a section genuinely does not apply.
3. Keep status `Draft` until no blocking open question remains and every requirement maps to an acceptance criterion, implementation phase, and self-contained test oracle.
4. For each affected UI route, inspect and cite the closest existing Open Mercato page plus `.ai/guides/backend-ui.md`; specify its text mockup/structure, actions, data source and mutations, permissions, canonical shell/components, and loading/empty/error/conflict/keyboard/a11y/responsive/light/dark states. Tabular admin data names `DataTable`; CRUD create/edit names `CrudForm`; backend reads name shared API helpers; every exception has an explicit rationale.
5. New applications and multi-module requests also define domain vocabulary/invariants, measurable success, navigation/widgets, module ownership and extension points, architecture/data flow, and concrete risk scenarios. A page inventory alone is not an app architecture.
6. Phases are dependency-ordered complete vertical slices with concrete deliverables, acceptance IDs, bounded slices, tests, validation commands, business value, and observable exit gates. Do not defer required behavior to a catch-all “integration/polish” phase.
7. Mark the spec `Ready for implementation` only after the traceability and final compliance matrices pass and the user approves implementation.

## Implementation phase gate

- Use `om-implement-spec` for interactive local delivery and `om-auto-implement-spec` for whole-spec PR delivery. The local skill's progressive resolution, planning/progress, and report references own its exact workflow and final `Spec:` marker; it never claims PR/tracker output.
- Only the current unblocked phase may be in progress. Parallelize independent slices inside that phase only; never start a dependent module/phase before its prerequisite exit gate passes.
- Delegation does not bypass routing. Before any UI slice, actually invoke `om-backend-ui-design` and read `.ai/guides/backend-ui.md`; naming them in an agent prompt is not invocation. Every implementation brief names the active phase, routed guides/skills, closest reference page, canonical primitives, acceptance IDs, owned files, and validation oracle.
- Reject raw backend tables/forms/fetch, copied component families, arbitrary values, hard-coded palette/status colors, and light-only styling unless the approved spec records a necessary exception. UI phase evidence exercises affected routes in light and dark mode and at narrow width, including loading/empty/error/conflict and keyboard behavior.
- A phase remains open while it has stubs, missing integration evidence, unmet acceptance IDs, or failing validation. Generated discovery, file count, and typecheck alone do not prove completion.
- If no remote/tracker exists, report PR delivery unavailable and invoke local `om-implement-spec` phase-by-phase; never improvise a concurrent whole-spec build.
