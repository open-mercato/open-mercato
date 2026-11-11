import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261002093000_marketing_run_step_id } from '../Migration20261002093000_marketing_run_step_id'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261002093000_marketing_run_step_id.prototype,
  ) as Migration20261002093000_marketing_run_step_id
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

describe('Migration20261002093000_marketing_run_step_id', () => {
  test('up() adds a nullable current_step_id column', async () => {
    const statements = await collectSql('up')
    expect(statements).toEqual([
      'alter table "marketing_campaign_runs" add column "current_step_id" text null;',
    ])
  })

  test('down() drops the column', async () => {
    const statements = await collectSql('down')
    expect(statements).toEqual([
      'alter table "marketing_campaign_runs" drop column "current_step_id";',
    ])
  })
})
