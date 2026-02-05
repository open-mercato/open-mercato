# Shared Package — Agent Guidelines

`@open-mercato/shared` provides cross-cutting utilities, types, DSL helpers, and infrastructure used by all other packages. Never import from `@open-mercato/core` or other domain packages here — shared must have zero domain dependencies.

## Library Directory (`src/lib/`)

| Directory | Purpose | Key Exports |
|-----------|---------|-------------|
| `api/` | API utilities, scoped payloads | `withScopedPayload`, `parseScopedCommandInput`, `createScopedApiHelpers()` |
| `auth/` | Auth context and session types | — |
| `bootstrap/` | App bootstrap helpers | — |
| `boolean/` | Boolean string parsing | `parseBooleanToken`, `parseBooleanWithDefault`, `TRUE_VALUES`, `FALSE_VALUES` |
| `cache/` | Cache interface types | — |
| `cli/` | CLI framework utilities | — |
| `commands/` | Command pattern (undo/redo) | `registerCommand`, command types |
| `crud/` | CRUD factory, route builders | `makeCrudRoute`, CRUD helpers |
| `custom-fields/` | Custom field helpers | `splitCustomFieldPayload`, `normalizeCustomFieldValues`, `normalizeCustomFieldResponse`, `buildCustomFieldResetMap` |
| `data/` | Data engine, query engine | `DataEngine`, `QueryEngine` types |
| `db/` | Database utilities, MikroORM helpers | — |
| `di/` | Dependency injection (Awilix) | Container setup |
| `email/` | Email sending utilities | — |
| `encryption/` | Encryption helpers | `findWithDecryption`, `findOneWithDecryption`, `decryptEntitiesWithFallbackScope`, `decryptIndexDocCustomFields`, `decryptIndexDocForSearch` |
| `entities/` | Entity utilities | — |
| `frontend/` | Frontend shared utilities | — |
| `hotkeys/` | Keyboard shortcut handling | — |
| `i18n/` | Internationalization | `useT` (client), `resolveTranslations`, `createTranslator` (server) |
| `indexers/` | Query index helpers | — |
| `modules/` | Module registry utilities | `registerModules`, `getModules` |
| `openapi/` | OpenAPI spec helpers | `createCrudOpenApiFactory` |
| `profiler/` | Tree profiler | `OM_PROFILE` env flag |
| `query/` | Query engine internals | — |
| `search/` | Search utilities | — |
| `testing/` | Test bootstrap | `bootstrapTest` |

## Module Types (`src/modules/`)

Shared type definitions and interfaces consumed by other packages:

- `dashboard/widgets` — `DashboardWidgetModule` type
- `dsl` — DSL helpers: `defineLink()`, `entityId()`, `linkable()`, `defineFields()`, `cf.*`
- `events` — `createModuleEvents()`, event type definitions
- `search` — `SearchModuleConfig`, `SearchBuildContext`
- `setup` — `ModuleSetupConfig` type
- `registry` — `Module` type, registry functions

## Key Patterns

### i18n

```typescript
// Client-side (React components)
import { useT } from '@open-mercato/shared/lib/i18n/context'
const t = useT()
t('module.key')

// Server-side
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
const { t } = await resolveTranslations()
```

### Encryption Helpers

Always use these instead of raw `em.find`/`em.findOne` for safety:

```typescript
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const results = await findWithDecryption(em, 'Entity', filter, { tenantId, organizationId })
```

### Request Scoping

```typescript
import { withScopedPayload, createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
// Use these instead of redefining per module
```

### Boolean Parsing

```typescript
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
// Never use ad-hoc boolean string parsing
```

### Testing

```typescript
import { bootstrapTest } from '@open-mercato/shared/lib/testing/bootstrap'
// Register only what the test needs
```

## Rules

- Never add domain-specific logic — this package is infrastructure only
- All types should be precise: no `any`, use zod schemas + `z.infer`
- Centralize reusable types and constants here to avoid drift across packages
- When adding new helpers, check if a similar one already exists
- Export narrow interfaces (e.g., `QueryEngine`) rather than passing `any`/`unknown`
