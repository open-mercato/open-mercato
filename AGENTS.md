# Agents Guidelines

This repository is designed for extensibility. Agents should leverage the module system and follow strict naming and coding conventions to keep the system consistent and safe to extend.

## Conventions
- Modules: plural, snake_case (folders and `id`). Special cases: `auth`, `example`.
- JS/TS fields and identifiers: camelCase.
- Database tables and columns: snake_case; table names plural.
- Keep code minimal and focused; avoid side effects across modules.
- Avoid adding code in the `src/` - try to put it in a proper package in the `packages` folder - `src` is a boilerplate for users app

## Extensibility Contract
- Auto-discovery:
  - Frontend pages under `src/modules/<module>/frontend/<path>.tsx` → `/<path>`
  - Backend pages under `src/modules/<module>/backend/<path>.tsx` → `/backend/<path>`
  - Special case: `src/modules/<module>/backend/page.tsx` → `/backend/<module>`
  - Page metadata:
    - Prefer colocated `page.meta.ts`, `<name>.meta.ts`, or folder `meta.ts`.
    - Alternatively, server components may `export const metadata` from the page file itself.
  - API under `src/modules/<module>/api/<method>/<path>.ts` → `/api/<path>` dispatched by method
  - Subscribers under `src/modules/<module>/subscribers/*.ts` exporting default handler and `metadata` with `{ event: string, persistent?: boolean, id?: string }`
  - Optional CLI at `src/modules/<module>/cli.ts` default export
  - Optional metadata at `src/modules/<module>/index.ts` exporting `metadata`
  - Optional features at `src/modules/<module>/acl.ts` exporting `features`
  - Optional custom entities at `src/modules/<module>/ce.ts` exporting `entities`
  - Optional DI registrar at `src/modules/<module>/di.ts` exporting `register(container)`
- Extensions and fields:
  - Per-module entity extensions: declare in `src/modules/<module>/data/extensions.ts` as `export const extensions: EntityExtension[]`.
  - Custom fields: declare in `src/modules/<module>/ce.ts` under `entities[].fields`. `data/fields.ts` is no longer supported.
  - Generators add these to `modules.generated.ts` so they’re available at runtime.
  - Prefer using the DSL helpers from `@/modules/dsl`:
    - `defineLink()` with `entityId()` or `linkable()` for module-to-module extensions.
    - `defineFields()` with `cf.*` helpers for field sets.
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
- Common columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id` when applicable.
- Prefer UUID PKs (`uuid`) and explicit FKs; use junction tables for many-to-many.

## Module Isomorphism Rules
- **NO direct relationships between modules**: Modules must remain isomorphic and independent.
- **NO @ManyToOne/@OneToMany relationships across modules**: Use foreign key IDs instead.
- **Fetch related data separately**: When you need data from another module, fetch it with separate queries using the foreign key IDs.
- **Example**: Instead of `user.tenant` relationship, use `user.tenantId` and fetch tenant separately with `em.findOne('Tenant', { id: user.tenantId })`.
- This ensures modules can be developed, tested, and deployed independently.

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
- Always confirm the project still builds after your changes and surface build failures immediately.

## Profiling
- Enable the tree profiler by exporting `OM_PROFILE` (or `NEXT_PUBLIC_OM_PROFILE` in the browser) with comma-separated filters (`*`, `all`, `customers.*`, etc.). Legacy flags (`OM_CRUD_PROFILE`, `OM_QE_PROFILE`) still work but should be avoided in new work.
- CRUD factories already emit `[crud:profile]` payloads; the query engine attaches its breakdown as a nested `query_engine` node when invoked from CRUD, so you only get one snapshot per profiled request.
- When you call the hybrid query engine directly (CLI/tests) you can still pass the profiler explicitly or rely on the same env flag to receive `[qe:profile]` entries.
- Treat profiler output as part of your acceptance checklist for slow paths—capture a snapshot before/after changes when tuning performance-heavy flows.

## Access control
- Prefer declarative guards in metadata: `requireAuth`, `requireRoles`, and `requireFeatures`.
- RBAC is two-layered: Role ACLs and User ACLs per tenant. Features are string-based and declared per module in `src/modules/<module>/acl.ts`.
- Use the DI `rbacService.userHasAllFeatures(userId, features, { tenantId, organizationId })` for server-side checks.
- Special flags: `isSuperAdmin` (all features), and optional organization visibility list to restrict org scope.

### Features
- Features are string-based permissions that control access to module functionality (e.g., `users.view`, `users.create`, `users.edit`, `users.delete`).
- **Every module MUST expose all its features in `src/modules/<module>/acl.ts`** by exporting a `features` array of strings.
- Feature naming convention: `<module>.<action>` (e.g., `example.view`, `example.create`, `example.edit`, `example.delete`).
- Features are assigned to roles and users through Role ACLs and User ACLs.
- Pages, APIs, and other protected resources use `requireFeatures` in their metadata to declare which features are required for access.
- The `acl.ts` file serves as the single source of truth for all features provided by a module, making it easy to audit and manage permissions.
- Example `acl.ts` structure:
  ```typescript
  export const features = [
    'example.view',
    'example.create',
    'example.edit',
    'example.delete',
  ];
  ```

### HTTP calls in UI
- In client components and utilities, use `apiFetch` from `@open-mercato/ui/backend/utils/api` instead of the global `fetch`. It automatically attaches proper headers and base URL handling consistent with the app.

## Code Style
- Keep modules self-contained; re-use common utilities via `src/lib/`.
- No one-letter variable names.
- Avoid in-line comments; prefer self-documenting code.
- Keep exports minimal and typed.
- Avoid casting to `any`; prefer precise types and union narrowing with runtime checks. When in doubt, extract and reuse shared types instead of `any`.
 - Prefer small, reusable libraries and utilities with minimal or no external dependencies where it makes sense.
 - Favor functional programming (pure functions, data-first utilities) over classes.
 - Write any necessary code comments in English.

## Internationalization
- Always add user-facing copy to the relevant locale files when introducing or modifying features.
- Keep locales in sync: update every supported language file, and add fallbacks only when the translation is genuinely unavailable.
- Run or document any required sync scripts so `src/modules/generated.ts` and other build artefacts stay aligned with locale updates.
- Avoid hard-coded strings; leverage the shared translation utilities in `packages/ui` to read from locale dictionaries.
- Client components can grab the translator with `useT` from `@/lib/i18n/context`:
  ```tsx
  import { useT } from '@/lib/i18n/context'

  export function LoginTitle() {
    const t = useT()
    return <h1>{t('auth.login.title')}</h1>
  }
  ```
- Server code can call `resolveTranslations()` or `createTranslator()` from `@open-mercato/shared/lib/i18n/server` to format copy before rendering:
  ```ts
  import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

  export async function getLoginLabels() {
    const { t } = await resolveTranslations()
    return { title: t('auth.login.title') }
  }
  ```

## UI Interaction
- Every new dialog must support `Cmd/Ctrl + Enter` as a primary action shortcut and `Escape` to cancel, mirroring the shared UX patterns used across modules.

### Type Safety Addendum
- Centralize reusable types and constants (e.g., custom field kinds) in `packages/shared` and import them everywhere to avoid drift.
- Do not introduce new `any`-typed APIs; define DTOs via zod schemas and `z.infer` for runtime + compile-time safety.
- If a helper requires dynamic behavior, expose narrow interfaces (e.g., `QueryEngine`) rather than passing `any`/`unknown`.

## What’s new (data model evolution)
- Keep modules separated and isomorphic: when extending another module’s data, add a separate extension entity and declare a link in `data/extensions.ts` (do not mutate core entities). Pattern mirrors Medusa’s module links.
- Custom fields: users can add/remove/modify fields per entity without schema forks. We store definitions and values in a dedicated `entities` module (EAV). A future admin UI will let users manage fields, and generic list/detail pages will consume them for filtering and forms.
- Query layer: access via DI (`queryEngine`) to fetch base entities with optional extensions and/or custom fields using a unified API for filtering, fields selection, pagination, and sorting.
  - Soft delete: entities should include `deleted_at timestamptz null`. The query engine excludes rows with non-null `deleted_at` by default; pass `withDeleted: true` to include them.
- Request scoping helpers (`withScopedPayload`, `parseScopedCommandInput`, etc.) live in `packages/shared/src/lib/api/scoped.ts`. Import from there instead of redefining per module so tenants/organization enforcement stays consistent. Prefer `createScopedApiHelpers()` to tailor module-specific translations while keeping behaviour aligned.
- When adding new module features, mirror them in the `mercato init` role seeding (see `packages/core/src/modules/auth/cli.ts`) so the default admin role ships with immediate access to the capabilities you just enabled.
- `ce.ts` files only describe custom entities or seed default custom-field sets. Always reference generated ids (`E.<module>.<entity>`) so system entities stay aligned with `generated/entities.ids.generated.ts`. System tables (e.g. catalog/sales documents) are auto-discovered from ORM metadata—exporting them in `ce.ts` is just for labeling/field seeding and will not register them as user-defined entities.
