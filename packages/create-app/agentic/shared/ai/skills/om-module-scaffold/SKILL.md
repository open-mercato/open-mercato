---
name: om-module-scaffold
description: Scaffold a new module from scratch with all required files and conventions. Use when creating a new module, adding a new entity with CRUD, or bootstrapping module features (API routes, backend pages, DI, ACL, events, search). Triggers on "create module", "new module", "scaffold module", "add module", "bootstrap module", "generate module".
---

# Module Scaffold

Create a new module with all required files following Open Mercato conventions. This skill generates the full module structure, wires it into the app, and runs required generators.

## When to use

- Creating a brand-new module, adding a new entity with CRUD, or bootstrapping module features end-to-end (routes, pages, DI, ACL, events, search).
- Not for extending an existing module's data or wiring a single cross-module link — reach for the matching focused guide instead.

## What it contains

An ordered, module-anatomy pipeline: gather requirements → scaffold layout → entities/validators → API routes → backend pages → module wiring (metadata/ACL/DI/events) → optional features → wire & verify. Each stage lives in its own `workflow/step-N-*.md` with every file template, command, and rule preserved.

## Reference map — load the stage you are in

| When | Load |
|------|------|
| Gather requirements + scaffold the directory tree | [`workflow/step-1-gather-and-scaffold.md`](workflow/step-1-gather-and-scaffold.md) |
| Write the MikroORM entity + zod validators | [`workflow/step-2-entities-and-validators.md`](workflow/step-2-entities-and-validators.md) |
| Build the CRUD API route (`makeCrudRoute`) | [`workflow/step-3-api-routes.md`](workflow/step-3-api-routes.md) |
| Build backend list/create/edit pages (`DataTable`, `CrudForm`, nav meta) | [`workflow/step-4-backend-pages.md`](workflow/step-4-backend-pages.md) |
| Wire module metadata, ACL/setup, DI, events | [`workflow/step-5-module-wiring.md`](workflow/step-5-module-wiring.md) |
| Optional features: search, translations, CLI, enrichers, encryption | [`workflow/step-6-optional-features.md`](workflow/step-6-optional-features.md) |
| Register in `modules.ts`, run generators/migration, validation gate, self-review + consolidated rules | [`workflow/step-7-wire-and-verify.md`](workflow/step-7-wire-and-verify.md) |
| Module/entity/file naming rules | [`references/naming-conventions.md`](references/naming-conventions.md) |
| Sidebar nav fields, grouping, settings pages, anti-patterns | [`references/navigation-patterns.md`](references/navigation-patterns.md) |

## Non-negotiables

- Module ID + folder: plural, snake_case; every tenant-scoped entity carries `organization_id`, `tenant_id`, and the standard columns (incl. `updated_at` for optimistic locking).
- CRUD routes use `makeCrudRoute({ metadata, orm, list, create, update, del })` with all methods in one `route.ts`; events use `createModuleEvents({ moduleId, events: [...] })`.
- Declare ACL features and wire them in `setup.ts`; never create cross-module ORM relationships.
- Sensitive/GDPR fields REQUIRE `encryption.ts` (`defaultEncryptionMaps`) — never hand-roll AES/KMS or defer encryption.
- After scaffolding run the validation gate (`yarn generate` → structural cache purge → `sync-role-acls` → `yarn typecheck`) and confirm `/login` still loads.
