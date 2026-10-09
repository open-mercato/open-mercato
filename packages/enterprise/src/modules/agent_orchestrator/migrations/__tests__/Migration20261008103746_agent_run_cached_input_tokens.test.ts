import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261008103746_agent_run_cached_input_tokens } from '../Migration20261008103746_agent_run_cached_input_tokens'
import { readSquashMigrationSql } from '../../__tests__/helpers/squashMigration'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261008103746_agent_run_cached_input_tokens.prototype,
  ) as Migration20261008103746_agent_run_cached_input_tokens
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql.replace(/\s+/g, ' ').trim())),
  })
  await migration[direction]()
  return statements
}

describe('Migration20261008103746_agent_run_cached_input_tokens', () => {
  test('up adds a nullable cached_input_tokens column and tolerates an already-present one', async () => {
    await expect(collectSql('up')).resolves.toEqual([
      'alter table "agent_runs" add column if not exists "cached_input_tokens" int null;',
    ])
  })

  test('down drops only the cached_input_tokens column and tolerates its absence', async () => {
    await expect(collectSql('down')).resolves.toEqual([
      'alter table "agent_runs" drop column if exists "cached_input_tokens";',
    ])
  })

  test('stacks after the shipped squash, which never creates the column', () => {
    const squashSql = readSquashMigrationSql()
    expect(squashSql).toContain('create table "agent_runs"')
    expect(squashSql).not.toContain('cached_input_tokens')
  })
})
