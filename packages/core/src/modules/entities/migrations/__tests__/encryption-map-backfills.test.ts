import { describe, expect, jest, test } from '@jest/globals'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'
import { Migration20260722120000 } from '../Migration20260722120000'
import { Migration20260822120000 } from '../Migration20260822120000'

type BackfillMigration = { up(): Promise<void> }

async function collectUpSql(prototype: object): Promise<string[]> {
  const migration = Object.create(prototype) as BackfillMigration
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration.up()
  return statements
}

describe('entities encryption map backfill migrations', () => {
  test('Migration20260722120000 backfills the devices push token map', async () => {
    const statements = await collectUpSql(Migration20260722120000.prototype)

    expect(statements).toEqual([
      buildEncryptionMapBackfillSql({ entityId: 'devices:user_device', fields: [{ field: 'push_token' }] }),
    ])
  })

  test('Migration20260822120000 backfills both phone_calls maps', async () => {
    const statements = await collectUpSql(Migration20260822120000.prototype)

    expect(statements).toEqual([
      buildEncryptionMapBackfillSql({
        entityId: 'phone_calls:phone_call',
        fields: [{ field: 'raw_snapshot' }, { field: 'provider_facts' }, { field: 'recording_url' }],
      }),
      buildEncryptionMapBackfillSql({
        entityId: 'phone_calls:phone_call_participant',
        fields: [{ field: 'phone_number' }, { field: 'display_name' }, { field: 'email' }],
      }),
    ])
  })
})
