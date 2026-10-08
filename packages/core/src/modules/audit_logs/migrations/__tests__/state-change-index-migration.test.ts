import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, jest, test } from '@jest/globals'
import { MetadataStorage } from '@mikro-orm/core'
import { Migration20261008160939_audit_logs } from '../Migration20261008160939_audit_logs'
import { ActionLog } from '../../data/entities'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(Migration20261008160939_audit_logs.prototype) as Migration20261008160939_audit_logs
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })
  await migration[direction]()
  return statements
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim()

const INDEX_NAME = 'action_logs_state_change_idx'
const INDEX_SHAPE = `on "action_logs" ("tenant_id", "organization_id", "updated_at", "id") where "execution_state" in ('undone', 'redone')`

type IndexDeclaration = { name?: string; expression?: string }

function declaredIndexes(): IndexDeclaration[] {
  const meta = Object.values(MetadataStorage.getMetadata()).find(
    (candidate) => candidate.className === ActionLog.name,
  )
  expect(meta).toBeDefined()
  return (meta?.indexes ?? []) as IndexDeclaration[]
}

describe('Migration20261008160939_audit_logs', () => {
  test('is not transactional because CREATE INDEX CONCURRENTLY cannot run in a transaction block', () => {
    const migration = Object.create(Migration20261008160939_audit_logs.prototype) as Migration20261008160939_audit_logs
    expect(migration.isTransactional()).toBe(false)
  })

  test('up() drops a possibly INVALID stub concurrently before building the partial index concurrently', async () => {
    const statements = (await collectSql('up')).map(normalize)

    expect(statements).toEqual([
      `drop index concurrently if exists "${INDEX_NAME}";`,
      `create index concurrently "${INDEX_NAME}" ${INDEX_SHAPE};`,
    ])
  })

  test('up() never builds an index without CONCURRENTLY', async () => {
    const statements = (await collectSql('up')).map(normalize)

    for (const sql of statements) {
      expect(sql).toMatch(/^(drop|create) index concurrently /)
    }
  })

  test('down() drops the index concurrently', async () => {
    const statements = (await collectSql('down')).map(normalize)

    expect(statements).toEqual([`drop index concurrently if exists "${INDEX_NAME}";`])
  })
})

describe('action_logs_state_change_idx declaration', () => {
  test('the ActionLog entity declares the same partial index the migration builds', () => {
    const declaration = declaredIndexes().find((index) => index.name === INDEX_NAME)

    expect(declaration).toBeDefined()
    expect(normalize(declaration?.expression ?? '')).toBe(`create index "${INDEX_NAME}" ${INDEX_SHAPE}`)
  })

  test('the module schema snapshot records the same index so db:generate stays quiet', () => {
    const snapshotPath = join(__dirname, '..', '.snapshot-open-mercato.json')
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      tables: Array<{ name: string; indexes: Array<{ keyName: string; expression?: string }> }>
    }
    const table = snapshot.tables.find((candidate) => candidate.name === 'action_logs')
    const index = table?.indexes.find((candidate) => candidate.keyName === INDEX_NAME)

    expect(index).toBeDefined()
    expect(normalize(index?.expression ?? '')).toBe(`create index "${INDEX_NAME}" ${INDEX_SHAPE}`)
  })
})
