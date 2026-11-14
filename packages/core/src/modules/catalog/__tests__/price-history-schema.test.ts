import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { priceHistoryEntrySchema } from '../lib/omnibusTypes'

const moduleRoot = join(__dirname, '..')
const migrationsDir = join(moduleRoot, 'migrations')
const tableName = 'catalog_price_history_entries'

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').toLowerCase()
}

function readHistoryMigration(): string {
  const matches = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .filter((source) => source.includes(`create table "${tableName}"`))
  expect(matches).toHaveLength(1)
  return matches[0]
}

function migrationSection(source: string, method: 'up' | 'down'): string {
  const start = source.indexOf(`override ${method}()`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start)
  const nextOverride = rest.indexOf('override ', 1)
  return nextOverride >= 0 ? rest.slice(0, nextOverride) : rest
}

function historyEntityBlock(): string {
  const source = readFileSync(join(moduleRoot, 'data', 'entities.ts'), 'utf8')
  const match = /export class CatalogPriceHistoryEntry\b/.exec(source)
  expect(match).not.toBeNull()
  const decoratorStart = source.lastIndexOf(`@Entity({ tableName: '${tableName}' })`, match!.index)
  expect(decoratorStart).toBeGreaterThanOrEqual(0)
  const rest = source.slice(match!.index + match![0].length)
  const nextIdx = rest.search(/\n(@Entity|export (class|type|const|function|interface) )/)
  return source.slice(decoratorStart, match!.index + match![0].length) + (nextIdx >= 0 ? rest.slice(0, nextIdx) : rest)
}

function readSnapshotTable(): {
  columns: Record<string, unknown>
  indexes: Array<{ keyName: string; expression?: string }>
} | undefined {
  const snapshot = JSON.parse(readFileSync(join(migrationsDir, '.snapshot-open-mercato.json'), 'utf8')) as {
    tables: Array<{ name: string; columns: Record<string, unknown>; indexes: Array<{ keyName: string; expression?: string }> }>
  }
  return snapshot.tables.find((table) => table.name === tableName)
}

const lookbackIndexes: Array<{ name: string; columns: string }> = [
  {
    name: 'catalog_price_history_product_idx',
    columns: '("tenant_id", "organization_id", "product_id", "price_kind_id", "currency_code", "recorded_at" desc)',
  },
  {
    name: 'catalog_price_history_product_channel_idx',
    columns: '("tenant_id", "organization_id", "product_id", "channel_id", "price_kind_id", "currency_code", "recorded_at" desc)',
  },
  {
    name: 'catalog_price_history_variant_idx',
    columns: '("tenant_id", "organization_id", "variant_id", "price_kind_id", "currency_code", "recorded_at" desc)',
  },
  {
    name: 'catalog_price_history_variant_channel_idx',
    columns: '("tenant_id", "organization_id", "variant_id", "channel_id", "price_kind_id", "currency_code", "recorded_at" desc)',
  },
  {
    name: 'catalog_price_history_offer_idx',
    columns: '("tenant_id", "organization_id", "offer_id", "price_kind_id", "currency_code", "recorded_at" desc)',
  },
  {
    name: 'catalog_price_history_price_idx',
    columns: '("tenant_id", "organization_id", "price_id")',
  },
]

describe('catalog price history schema (omnibus)', () => {
  describe('migration', () => {
    it('creates every lookback index with a trailing recorded_at desc', () => {
      const up = normalizeSql(migrationSection(readHistoryMigration(), 'up'))
      for (const index of lookbackIndexes) {
        expect(up).toContain(`create index "${index.name}" on "${tableName}" ${index.columns}`)
      }
    })

    it('creates the partial unique idempotency index', () => {
      const up = normalizeSql(migrationSection(readHistoryMigration(), 'up'))
      expect(up).toContain(
        `create unique index "catalog_price_history_idempotency_uq" on "${tableName}" ("tenant_id", "organization_id", "idempotency_key") where "idempotency_key" is not null`,
      )
    })

    it('appends the marked manual immutability trigger that blocks update and delete', () => {
      const source = readHistoryMigration()
      expect(source).toContain('-- MANUAL DDL: immutability trigger and role restriction')
      const up = normalizeSql(migrationSection(source, 'up'))
      expect(up).toContain('create or replace function catalog_price_history_prevent_modification() returns trigger')
      expect(up).toContain(`raise exception '${tableName} is immutable'`)
      expect(up).toContain(
        `create or replace trigger history_immutable before update or delete on ${tableName} for each row execute function catalog_price_history_prevent_modification()`,
      )
      expect(up).toContain(`-- revoke update, delete on ${tableName} from <app_db_role>;`)
    })

    it('has no database default on recorded_at', () => {
      const up = normalizeSql(migrationSection(readHistoryMigration(), 'up'))
      expect(up).toContain('"recorded_at" timestamptz not null,')
      expect(up).not.toMatch(/"recorded_at" timestamptz[^,]*default/)
    })

    it('constrains change_type and source to the spec enums', () => {
      const up = normalizeSql(migrationSection(readHistoryMigration(), 'up'))
      expect(up).toContain(`check ("change_type" in ('create', 'update', 'delete', 'undo'))`)
      expect(up).toContain(`check ("source" in ('api', 'system'))`)
    })

    it('drops trigger, then function, then table on down', () => {
      const down = normalizeSql(migrationSection(readHistoryMigration(), 'down'))
      const triggerAt = down.indexOf(`drop trigger if exists history_immutable on ${tableName}`)
      const functionAt = down.indexOf('drop function if exists catalog_price_history_prevent_modification()')
      const tableAt = down.indexOf(`drop table if exists "${tableName}"`)
      expect(triggerAt).toBeGreaterThanOrEqual(0)
      expect(functionAt).toBeGreaterThan(triggerAt)
      expect(tableAt).toBeGreaterThan(functionAt)
    })
  })

  describe('entity', () => {
    it('is append-only with no created_at, updated_at or deleted_at columns', () => {
      const block = historyEntityBlock()
      expect(block).not.toMatch(/name:\s*['"](created_at|updated_at|deleted_at)['"]/)
      expect(block).not.toMatch(/onCreate|onUpdate/)
    })

    it('stores foreign keys as plain ids without ORM relations', () => {
      const block = historyEntityBlock()
      expect(block).not.toMatch(/@(ManyToOne|OneToMany|OneToOne|ManyToMany)\b/)
    })

    it('declares every lookback index', () => {
      const block = historyEntityBlock()
      for (const index of lookbackIndexes) {
        expect(block).toContain(`name: '${index.name}'`)
      }
    })

    it('declares the partial idempotency index the duplicate-capture handling relies on', () => {
      expect(historyEntityBlock()).toContain("name: 'catalog_price_history_idempotency_uq'")
    })
  })

  describe('snapshot', () => {
    it('records the table and lookback indexes but not the manual DDL', () => {
      const table = readSnapshotTable()
      expect(table).toBeDefined()
      const indexNames = table!.indexes.map((index) => index.keyName)
      for (const index of lookbackIndexes) {
        expect(indexNames).toContain(index.name)
      }
      const idempotency = table!.indexes.find((index) => index.keyName === 'catalog_price_history_idempotency_uq')
      expect(idempotency?.expression).toBe(
        'create unique index "catalog_price_history_idempotency_uq" on "catalog_price_history_entries" ("tenant_id", "organization_id", "idempotency_key") where "idempotency_key" is not null',
      )
      expect(Object.keys(table!.columns)).not.toEqual(expect.arrayContaining(['updated_at']))
      expect(Object.keys(table!.columns)).not.toEqual(expect.arrayContaining(['deleted_at']))
    })
  })

  describe('priceHistoryEntrySchema', () => {
    const validEntry = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      priceId: '33333333-3333-4333-8333-333333333333',
      productId: '44444444-4444-4444-8444-444444444444',
      variantId: null,
      offerId: null,
      channelId: null,
      priceKindId: '55555555-5555-4555-8555-555555555555',
      priceKindCode: 'regular',
      currencyCode: 'EUR',
      unitPriceNet: '81.3008',
      unitPriceGross: '100.0000',
      taxRate: '23.0000',
      taxAmount: '18.6992',
      minQuantity: 1,
      maxQuantity: null,
      startsAt: null,
      endsAt: null,
      recordedAt: new Date('2026-10-05T12:00:00.000Z'),
      changeType: 'create',
      source: 'api',
      isAnnounced: false,
      idempotencyKey: 'a'.repeat(64),
      metadata: null,
    }

    it('accepts a complete entry', () => {
      expect(priceHistoryEntrySchema.safeParse(validEntry).success).toBe(true)
    })

    it('rejects unknown change types and sources', () => {
      expect(priceHistoryEntrySchema.safeParse({ ...validEntry, changeType: 'restore' }).success).toBe(false)
      expect(priceHistoryEntrySchema.safeParse({ ...validEntry, source: 'import' }).success).toBe(false)
    })

    it('requires a product id and a three-letter currency', () => {
      expect(priceHistoryEntrySchema.safeParse({ ...validEntry, productId: null }).success).toBe(false)
      expect(priceHistoryEntrySchema.safeParse({ ...validEntry, currencyCode: 'EURO' }).success).toBe(false)
    })
  })
})
