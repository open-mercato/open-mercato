import { describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MetadataStorage } from '@mikro-orm/core'
import { MarketingProductWatch } from '../../data/entities'
import { Migration20261002101500_marketing_watch_rotation } from '../Migration20261002101500_marketing_watch_rotation'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261002101500_marketing_watch_rotation.prototype,
  ) as Migration20261002101500_marketing_watch_rotation
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

describe('Migration20261002101500_marketing_watch_rotation', () => {
  test('keeps the rotation index in entity metadata and the schema snapshot', () => {
    const metadata = Object.values(MetadataStorage.getMetadata()).find(
      (candidate) => candidate.className === MarketingProductWatch.name,
    )
    expect(metadata?.indexes).toContainEqual(expect.objectContaining({
      name: 'mkt_watch_rotation_idx',
      properties: ['tenantId', 'organizationId', 'lastScannedAt'],
    }))

    const snapshot = JSON.parse(readFileSync(join(__dirname, '../.snapshot-open-mercato.json'), 'utf8')) as {
      tables: Array<{ name: string; indexes: Array<{ keyName: string; columnNames: string[] }> }>
    }
    const table = snapshot.tables.find((candidate) => candidate.name === 'marketing_product_watches')
    expect(table?.indexes).toContainEqual(expect.objectContaining({
      keyName: 'mkt_watch_rotation_idx',
      columnNames: ['tenant_id', 'organization_id', 'last_scanned_at'],
    }))
  })

  test('up() adds the rotation column and its index', async () => {
    const statements = await collectSql('up')
    expect(statements).toEqual([
      'alter table "marketing_product_watches" add column "last_scanned_at" timestamptz null;',
      'create index "mkt_watch_rotation_idx" on "marketing_product_watches" '
      + '("tenant_id", "organization_id", "last_scanned_at");',
    ])
  })

  test('down() drops the index before the column', async () => {
    const statements = await collectSql('down')
    expect(statements).toEqual([
      'drop index "mkt_watch_rotation_idx";',
      'alter table "marketing_product_watches" drop column "last_scanned_at";',
    ])
  })
})
