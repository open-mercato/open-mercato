# Agents Guidelines

This repository is designed for extensibility. Agents should leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Conventions
- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Keep code minimal and focused; avoid side effects across modules.

## Extensibility Contract
- Auto-discovery:
  - Frontend pages under `src/modules/<module>/frontend/<path>.tsx` → `/<path>`
  - Backend pages under `src/modules/<module>/backend/<path>.tsx` → `/backend/<path>`
  - Special case: `src/modules/<module>/backend/page.tsx` → `/backend/<module>`
  - API under `src/modules/<module>/api/<method>/<path>.ts` → `/api/<path>` dispatched by method
  - Subscribers under `src/modules/<module>/subscribers/*.ts` exporting default handler and `metadata` with `{ event: string, persistent?: boolean, id?: string }`
  - Optional CLI at `src/modules/<module>/cli.ts` default export
  - Optional metadata at `src/modules/<module>/index.ts` exporting `metadata`
  - Optional DI registrar at `src/modules/<module>/di.ts` exporting `register(container)`
- Extensions and fields:
  - Per-module entity extensions: declare in `src/modules/<module>/data/extensions.ts` as `export const extensions: EntityExtension[]`.
  - Per-module static custom fields: declare in `src/modules/<module>/data/fields.ts` as `export const fieldSets: CustomFieldSet[]`.
  - Generators add these to `modules.generated.ts` so they’re available at runtime.
- Database entities (MikroORM) live in `src/modules/<module>/data/entities.ts` (fallbacks: `db/entities.ts` or `schema.ts` for compatibility).
- Generators build:
  - `src/modules/generated.ts` (routes/APIs/CLIs + info)
  - subscribers are included in `modules.generated.ts` under each module entry
  - `src/modules/entities.generated.ts` (MikroORM entities)
  - `src/modules/di.generated.ts` (DI registrars)
  - Run `npm run modules:prepare` or rely on `predev`/`prebuild`.
- Migrations (module-scoped with MikroORM):
  - Generate all modules: `npm run db:generate` (iterates modules, writes to `src/modules/<module>/migrations`)
  - Apply all modules: `npm run db:migrate` (ordered, directory first)

## Database Naming
- Tables: plural snake_case (e.g., `users`, `user_roles`, `example_items`).
- Common columns: `id`, `created_at`, `updated_at`, `is_active`, `organization_id` when applicable.
- Prefer integer PKs (`serial`) and explicit FKs; use junction tables for many-to-many.

## Multi-tenant Rules
- Always include and filter by `organization_id` for tenant-scoped entities.
- Never expose cross-tenant data from API handlers.
- Authentication must attach organization context explicitly.

## Security and Quality
- Validate all inputs with `zod`.
- Place validators next to entities (per module) in `src/modules/<module>/data/validators.ts`.
- Define create/update/input schemas and reuse from APIs, CLIs, and admin forms.
- Derive TypeScript types from zod via `z.infer<typeof schema>`.
- Use MikroORM EntityManager/repositories; never interpolate into SQL strings.
- Use DI (Awilix) to inject services; avoid new-ing classes directly in handlers.
- Hash passwords with `bcryptjs` (cost ≥10). Never log credentials.
- Return minimal error messages for auth (avoid revealing whether email exists).

## Code Style
- Keep modules self-contained; re-use common utilities via `src/lib/`.
- No one-letter variable names.
- Avoid in-line comments; prefer self-documenting code.
- Keep exports minimal and typed.
 - Prefer small, reusable libraries and utilities with minimal or no external dependencies where it makes sense.
 - Favor functional programming (pure functions, data-first utilities) over classes.
 - Write any necessary code comments in English.

## What’s new (data model evolution)
- Keep modules separated and isomorphic: when extending another module’s data, add a separate extension entity and declare a link in `data/extensions.ts` (do not mutate core entities). Pattern mirrors Medusa’s module links.
- Custom fields: users can add/remove/modify fields per entity without schema forks. We store definitions and values in a dedicated `custom_fields` module (EAV). A future admin UI will let users manage fields, and generic list/detail pages will consume them for filtering and forms.
- Query layer: access via DI (`queryEngine`) to fetch base entities with optional extensions and/or custom fields using a unified API for filtering, fields selection, pagination, and sorting.
