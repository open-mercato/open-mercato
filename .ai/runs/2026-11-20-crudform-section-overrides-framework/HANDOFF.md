# CrudForm section overrides framework handoff

Branch: feat/crudform-section-overrides-framework  
PR: https://github.com/open-mercato/open-mercato/pull/10067

## Completed

Phases 1–3 are implemented through the configured form's bound submit, delete, and section actions. Readiness is scoped by organization, and the default Todo browser flows passed after the base sync. See [checkpoint 4](checkpoint-4-checks.md) for scope and evidence.

## Next concrete action

Finish Step 4.1, the non-production fixture, then prove registry, manifest, UI, mutation, and compatibility behavior with that fixture. The authoring wrapper and live Todo showcase follow in Phases 5 and 6.

## Showcase wiring notes

The derived Todo adapter needs the named original `makeCrudRoute` object, its real command schema and fixtures, explicit command delete mode, and the same original method features. Its original API interceptor and synchronous events still run. Normalize the existing before-create subscriber output without introducing an inactive write.

Use the same outbox mirror adapter and deliver callback for create and update, with a single versioned delivery contract. The demo mirror includes delivery integration and contract IDs, durable failure reports, and the next failure reporting time. Generate and verify those columns when the actual entity lands.
