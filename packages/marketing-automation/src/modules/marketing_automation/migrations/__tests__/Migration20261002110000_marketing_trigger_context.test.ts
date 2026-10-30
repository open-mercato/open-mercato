import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261002110000_marketing_trigger_context } from '../Migration20261002110000_marketing_trigger_context'

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261002110000_marketing_trigger_context.prototype,
  ) as Migration20261002110000_marketing_trigger_context
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements.map(normalize)
}

describe('Migration20261002110000_marketing_trigger_context', () => {
  test('up() adds the column, backfills it from context->trigger, then removes the plaintext key', async () => {
    const statements = await collectSql('up')
    expect(statements).toEqual([
      'alter table "marketing_campaign_runs" add column "trigger_context" json null;',
      "update \"marketing_campaign_runs\" set \"trigger_context\" = \"context\" -> 'trigger' "
      + "where jsonb_typeof(\"context\" -> 'trigger') = 'object' and \"context\" -> 'trigger' <> '{}'::jsonb;",
      "update \"marketing_campaign_runs\" set \"context\" = \"context\" - 'trigger';",
    ])
  })

  test('up() only backfills rows where context->trigger is a non-empty object', async () => {
    const [, backfillSql] = await collectSql('up')
    expect(backfillSql).toContain("jsonb_typeof(\"context\" -> 'trigger') = 'object'")
    expect(backfillSql).toContain("\"context\" -> 'trigger' <> '{}'::jsonb")
  })

  test('down() merges trigger_context back into context before dropping the column', async () => {
    const statements = await collectSql('down')
    expect(statements[0]).toContain(
      "\"context\" = \"context\" || jsonb_build_object('trigger', coalesce(\"trigger_context\"::jsonb, '{}'::jsonb))",
    )
    expect(statements[0]).toContain('where "trigger_context" is not null;')
    expect(statements[1]).toBe('alter table "marketing_campaign_runs" drop column "trigger_context";')
  })
})
