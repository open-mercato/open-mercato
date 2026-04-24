---
name: migrate-mikro-orm
description: Migrate custom module code from MikroORM v6 to v7 in the Open Mercato codebase. Use when upgrading user modules, fixing MikroORM deprecation warnings, resolving v7 type errors (FilterQuery, RequiredEntityData), replacing Knex raw queries with Kysely, migrating persistAndFlush/removeAndFlush calls, or updating entity decorator imports. Triggers on "mikro-orm upgrade", "v7 migration", "persistAndFlush deprecated", "knex to kysely", "FilterQuery error", "decorator import error".
---

# MikroORM v6 → v7 Migration

Migrate custom module code to MikroORM v7. The platform core is already migrated — this skill targets user modules in `apps/mercato/src/modules/` and external integration packages under `packages/`.

## Table of Contents

1. [Pre-Flight](#1-pre-flight)
2. [Entity Decorators](#2-entity-decorators)
3. [persist/flush API](#3-persistflush-api)
4. [Knex → Kysely](#4-knex--kysely)
5. [Type Fixes](#5-type-fixes)
6. [ORM Configuration](#6-orm-configuration)
7. [Jest / Test Setup](#7-jest--test-setup)
8. [count() Casting](#8-count-casting)
9. [Verification](#9-verification)

---

## 1. Pre-Flight

Before migrating, confirm the platform packages are already on v7:

```bash
grep '@mikro-orm' package.json
# Expected: "@mikro-orm/core": "^7.0.10" (or higher)
```

Check which files in your module need changes:

```bash
# Find entity files with old decorator imports
grep -r "from '@mikro-orm/core'" apps/mercato/src/modules/<your-module>/

# Find deprecated persistAndFlush / removeAndFlush calls
grep -rn 'persistAndFlush\|removeAndFlush' apps/mercato/src/modules/<your-module>/

# Find Knex usage (must migrate to Kysely)
grep -rn 'getKnex\|getConnection()\.getKnex\|\.raw(' apps/mercato/src/modules/<your-module>/
```

---

## 2. Entity Decorators

v7 separated decorators from `@mikro-orm/core`. This codebase uses `@mikro-orm/decorators/legacy` (TypeScript `emitDecoratorMetadata` + `reflect-metadata` style).

### Before

```typescript
import { Entity, PrimaryKey, Property, ManyToOne, Index, Unique, OptionalProps } from '@mikro-orm/core'
```

### After

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
```

### Rules

- **Decorator exports** (`Entity`, `PrimaryKey`, `Property`, `ManyToOne`, `OneToMany`, `Index`, `Unique`, `Enum`, `Formula`, etc.) → import from `@mikro-orm/decorators/legacy`
- **Type-only exports** (`OptionalProps`, `EntityManager`, `FilterQuery`, `RequiredEntityData`, `Loaded`, `ref`, `Collection`, etc.) → keep importing from `@mikro-orm/core`
- If a file imports BOTH decorators and types, split into two import lines

### Quick sed

```bash
# Run from repo root — adjust the path glob for your module
find apps/mercato/src/modules/<your-module> -name 'entities.ts' -exec \
  sed -i '' "s|from '@mikro-orm/core'|from '@mikro-orm/decorators/legacy'|" {} +
```

Then manually re-add a separate `@mikro-orm/core` import for any type-only exports (`OptionalProps`, etc.).

---

## 3. persist/flush API

`persistAndFlush()` and `removeAndFlush()` are removed in v7. Use the chained API instead.

### Before

```typescript
await em.persistAndFlush(entity)
await em.removeAndFlush(entity)
```

### After

```typescript
await em.persist(entity).flush()
await em.remove(entity).flush()
```

### Multiple entities

```typescript
// Before
em.persist(a)
em.persist(b)
await em.flush()

// After — same pattern, still valid
em.persist(a)
em.persist(b)
await em.flush()
```

### Test mocks

If your tests mock `persistAndFlush` or `removeAndFlush`, update the mock to cover `persist`, `remove`, and `flush` separately:

```typescript
// Before
const em = { persistAndFlush: jest.fn(), removeAndFlush: jest.fn() }

// After
const em = {
  persist: jest.fn().mockReturnThis(),
  remove: jest.fn().mockReturnThis(),
  flush: jest.fn(),
}
```

---

## 4. Knex → Kysely

v7 replaced Knex with Kysely as the underlying SQL query builder. All raw SQL access changes.

### Getting the query builder

```typescript
// Before (v6)
const knex = em.getKnex()
// or
const knex = em.getConnection().getKnex()

// After (v7)
const db = em.getKysely<any>()
```

### Simple queries

```typescript
// Before (Knex)
const rows = await knex('users').where('tenant_id', tenantId).select('id', 'email')

// After (Kysely)
import { type Kysely } from 'kysely'

const db = em.getKysely<any>()
const rows = await db.selectFrom('users')
  .where('tenant_id', '=', tenantId)
  .select(['id', 'email'])
  .execute()
```

### Raw SQL with template literals

```typescript
// Before (Knex)
await knex.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey])

// After (Kysely)
import { sql } from 'kysely'
const db = em.getKysely<any>()
await sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`.execute(db)
```

### INSERT with Kysely

```typescript
// Before (Knex)
await knex('notifications').insert({ id, tenant_id, message })

// After (Kysely)
await db.insertInto('notifications')
  .values({ id, tenant_id, message })
  .execute()
```

### UPDATE with Kysely

```typescript
// Before (Knex)
await knex('notifications').where('id', id).update({ dismissed_at: knex.fn.now() })

// After (Kysely)
import { sql } from 'kysely'
await db.updateTable('notifications')
  .set({ dismissed_at: sql`now()` })
  .where('id', '=', id)
  .execute()
```

### DELETE with Kysely

```typescript
// Before (Knex)
await knex('expired_tokens').where('expires_at', '<', knex.fn.now()).del()

// After (Kysely)
await db.deleteFrom('expired_tokens')
  .where('expires_at' as any, '<', sql`now()`)
  .execute()
```

### JSONB casting

```typescript
// Kysely does not auto-cast JSON — use sql template
await db.insertInto('table')
  .values({ doc: sql`${JSON.stringify(data)}::jsonb` })
  .execute()
```

### Key differences

| Knex | Kysely |
|------|--------|
| `knex('table')` | `db.selectFrom('table')` |
| `.where('col', val)` | `.where('col', '=', val)` (operator required) |
| `.select('a', 'b')` | `.select(['a', 'b'])` |
| `.raw(sql, bindings)` | `` sql`...${binding}...`.execute(db) `` |
| `knex.fn.now()` | `` sql`now()` `` |
| `.insert({})` | `.insertInto('t').values({}).execute()` |
| `.update({})` | `.updateTable('t').set({}).execute()` |
| `.del()` | `.deleteFrom('t').execute()` |
| Results returned directly | Must call `.execute()` at the end |

---

## 5. Type Fixes

v7 tightened generic constraints on `FilterQuery<T>` and `RequiredEntityData<T>`.

### FilterQuery

If the compiler complains about a filter object not matching `FilterQuery<T>`, add an explicit cast:

```typescript
// Before — worked in v6, fails in v7
await em.find(MyEntity, { tenantId, deletedAt: null })

// After — explicit cast
await em.find(MyEntity, { tenantId, deletedAt: null } as FilterQuery<MyEntity>)
```

### RequiredEntityData

When creating entities with `em.create()` or `em.persist(em.create(...))`:

```typescript
// Before — worked in v6, fails in v7
em.create(MyEntity, { field1: 'x', field2: 123 })

// After — explicit cast if needed
em.create(MyEntity, { field1: 'x', field2: 123 } as RequiredEntityData<MyEntity>)
```

### Common patterns that need casts

- Filters with `null` comparisons (`deletedAt: null`)
- Filters mixing snake_case DB columns with camelCase entity props
- `em.create()` calls where optional props trigger excess property checks
- `em.nativeUpdate()` / `em.nativeDelete()` filter arguments

---

## 6. ORM Configuration

The platform ORM config (`packages/shared/src/lib/db/mikro.ts`) is already migrated. If your module initializes its own ORM instance (e.g., for tests or CLI), ensure:

### MetadataProvider (CRITICAL)

```typescript
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'

const orm = await MikroORM.init({
  // ...
  metadataProvider: ReflectMetadataProvider, // MUST set explicitly in v7
})
```

v7 removed the default `ReflectMetadataProvider`. Without this, entity metadata inference fails silently — columns get wrong types at runtime.

### Pool configuration

```typescript
// v6 pool shape (Knex-based)
pool: { min: 2, max: 10, acquireTimeoutMillis: 6000 }

// v7 pool shape (pg-pool based)
pool: { min: 2, max: 10, idleTimeoutMillis: 3000 }
// Acquire timeout moved to driverOptions:
driverOptions: { connectionTimeoutMillis: 6000 }
```

### SSL configuration

```typescript
driverOptions: {
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined,
}
```

---

## 7. Jest / Test Setup

v7 is ESM-only and uses `import.meta.resolve()` internally. The repo includes a custom Jest transformer that bridges ESM → CJS.

### Already configured (no action needed if using repo jest.config.cjs)

- Transformer: `scripts/jest-mikroorm-transformer.cjs` — replaces `import.meta.*` with CJS equivalents
- Transform config in `jest.config.cjs` already handles `@mikro-orm/*` packages
- `transformIgnorePatterns` excludes `@mikro-orm` from ignoring: `'node_modules/(?!(@mikro-orm)/)'`

### If your module has a standalone Jest config

Ensure it includes:

```javascript
module.exports = {
  transform: {
    '^.+\\.(t|j)sx?$': ['<rootDir>/scripts/jest-mikroorm-transformer.cjs', { tsconfig: { jsx: 'react-jsx' } }],
  },
  transformIgnorePatterns: ['node_modules/(?!(@mikro-orm)/)'],
}
```

### tsconfig target

Ensure `target` is `ES2022` or higher (required for v7 class features).

---

## 8. count() Casting

Kysely returns SQL `count(*)` results as strings. When using raw Kysely queries with counts, always cast to `Number`:

```typescript
// WRONG — row.count is a string, arithmetic fails silently
const total = row?.count ?? 0

// CORRECT
const total = Number(row?.count ?? 0)
```

This applies to any raw Kysely `sql` or `selectFrom` query that uses aggregate functions (`count`, `sum`, `avg`).

Note: MikroORM's own `em.count()` and QueryBuilder `.getCount()` return proper numbers — no casting needed there.

---

## 9. Verification

After migrating, run the full validation:

```bash
# 1. Type-check
yarn build:packages

# 2. Lint
yarn lint

# 3. Unit tests
yarn test

# 4. Generate (ensures entities are discoverable)
yarn generate

# 5. Dev server (smoke test)
yarn dev
```

### Self-Review Checklist

- [ ] No imports of decorators from `@mikro-orm/core` — all moved to `@mikro-orm/decorators/legacy`
- [ ] No `persistAndFlush` or `removeAndFlush` calls remain
- [ ] No `getKnex()` or `getConnection().getKnex()` calls remain — all use `em.getKysely<any>()`
- [ ] All Kysely queries end with `.execute()`
- [ ] All raw count results wrapped in `Number()`
- [ ] All JSONB values use `sql` template with `::jsonb` cast
- [ ] `FilterQuery<T>` / `RequiredEntityData<T>` casts added where v7 type errors occur
- [ ] Test mocks updated — no `persistAndFlush` / `removeAndFlush` mocks
- [ ] ORM init (if standalone) sets `metadataProvider: ReflectMetadataProvider`
- [ ] `tsconfig` target is `ES2022` or higher
- [ ] `yarn build:packages` passes
- [ ] `yarn test` passes
