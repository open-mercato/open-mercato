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
- No manual registry file is needed — the app auto-discovers modules.
- Provide optional metadata and DI registrar to integrate with the container and module listing.

### Metadata (index.ts)
Create `src/modules/<module>/index.ts` exporting `metadata`:

```ts
import type { ErpModuleInfo } from '@/modules/registry'

export const metadata: ErpModuleInfo = {
  name: '<module-id>',
  title: 'Human readable title',
  version: '0.1.0',
  description: 'Short description',
  author: 'You',
  license: 'MIT'
}
```

Generators expose `modulesInfo` for listing.

### Dependency Injection (di.ts)
Create `src/modules/<module>/di.ts` exporting `register(container)` to add/override services and components.

```ts
import { asClass, asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'

export function register(container: AppContainer) {
  // container.register({ myService: asClass(MyService).scoped() })
  // container.register({ myComponent: asValue(MyComponent) })
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

### Database Schema and Migrations (MikroORM)
- Place module entities in `src/modules/<module>/db/entities.ts` (fallback: `schema.ts`).
- Generate combined module registry and entities: `npm run modules:prepare`.
- Generate migrations for all modules: `npm run db:generate` → writes to `src/modules/<module>/migrations`.
- Apply migrations for all modules: `npm run db:migrate`.

### CLI
- Optional: add `src/modules/<module>/cli.ts` default export `(argv) => void|Promise<void>`.
- The root CLI `erp` dispatches to module CLIs: `npm run erp -- <module> ...`.

## Adding an External Module
1. Install the npm package (must be ESM compatible) into `node_modules`.
2. Expose a pseudo-tree under `src/modules/<module>` via a postinstall script or a wrapper package; or copy its files into `src/modules/<module>`.
3. Ensure it ships its MikroORM entities under `/db/entities.ts` so migrations generate.
4. Run `npm run modules:generate` to refresh the registry.

## Translations (i18n)
- Base app dictionaries: `src/i18n/<locale>.json` (e.g., `en`, `pl`).
- Module dictionaries: `src/modules/<module>/i18n/<locale>.json`.
- The generator auto-imports module JSON and adds them to `ErpModule.translations`.
- Layout merges base + all module dictionaries for the current locale and provides:
  - `useT()` hook for client components (`@/lib/i18n/context`).
  - `loadDictionary(locale)` for server components (`@/lib/i18n/server`).

Client usage:
```tsx
"use client"
import { useT } from '@/lib/i18n/context'
export default function MyComponent() {
  const t = useT()
  return <h1>{t('example.moduleTitle')}</h1>
}
```

Server usage:
```tsx
import { detectLocale, loadDictionary } from '@/lib/i18n/server'
export default async function Page() {
  const locale = detectLocale()
  const dict = await loadDictionary(locale)
  const t = (k: string) => dict[k] ?? k
  return <h1>{t('backend.title')}</h1>
}
```

## Multi-tenant
- Core module `directory` defines `tenants` and `organizations`.
- Entities that belong to an organization must include `tenant_id` and `organization_id` FKs.
- Client code must always scope queries by `tenant_id` and `organization_id`.

## Listing and Overriding
- List loaded modules and their metadata via `modulesInfo` exported from `@/modules/registry` or `@/modules/generated`.
- Override services/entities/components by registering replacements in your module `di.ts`. The container loads core defaults first, then applies registrars from each module in order, allowing overrides.
