# Spec Phases and Gates

Load this reference before implementation.

## Readiness audit

Before creating implementation tasks, require all of the following:

1. The spec status is `Ready for implementation`, not `Draft`.
2. No blocking open question is unresolved.
3. Every requirement maps to an acceptance criterion, phase, and self-contained test oracle.
4. Every affected UI route cites the closest installed reference and names its structure/mockup, actions, data source/mutations, permissions, canonical shell/components, and loading/empty/error/conflict/keyboard/a11y/responsive/light/dark states. Lists and CRUD surfaces name `DataTable`/`CrudForm` and shared API helpers unless an approved exception explains why they cannot satisfy the interaction.
5. Every affected API/command names its auth, scope, input, response/event, error, concurrency, and compatibility contracts.
6. Each phase names dependencies, concrete deliverables, acceptance IDs, tests, validation commands, and an observable exit gate.

If any item is absent, stop implementation and return the spec to `om-spec-writing`. Do not fill design gaps opportunistically in agent prompts.

## Phase state machine

1. Build the requirement-to-phase matrix and phase execution plan using `planning-and-progress.md`; it owns the plan fields, user confirmation, and progress format.
2. Keep phases in `pending → in_progress → verified` order. Only one phase may be `in_progress`; a phase can start only when every declared dependency is `verified`.
3. Order by foundations and then complete vertical slices. Do not launch one agent per later module or implement all entities/APIs first and postpone their required UI/integration to a catch-all phase.
4. Inside the active phase, assign only independent research, implementation, integration-test, and review slices to bounded agents. Give each one owned files, routed guides/skills, closest installed reference, canonical primitives, acceptance IDs, and a validation oracle; one owner per file/slice. Invoke routed skills before delegation—especially `om-backend-ui-design` for rendered surfaces—rather than paraphrasing guessed conventions into the prompt.
5. After each slice, run focused tests and record files/commands/results plus remaining work in the spec/progress artifact. File count, generated discovery, and typecheck alone never prove a business slice works.
6. Run the schema probe at its data slice and generation at every discovery slice; never defer all integration until the end.

## Phase exit gate

A phase becomes `verified` only when all of its specified deliverables exist through real call sites, no required page is a stub, every mapped acceptance ID is exercised, its self-contained API/UI paths pass, and its focused generation/typecheck/tests are green. For affected UI, compare the result with the cited reference and verify the platform shell/components, shared API helpers, semantic tokens, light/dark themes, narrow width, quality states, keyboard flow, and absence of undocumented raw-table/form/fetch or hard-coded-color substitutes. A failure keeps the phase `in_progress` and blocks every dependent phase.

After the final phase, run all spec API/UI paths with self-contained fixtures, affected safety cases, typecheck/lint/test/build, and the packed standalone boundary when relevant. When the spec's Integration Coverage lists integration tests, write those test files inside their owning phase and run them through the `om-prepare-test-env` descriptor path with `yarn test:integration:ephemeral`. Never substitute plain `yarn test:integration` or apply migrations to the developer database. If the ephemeral runner is unavailable, record `integration: blocked (<reason>)` in the active phase ledger and keep the phase `in_progress`; an unstated or silently skipped integration lane can never satisfy the exit gate.

Then actually invoke the installed `om-code-review` skill, load `.ai/review-checklist.md`, and resolve every blocking finding before reporting completion. Every configured command must exit zero; reproduce a suspected baseline failure separately and report it as a blocker without marking the phase verified. Any later edit invalidates earlier evidence for the affected paths and requires the relevant focused, integration, build, and review gates to run again.

If an acceptance criterion cannot be met without scope/architecture/public-contract change, stop and ask rather than silently revising the spec.
