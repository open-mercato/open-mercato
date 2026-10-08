import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261008080137_audit_logs } from '../Migration20261008080137_audit_logs'
import { Migration20261008080138_audit_logs } from '../Migration20261008080138_audit_logs'

type MigrationClass = typeof Migration20261008080137_audit_logs | typeof Migration20261008080138_audit_logs

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

const CAUSE_COLUMNS = ['cause_kind', 'cause_id', 'correlation_id', 'caused_by_log_id']
const CAUSE_INDEXES = [
  { name: 'action_logs_cause_idx', columns: '("tenant_id", "cause_kind", "cause_id", "created_at")' },
  { name: 'action_logs_correlation_idx', columns: '("tenant_id", "correlation_id")' },
  { name: 'action_logs_caused_by_idx', columns: '("caused_by_log_id")' },
]

describe('Migration20261008080137_audit_logs', () => {
  test('stays transactional so set local lock_timeout applies to the column change', () => {
    const migration = Object.create(Migration20261008080137_audit_logs.prototype) as Migration20261008080137_audit_logs
    expect(migration.isTransactional()).toBe(true)
  })

  test('up() bounds the lock wait before adding the nullable cause columns', async () => {
    const statements = (await collectSql(Migration20261008080137_audit_logs, 'up')).map(normalize)

    expect(statements).toHaveLength(2)
    expect(statements[0]).toBe(`set local lock_timeout = '5s';`)
    expect(statements[1]).toContain('alter table "action_logs"')
    expect(statements[1]).toContain('add "cause_kind" text null')
    expect(statements[1]).toContain('add "cause_id" text null')
    expect(statements[1]).toContain('add "correlation_id" uuid null')
    expect(statements[1]).toContain('add "caused_by_log_id" uuid null')
    expect(statements[1]).not.toMatch(/\bdefault\b/i)
  })

  test('down() drops every cause column', async () => {
    const statements = (await collectSql(Migration20261008080137_audit_logs, 'down')).map(normalize)

    expect(statements).toHaveLength(1)
    expect(statements[0]).toContain('alter table "action_logs"')
    for (const column of CAUSE_COLUMNS) {
      expect(statements[0]).toContain(`drop column "${column}"`)
    }
  })
})

describe('Migration20261008080138_audit_logs', () => {
  test('is not transactional because CREATE INDEX CONCURRENTLY cannot run in a transaction block', () => {
    const migration = Object.create(Migration20261008080138_audit_logs.prototype) as Migration20261008080138_audit_logs
    expect(migration.isTransactional()).toBe(false)
  })

  test('up() drops a possibly INVALID stub concurrently right before building each index concurrently', async () => {
    const statements = (await collectSql(Migration20261008080138_audit_logs, 'up')).map(normalize)

    expect(statements).toHaveLength(CAUSE_INDEXES.length * 2)
    CAUSE_INDEXES.forEach((index, position) => {
      expect(statements[position * 2]).toBe(`drop index concurrently if exists "${index.name}";`)
      expect(statements[position * 2 + 1]).toBe(
        `create index concurrently "${index.name}" on "action_logs" ${index.columns};`,
      )
    })
  })

  test('up() never builds an index without CONCURRENTLY', async () => {
    const statements = (await collectSql(Migration20261008080138_audit_logs, 'up')).map(normalize)

    for (const sql of statements) {
      expect(sql).toMatch(/^(drop|create) index concurrently /)
    }
  })

  test('down() drops every cause index concurrently', async () => {
    const statements = (await collectSql(Migration20261008080138_audit_logs, 'down')).map(normalize)

    expect(statements).toHaveLength(CAUSE_INDEXES.length)
    expect(statements).toEqual(expect.arrayContaining(
      CAUSE_INDEXES.map((index) => `drop index concurrently if exists "${index.name}";`),
    ))
  })
})
