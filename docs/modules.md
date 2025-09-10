# ERP Modules: Authoring and Usage

This ERP supports modular features delivered as either:
- Core modules in `src/modules/*` (plural, snake_case)
- External npm packages that export the same interface

## Conventions
- Modules: plural snake_case folder and `id` (special cases: `auth`, `example`).
- JS/TS: camelCase for variables and fields.
- Database: snake_case for tables and columns; table names plural.
- Folders: snake_case.

## Module Interface
Export an `ErpModule` as default or named export from `index.tsx`:

```ts
export type ErpModule = {
  id: string
  frontendRoutes?: { path: string; Component: FC }[]
  backendRoutes?: { path: string; Component: FC }[]
  apis?: { method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; path: string; handler: ApiHandler }[]
  cli?: { name: string; run(argv: string[]): Promise<void>|void }
}
```

### Routes (Auto-discovery)
- Put pages under your module:
  - Frontend: `src/modules/<module>/frontend/<path>.tsx` → serves `/<path>`
- Backend: `src/modules/<module>/backend/<path>.tsx` → serves `/backend/<path>`
- Special case: `src/modules/<module>/backend/page.tsx` → serves `/backend/<module>`
- The app provides catch-all dispatchers:
  - Frontend: `src/app/(frontend)/[[...slug]]/page.tsx`
  - Backend: `src/app/(backend)/backend/[[...slug]]/page.tsx`

### API Endpoints (Auto-discovery)
- Implement handlers under `src/modules/<module>/api/<method>/<path>.ts` (default export returns `Response`).
- The app exposes a catch-all API route in `src/app/api/[...slug]/route.ts` and dispatches by method + path.

### Database Schema and Migrations
- Place module tables in `src/modules/<module>/db/schema.ts`.
- Drizzle config includes all module schemas:
  - `drizzle.config.ts` → `schema: ['src/db/schema.ts', 'src/modules/**/db/schema.ts']`
- Generate and run migrations from the root:
  - `npm run db:generate`
  - `npm run db:migrate`

### CLI
- Optional: add `src/modules/<module>/cli.ts` default export `(argv) => void|Promise<void>`.
- The root CLI `erp` dispatches to module CLIs: `npm run erp -- <module> ...`.

## Adding an External Module
1. Install the npm package (must be ESM compatible) into `node_modules`.
2. Expose a pseudo-tree under `src/modules/<module>` via a postinstall script or a wrapper package; or copy its files into `src/modules/<module>`.
3. Ensure it ships its drizzle schema under `/db/schema.ts` so migrations generate.
4. Run `npm run modules:generate` to refresh the registry.

## Multi-tenant
- Core table: `organizations` with `id`, `name`, `is_active`, `created_at`, `updated_at`.
- Entities that belong to an organization must include `organization_id` FK.
- Client code must always scope queries by `organization_id`.
