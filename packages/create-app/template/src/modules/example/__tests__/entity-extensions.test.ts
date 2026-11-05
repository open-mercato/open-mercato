/** @jest-environment node */
/**
 * Pins `data/extensions.ts` to the physical schema.
 *
 * An `EntityExtension` is a declaration with no compiler or ORM check behind it:
 * nothing links `base`, `extension`, `join.baseKey`, `join.extensionKey` or
 * `table` to a real table or column, so a typo only surfaces as a SQL error the
 * first time something joins the extension. These assertions read the two
 * migration snapshots — the authoritative record of what the migrations actually
 * created — and fail on any of those five fields drifting.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import entityExtensions from '../data/extensions'

const moduleRoot = path.join(__dirname, '..')
const customersModuleRoot = path.join(
  path.dirname(require.resolve('@open-mercato/core/modules/customers/data/entities')),
  '..',
)

function readSnapshotTables(snapshotPath: string): Record<string, string[]> {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
    tables: Array<{ name: string; columns: Record<string, unknown> }>
  }
  return Object.fromEntries(snapshot.tables.map((table) => [table.name, Object.keys(table.columns)]))
}

const exampleTables = readSnapshotTables(
  path.join(moduleRoot, 'migrations', '.snapshot-open-mercato.json'),
)
const customersTables = readSnapshotTables(
  path.join(customersModuleRoot, 'migrations', '.snapshot-open-mercato.json'),
)

describe('example data/extensions.ts', () => {
  it('declares the customer priority link owned by this module', () => {
    expect(entityExtensions).toHaveLength(1)
    const [link] = entityExtensions
    expect(link.extension.split(':')[0]).toBe('example')
    expect(link.base.split(':')[0]).toBe('customers')
  })

  it('names an extension table that exists and carries the join column', () => {
    const [link] = entityExtensions
    expect(link.table).toBeDefined()
    expect(Object.keys(exampleTables)).toContain(link.table)
    expect(exampleTables[link.table!]).toContain(link.join.extensionKey)
  })

  it('keeps the declared table in step with the ORM entity that owns it', () => {
    const [link] = entityExtensions
    const entitiesSource = fs.readFileSync(path.join(moduleRoot, 'data', 'entities.ts'), 'utf8')
    expect(entitiesSource).toContain(`@Entity({ tableName: '${link.table}' })`)
  })

  it('needs the table override because the engine join derivation misses it', () => {
    // BasicQueryEngine's extension join derives the table as `<entity segment>s`.
    // The override is load-bearing exactly while that name is not a real table.
    const [link] = entityExtensions
    const [, extensionName] = link.extension.split(':')
    expect(Object.keys(exampleTables)).not.toContain(`${extensionName}s`)
  })

  it('names a base table that exists in the customers schema and carries the join column', () => {
    const [link] = entityExtensions
    const baseTable = resolveEntityTableName(undefined, link.base)
    expect(Object.keys(customersTables)).toContain(baseTable)
    expect(customersTables[baseTable]).toContain(link.join.baseKey)
  })
})
