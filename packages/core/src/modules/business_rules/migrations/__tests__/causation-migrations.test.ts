import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261008080137_business_rules } from '../Migration20261008080137_business_rules'
import { Migration20261008080138_business_rules } from '../Migration20261008080138_business_rules'

type MigrationClass = typeof Migration20261008080137_business_rules | typeof Migration20261008080138_business_rules

async function collectSql(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(migrationClass.prototype) as InstanceType<MigrationClass>
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration[direction]()
  return statements
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

const RUN_INDEX = 'rule_execution_logs_run_idx'

describe('Migration20261008080137_business_rules', () => {
  test('stays transactional so set local lock_timeout applies to the column change', () => {
    const migration = Object.create(Migration20261008080137_business_rules.prototype) as Migration20261008080137_business_rules
    expect(migration.isTransactional()).toBe(true)
  })

  test('up() bounds the lock wait before adding the nullable run columns', async () => {
    const statements = (await collectSql(Migration20261008080137_business_rules, 'up')).map(normalize)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toBe(`set local lock_timeout = '5s';`)
    expect(statements[1]).toContain('alter table "rule_execution_logs"')
    expect(statements[1]).toContain('add "run_id" uuid null')
    expect(statements[1]).toContain('add "rule_version" int null')
    expect(statements[1]).toContain('add "rule_definition_hash" text null')
    expect(statements[1]).toContain('add "causation_json" jsonb null')
    expect(statements[1]).not.toMatch(/\bdefault\b/i)
  })

  test('down() drops every added column', async () => {
    const statements = (await collectSql(Migration20261008080137_business_rules, 'down')).map(normalize)

    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('alter table "rule_execution_logs"')
    for (const column of ['run_id', 'rule_version', 'rule_definition_hash', 'causation_json']) {
      expect(statements[0]).toContain(`drop column "${column}"`)
    }
  })
})

describe('Migration20261008080138_business_rules', () => {
  test('is not transactional because CREATE INDEX CONCURRENTLY cannot run in a transaction block', () => {
    const migration = Object.create(Migration20261008080138_business_rules.prototype) as Migration20261008080138_business_rules
    expect(migration.isTransactional()).toBe(false)
  })

  test('up() drops a possibly INVALID stub concurrently before building the partial run index concurrently', async () => {
    const statements = (await collectSql(Migration20261008080138_business_rules, 'up')).map(normalize)

    expect(statements).toEqual([
      `drop index concurrently if exists "${RUN_INDEX}";`,
      `create index concurrently "${RUN_INDEX}" on "rule_execution_logs" ("tenant_id", "run_id") where "run_id" is not null;`,
    ])
  })

  test('down() drops the run index concurrently', async () => {
    const statements = (await collectSql(Migration20261008080138_business_rules, 'down')).map(normalize)

    expect(statements).toEqual([`drop index concurrently if exists "${RUN_INDEX}";`])
  })
})
