import { describe, expect, jest, test } from '@jest/globals'
import { Migration20260824180000_deal_status_lost } from '../Migration20260824180000_deal_status_lost'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20260824180000_deal_status_lost.prototype,
  ) as Migration20260824180000_deal_status_lost
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

describe('Migration20260824180000_deal_status_lost', () => {
  test('rewrites the deal status and stage without touching updated_at', async () => {
    const statements = (await collectSql('up')).map(normalize)
    const dealStatements = statements.filter((sql) => sql.includes('"customer_deals"'))

    expect(dealStatements).toHaveLength(2)
    expect(dealStatements[0]).toBe(
      `update "customer_deals" set "status" = 'lost' where lower("status") = 'loose';`,
    )
    expect(dealStatements[1]).toBe(
      `update "customer_deals" set "pipeline_stage" = 'lost' where lower("pipeline_stage") = 'loose';`,
    )

    // Deliberate and load-bearing: loadDealsSummaryQueryRows windows the win/loss KPI on
    // updated_at and buckets the trend series by date_trunc('month', updated_at), so
    // stamping it here would slam every historical lost deal into the current quarter.
    // The other tables in this migration do set it, which is why this is asserted rather
    // than left to a reader to notice.
    for (const sql of dealStatements) {
      expect(sql).not.toContain('updated_at')
    }
  })

  test('renames a dictionary entry only when the scope has no lost entry already', async () => {
    const statements = (await collectSql('up')).map(normalize)
    const dictionary = statements.find((sql) => sql.includes('"customer_dictionary_entries"'))
    expect(dictionary).toBeDefined()
    const sql = dictionary as string

    expect(sql).toContain(`where e."kind" in ('deal_status', 'pipeline_stage')`)
    expect(sql).toContain(`and e."normalized_value" = 'loose'`)

    // The guard tuple must match customer_dictionary_entries_unique
    // (organization_id, tenant_id, kind, normalized_value) exactly. Dropping any column
    // widens the skip and silently leaves renamable rows behind; dropping the subquery
    // altogether trades that for a unique-violation on any tenant holding both spellings.
    expect(sql).toContain('and not exists')
    expect(sql).toContain('where other."organization_id" = e."organization_id"')
    expect(sql).toContain('and other."tenant_id" = e."tenant_id"')
    expect(sql).toContain('and other."kind" = e."kind"')
    expect(sql).toContain(`and other."normalized_value" = 'lost'`)
  })

  test('corrects the label only while it is still the seeded Loose', async () => {
    const statements = (await collectSql('up')).map(normalize)
    const dictionary = statements.find((sql) => sql.includes('"customer_dictionary_entries"')) as string

    // A tenant that renamed the option keeps its own wording, so this must stay a
    // conditional and never become an unconditional set.
    expect(dictionary).toContain(`"label" = case when e."label" = 'Loose' then 'Lost' else e."label" end`)

    const stages = statements.find((sql) => sql.includes('"customer_pipeline_stages"')) as string
    expect(stages).toContain(`where "name" = 'Loose'`)
  })

  test('down() is an intentional no-op', async () => {
    await expect(collectSql('down')).resolves.toEqual([])
  })
})
