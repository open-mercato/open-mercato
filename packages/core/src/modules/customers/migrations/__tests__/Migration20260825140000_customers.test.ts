import { describe, expect, jest, test } from '@jest/globals'
import { Migration20260825140000_customers } from '../Migration20260825140000_customers'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20260825140000_customers.prototype,
  ) as Migration20260825140000_customers
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('Migration20260825140000_customers', () => {
  test('backfills channel ids only when the optional communication_channels tables exist', async () => {
    const statements = (await collectSql('up')).map(normalize)
    const backfill = statements.find((sql) => sql.includes('"message_channel_links"'))

    expect(backfill).toBeDefined()
    expect(backfill).toMatch(/^do \$\$ begin if to_regclass\('message_channel_links'\) is not null and to_regclass\('external_conversations'\) is not null then update "customer_interactions"/)
    expect(backfill).toMatch(/end if; end \$\$;$/)
  })

  test('keeps the column and index changes unconditional', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements[0]).toBe('alter table "customer_interactions" add column "channel_id" uuid null;')
    expect(statements[statements.length - 1]).toContain('create index "customer_interactions_email_channel_idx"')
    expect(statements.filter((sql) => sql.includes('"message_channel_links"'))).toHaveLength(1)
  })
})
