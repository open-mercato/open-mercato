# Module Planning

Load this reference for the first scaffold step.

1. Extract actors, records, lifecycle/status invariants, actions, queries, pages, integrations, asynchronous work, and acceptance paths.
2. Confirm app ownership. Use a new module for app domain behavior; use UMES for additive installed-module behavior; use a provider package for reusable external systems.
3. Choose a plural snake-case module ID. List stable entity IDs (`module:entity`), API routes, command/event IDs, ACL features, DI tokens, page routes, DataTable/CrudForm host IDs, and optional dependencies before coding.
4. Split phases by runnable vertical slice, not file type. Each phase leaves generation/typecheck/tests working.
5. Check `.ai/specs/` for relevant contracts. Ask before public-contract/schema architecture changes not already authorized.

For a one-shot module, the minimum complete slice is entity/validator/migration, command, scoped CRUD API/OpenAPI, ACL/setup, list/create/edit/detail UI, translations, generation, and integration coverage. Add search/events/workers/cache/notifications/CLI only when the brief requires them.
