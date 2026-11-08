import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const INDEX_NAME = 'attachments_storage_metadata_gin_idx'
const INDEX_DEFINITION = `create index "${INDEX_NAME}" on "attachments" using gin ("storage_metadata" jsonb_path_ops)`
const migrationsDir = join(__dirname, '..', 'migrations')

function readIndexMigration(): string {
  const matches = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .filter((source) => source.includes(`create index concurrently "${INDEX_NAME}"`))
  expect(matches).toHaveLength(1)
  return matches[0]
}

describe('attachments.storage_metadata GIN index migration', () => {
  it('builds concurrently outside a transaction and drops a stale invalid stub first', () => {
    const source = readIndexMigration()
    expect(source).toMatch(/isTransactional\(\): boolean \{\s*return false\s*\}/)
    const dropAt = source.indexOf(`drop index concurrently if exists "${INDEX_NAME}"`)
    const createAt = source.indexOf(`create index concurrently "${INDEX_NAME}"`)
    expect(dropAt).toBeGreaterThanOrEqual(0)
    expect(dropAt).toBeLessThan(createAt)
    expect(source).not.toContain(`create index concurrently if not exists "${INDEX_NAME}"`)
  })

  it('uses the jsonb_path_ops opclass the containment probe needs, as declared on the entity and snapshot', () => {
    const source = readIndexMigration()
    expect(source).toContain(INDEX_DEFINITION.replace('create index', 'create index concurrently'))
    const entities = readFileSync(join(__dirname, '..', 'data', 'entities.ts'), 'utf8')
    expect(entities).toContain(INDEX_DEFINITION)
    const snapshot = JSON.parse(readFileSync(join(migrationsDir, '.snapshot-open-mercato.json'), 'utf8')) as {
      tables: Array<{ name: string; indexes: Array<{ keyName: string; expression?: string }>; columns: Record<string, { nullable: boolean; type: string }> }>
    }
    const attachments = snapshot.tables.find((table) => table.name === 'attachments')
    expect(attachments?.indexes.find((index) => index.keyName === INDEX_NAME)?.expression).toBe(INDEX_DEFINITION)
    const partitions = snapshot.tables.find((table) => table.name === 'attachment_partitions')
    expect(partitions?.columns.library_excluded_entities).toMatchObject({ type: 'jsonb', nullable: true })
  })
})
