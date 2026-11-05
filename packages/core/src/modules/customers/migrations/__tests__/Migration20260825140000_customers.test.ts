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

const COMMUNICATION_CHANNELS_TABLES = ['message_channel_links', 'external_conversations']

const CHAIN_TABLES_GUARD =
  `do $$ begin if to_regclass('message_channel_links') is null or to_regclass('external_conversations') is null then return; end if;`

describe('Migration20260825140000_customers', () => {
  test('creates the column and the index unconditionally', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements).toHaveLength(3)
    expect(statements[0]).toBe(`alter table "customer_interactions" add column "channel_id" uuid null;`)
    expect(statements[2]).toContain(`create index "customer_interactions_email_channel_idx"`)
  })

  test('names the communication_channels tables only behind an existence guard', async () => {
    // customers does not require communication_channels, so an app without it
    // has neither table. An unguarded reference aborts the whole migrate run.
    const statements = (await collectSql('up')).map(normalize)
    const referencing = statements.filter((sql) =>
      COMMUNICATION_CHANNELS_TABLES.some((table) => sql.includes(table)),
    )

    expect(referencing).toHaveLength(1)
    // Asserted as one exact prefix: a guard that checks only one table, or that
    // falls through into the update instead of returning, must fail here.
    expect(referencing[0].startsWith(CHAIN_TABLES_GUARD)).toBe(true)
    expect(referencing[0].endsWith('end $$;')).toBe(true)
  })

  test('backfills only unset email rows, scoped by tenant on both joins', async () => {
    const statements = (await collectSql('up')).map(normalize)
    const backfill = statements[1]

    expect(backfill).toContain('update "customer_interactions" ci set "channel_id" = ec."channel_id"')
    expect(backfill).toContain('from "message_channel_links" mcl join "external_conversations" ec')
    expect(backfill).toContain('on ec."id" = mcl."external_conversation_id" and ec."tenant_id" = mcl."tenant_id"')
    expect(backfill).toContain('where ci."external_message_id" = mcl."id" and ci."tenant_id" = mcl."tenant_id"')
    expect(backfill).toContain(`and ci."interaction_type" = 'email' and ci."channel_id" is null;`)
  })

  test('down() drops the index and the column', async () => {
    const statements = (await collectSql('down')).map(normalize)

    expect(statements).toEqual([
      `drop index if exists "customer_interactions_email_channel_idx";`,
      `alter table "customer_interactions" drop column if exists "channel_id";`,
    ])
  })
})
