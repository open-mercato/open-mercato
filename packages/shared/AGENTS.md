# Shared Package — Agent Guidelines

Use `@open-mercato/shared` for cross-cutting utilities, types, DSL helpers, and infrastructure. MUST NOT import from `@open-mercato/core` or any domain package — shared has zero domain dependencies.

## MUST Rules

1. **MUST NOT add domain-specific logic** — this package is infrastructure only
2. **MUST use precise types** — no `any`, use zod schemas + `z.infer`
3. **MUST check for existing utilities** before adding new helpers — avoid duplication
4. **MUST export narrow interfaces** (e.g., `QueryEngine`) — never pass `any`/`unknown`
5. **MUST centralize reusable types and constants here** to prevent drift across packages

## Library Directory (`src/lib/`)

| Directory | When to use | Import path |
|-----------|-------------|-------------|
| `api/` | When building scoped API payloads | `@open-mercato/shared/lib/api/scoped` |
| `boolean/` | When parsing boolean strings from env/query params | `@open-mercato/shared/lib/boolean` |
| `commands/` | When implementing undo/redo command pattern | `@open-mercato/shared/lib/commands` |
| `crud/` | When building CRUD routes | `@open-mercato/shared/lib/crud` |
| `custom-fields/` | When handling custom field payloads | `@open-mercato/shared/lib/custom-fields` |
| `data/` | When you need `DataEngine` or `QueryEngine` types | `@open-mercato/shared/lib/data/engine` |
| `di/` | When setting up dependency injection (Awilix) | `@open-mercato/shared/lib/di` |
| `encryption/` | When querying encrypted entities (MUST use instead of raw `em.find`) | `@open-mercato/shared/lib/encryption/find` |
| `i18n/` | When translating strings — `useT()` client-side, `resolveTranslations()` server-side | `@open-mercato/shared/lib/i18n/context` or `/server` |
| `indexers/` | When building query index helpers | `@open-mercato/shared/lib/indexers` |
| `modules/` | When registering or listing modules | `@open-mercato/shared/lib/modules/registry` |
| `openapi/` | When generating CRUD OpenAPI specs | `@open-mercato/shared/lib/openapi/crud` |
| `profiler/` | When profiling with `OM_PROFILE` env flag | `@open-mercato/shared/lib/profiler` |
| `testing/` | When bootstrapping tests — register only what the test needs | `@open-mercato/shared/lib/testing/bootstrap` |

## Module Types (`src/modules/`)

When you need shared type definitions, import from these:

| Need | Import from |
|------|-------------|
| Dashboard widget types | `@open-mercato/shared/modules/dashboard/widgets` |
| DSL helpers (`defineLink`, `entityId`, `cf.*`) | `@open-mercato/shared/modules/dsl` |
| Event declarations (`createModuleEvents`) | `@open-mercato/shared/modules/events` |
| Search config types (`SearchModuleConfig`) | `@open-mercato/shared/modules/search` |
| Module setup types (`ModuleSetupConfig`) | `@open-mercato/shared/modules/setup` |
| Module registry types (`Module`) | `@open-mercato/shared/modules/registry` |

## Key Patterns

### Encryption — MUST use instead of raw ORM queries

```typescript
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
const results = await findWithDecryption(em, 'Entity', filter, { tenantId, organizationId })
```

### Boolean Parsing — MUST use instead of ad-hoc parsing

```typescript
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
```

### i18n — MUST use for all user-facing strings

```typescript
// Client-side (React components)
import { useT } from '@open-mercato/shared/lib/i18n/context'
const t = useT()

// Server-side
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
const { t } = await resolveTranslations()
```

### Request Scoping — use for scoped API payloads

```typescript
import { withScopedPayload, createScopedApiHelpers } from '@open-mercato/shared/lib/api/scoped'
```

## Before Adding a New Utility

1. Search existing `src/lib/` directories for similar functionality
2. Check if the utility belongs here (infrastructure) or in a domain package
3. Export a narrow, typed interface — avoid leaking implementation details
4. Add tests in `__tests__/`
5. Verify no circular dependency with domain packages
