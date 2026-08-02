# Standalone reference module

This directory is the canonical local teaching module for standalone Open Mercato apps. It is source only: no built-in preset registers `reference_module`, so it contributes no routes, entities, migrations, seeds, navigation, events, workers, or widgets until you deliberately enable a copied module.

`ratelimit_probe` is a test fixture, not a module blueprint. The classic `example` module is a broad demo and QA fixture. Start here for a small, production-shaped implementation map.

## Read progressively

1. Use the router below to choose only the capability you need.
2. Open the [surface map](./references/surface-map.md) for its owner and exact source.
3. Consult the [finite machine inventory](./references/surface-inventory.json) only when validating coverage or resolving a precise path.
4. Follow the owning skill or guide for normative rules. This module shows implementations; it does not redefine framework contracts.

| Need | Start with |
|---|---|
| Module metadata, APIs, commands, events, search, cache, queues | [Module scaffold skill](../../../.ai/skills/om-module-scaffold/SKILL.md) |
| Entities, scoping, links, encryption, migrations | [Data model skill](../../../.ai/skills/om-data-model-design/SKILL.md) |
| Tables, forms, pages, conflicts, accessibility | [Backend UI skill](../../../.ai/skills/om-backend-ui-design/SKILL.md) |
| Enrichers, guards, interceptors, injections, overrides | [System extension skill](../../../.ai/skills/om-system-extension/SKILL.md) |
| Extend versus eject decisions | [Eject and customize skill](../../../.ai/skills/om-eject-and-customize/SKILL.md) |
| AI, providers, or durable workflows | Use the specialist route in the [surface map](./references/surface-map.md) |

## Rollout state

The [metadata shell](./index.ts), [scoped data model](./data/entities.ts), ACL/setup, migration/snapshot, DI, CLI, inventory, and source-present/registration-absent contract are implemented. Entries still marked `planned` in the inventory name exact files that later implementation phases will add. They are not claims of current local coverage, and there are no empty discovery placeholders.

## Copy and enable deliberately

1. Copy only the files required for your feature into a plural, snake_case module directory.
2. Rename every stable identifier listed below before activation.
3. Append `enabledModules.push({ id: '<your_module>', from: '@app' })` to [the module registry](../../modules.ts). Do not rewrite its existing entries.
4. Run `yarn generate` after adding discovery files or registering the module.
5. If the copied module owns entities, run `yarn db:generate`, review the SQL and JSON snapshot, and ask before applying migrations.
6. After changing ACL features or default grants in an existing app, run `yarn mercato auth sync-role-acls` so existing roles receive the intended grants.
7. Run focused tests and `yarn typecheck`; add integration coverage for affected API and UI paths.

Do not register this teaching module unchanged in production. The completed example uses these grep-friendly identifiers, all of which must be renamed when copied:

- module: `reference_module`
- entity: `ReferenceTask`, `reference_module:reference_task`, `reference_module.reference_task`
- tables: `reference_module_tasks` and related `reference_module_*` tables
- ACL: `reference_module.view`, `reference_module.manage`, `reference_module.import`
- events: `reference_module.reference_task.*`, `reference_module.import.completed`
- widget hosts: `reference_module.reference_task.detail:summary`, `crud-form:reference_module.reference_task:fields`

The singular module ID is an intentional teaching-fixture exception. Product modules remain plural and snake_case.

## Safety invariants

- Derive tenant and organization scope from trusted request or command context and fail closed.
- Keep cross-module links as scoped IDs and safe snapshots; never add cross-module ORM relationships.
- Route writes through commands, mutation guards, transactions, optimistic locking, and post-commit side effects.
- Keep encrypted values out of search, events, notifications, caches, and logs.
- Use generated IDs after activation, shared API/UI helpers, translations, and design-system tokens.
- Add a real caller and focused test with every discovery surface. Never create empty convention files.
