# Modules: Authoring and Usage

This app supports modular features delivered as either:
- Core modules published as `@mercato-core` (monorepo package)
 - App-level overrides under `src/modules/*` (take precedence)
- External npm packages that export the same interface

## Conventions
- Modules: plural snake_case folder and `id` (special cases: `auth`, `example`).
- JS/TS: camelCase for variables and fields.
- Database: snake_case for tables and columns; table names plural.
- Folders: snake_case.

## Module Interface
- Enable modules in `src/modules.ts`.
- Generators auto-discover pages/APIs/DI/i18n for enabled modules using overlay resolution (app overrides > core).
- Provide optional metadata and DI registrar to integrate with the container and module listing.

### Metadata (index.ts)
Create `@mercato-core/modules/<module>/index.ts` exporting `metadata` (or override via `src/modules/<module>/index.ts`):

```ts
import type { ModuleInfo } from '@/modules/registry'

export const metadata: ModuleInfo = {
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
Create `@mercato-core/modules/<module>/di.ts` exporting `register(container)` to add/override services and components. To override/extend, add `src/modules/<module>/di.ts`.

```ts
import { asClass, asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'

export function register(container: AppContainer) {
  // container.register({ myService: asClass(MyService).scoped() })
  // container.register({ myComponent: asValue(MyComponent) })
}
```

### Routes (Auto-discovery + Overrides)
- Put default pages under `@mercato-core/modules/<module>`.
- Override any page by placing a file at the same relative path in `src/modules/<module>`.
  - Frontend: `src/modules/<module>/frontend/<path>.tsx` → overrides `/<path>`
  - Backend: `src/modules/<module>/backend/<path>.tsx` → overrides `/backend/<path>`
  - Special case: `.../backend/page.tsx` → serves `/backend/<module>`
- The app provides catch-all dispatchers:
  - Frontend: `src/app/(frontend)/[[...slug]]/page.tsx`
  - Backend: `src/app/(backend)/backend/[[...slug]]/page.tsx`

#### Override Example
- Package page: `@mercato-example/modules/example/frontend/blog/[id]/page.tsx`
- App override: `src/modules/example/frontend/blog/[id]/page.tsx`
  - If present, the app file is used instead of the package file.
  - Remove the app file to fall back to the package implementation.

### API Endpoints (Auto-discovery + Overrides)
- Implement defaults under `@mercato-core/modules/<module>/api/...`.
- Override by adding `src/modules/<module>/api/...`.
- The app exposes a catch-all API route in `src/app/api/[...slug]/route.ts` and dispatches by method + path.

### Database Schema and Migrations (MikroORM)
- Place entities in `@mercato-core/modules/<module>/data/entities.ts` (fallbacks: `db/entities.ts` or `schema.ts`).
- To override or extend entities, add `src/modules/<module>/data/entities.override.ts`.
- Generate combined module registry and entities: `npm run modules:prepare`.
- Generate migrations for enabled modules: `npm run db:generate` → writes to `src/modules/<module>/migrations`.
- Apply migrations for enabled modules: `npm run db:migrate`.

### Validation (zod)
- Put validators alongside entities in `src/modules/<module>/data/validators.ts`.
- Create focused schemas (e.g., `userLoginSchema`, `tenantCreateSchema`).
- Import and reuse validators across APIs/CLI/forms to keep behavior consistent.
- Derive types as needed: `type Input = z.infer<typeof userLoginSchema>`.

### CLI
- Optional: add `src/modules/<module>/cli.ts` default export `(argv) => void|Promise<void>`.
- The root CLI `mercato` dispatches to module CLIs: `npm run mercato -- <module> ...`.

## Adding an External Module
1. Install the npm package (must be ESM compatible) into `node_modules`.
2. Expose a pseudo-tree under `src/modules/<module>` via a postinstall script or a wrapper package; or copy its files into `src/modules/<module>`.
3. Ensure it ships its MikroORM entities under `/db/entities.ts` so migrations generate.
4. Run `npm run modules:prepare` to refresh the registry, entities, and DI.

## Translations (i18n)
- Base app dictionaries: `src/i18n/<locale>.json` (e.g., `en`, `pl`).
- Module dictionaries: `src/modules/<module>/i18n/<locale>.json`.
- The generator auto-imports module JSON and adds them to `Module.translations`.
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

## Enabling Modules
- Edit `src/modules.ts` and list modules to load, e.g.:
  - `{ id: 'auth', from: '@mercato-core' }`, `{ id: 'directory', from: '@mercato-core' }`, `{ id: 'example', from: '@mercato-example' }`.
- Generators and migrations only include these modules.

## Monorepo, Overrides, and Module Config
- Core modules live in `@mercato-core` and example in `@mercato-example`.
- App-level overrides live under `src/modules/<module>/...` and take precedence over package files with the same relative path.
- Enable modules explicitly in `src/modules.ts`.
- Generators (`modules:prepare`) and migrations (`db:*`) only include enabled modules.
- Migrations are written under `src/modules/<module>/migrations` to avoid mutating packages.
