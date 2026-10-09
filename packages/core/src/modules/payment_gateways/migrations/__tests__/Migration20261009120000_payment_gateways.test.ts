import { describe, expect, jest, test } from '@jest/globals'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Migration } from '@mikro-orm/migrations'
import {
  Migration20261009120000_payment_gateways,
  WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE,
} from '../Migration20261009120000_payment_gateways'

type MigrationClass = new (...args: never[]) => Migration

async function collectSql(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(migrationClass.prototype) as Migration
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql.replace(/\s+/g, ' ').trim())),
  })
  await migration[direction]()
  return statements
}

async function loadModuleMigrationsInOrder(): Promise<MigrationClass[]> {
  const migrationsDir = path.resolve(__dirname, '..')
  const files = readdirSync(migrationsDir)
    .filter((file) => /^Migration\d+.*\.ts$/.test(file))
    .sort()
  const classes: MigrationClass[] = []
  for (const file of files) {
    const loaded = (await import(path.join(migrationsDir, file))) as Record<string, unknown>
    const migrationClass = Object.values(loaded).find(
      (value): value is MigrationClass => typeof value === 'function' && value.prototype instanceof Migration,
    )
    if (migrationClass) classes.push(migrationClass)
  }
  return classes
}

describe('Migration20261009120000_payment_gateways', () => {
  test('removes duplicate claims, keeping the earliest processed one, before enforcing uniqueness', async () => {
    const statements = await collectSql(Migration20261009120000_payment_gateways, 'up')

    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('delete from "gateway_webhook_events" duplicate')
    expect(statements[0]).toContain(
      'partition by event."idempotency_key", event."provider_key", event."organization_id", event."tenant_id"',
    )
    expect(statements[0]).toContain('order by event."processed_at" asc, event."id" asc')
    expect(statements[0]).toContain('ranked.claim_rank > 1')
    expect(statements[1]).toContain(`conname = '${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}'`)
    expect(statements[1]).toContain(`drop index if exists "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}"`)
    expect(statements[1]).toContain(
      `add constraint "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}" unique ("idempotency_key", "provider_key", "organization_id", "tenant_id")`,
    )
  })

  test('down restores the previous non-unique index', async () => {
    await expect(collectSql(Migration20261009120000_payment_gateways, 'down')).resolves.toEqual([
      `alter table "gateway_webhook_events" drop constraint if exists "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}";`,
      `create index if not exists "${WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE}" on "gateway_webhook_events" ("idempotency_key", "provider_key", "organization_id", "tenant_id");`,
    ])
  })

  test('the module migration history leaves the webhook idempotency key unique', async () => {
    const migrations = await loadModuleMigrationsInOrder()
    const touching: string[] = []
    for (const migrationClass of migrations) {
      const statements = await collectSql(migrationClass, 'up')
      touching.push(...statements.filter((sql) => sql.includes(WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE)))
    }

    const lastCreate = [...touching]
      .reverse()
      .find((sql) => /create (unique )?index|add constraint/.test(sql))
    expect(lastCreate).toBeDefined()
    expect(lastCreate).toMatch(/create unique index|add constraint "[a-z_]+" unique/)
  })

  test('matches the unique index recorded in the module schema snapshot', () => {
    const snapshot = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', '.snapshot-open-mercato.json'), 'utf8'),
    ) as { tables: Array<{ name: string; indexes: Array<Record<string, unknown>> }> }
    const table = snapshot.tables.find((entry) => entry.name === 'gateway_webhook_events')
    expect(table?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyName: WEBHOOK_EVENTS_IDEMPOTENCY_UNIQUE,
          columnNames: ['idempotency_key', 'provider_key', 'organization_id', 'tenant_id'],
          constraint: true,
          unique: true,
        }),
      ]),
    )
  })
})
