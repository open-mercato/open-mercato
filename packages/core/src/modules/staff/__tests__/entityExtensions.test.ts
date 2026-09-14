/** @jest-environment node */
/**
 * EP-44 — pins `data/extensions.ts` to the physical schema and to the decoupling rule.
 *
 * An `EntityExtension` is a declaration with no compiler or ORM check behind it: nothing
 * links `base`, `extension`, `join.baseKey`, `join.extensionKey` or `table` to a real
 * table or column, so a typo only surfaces as a SQL error the first time something joins
 * it. These assertions read the migration snapshots — the authoritative record of what
 * the migrations created — and fail on any of those fields drifting.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import entityExtensions from '../data/extensions'

const moduleRoot = path.join(__dirname, '..')

function moduleRootOf(entitiesModuleSpecifier: string): string {
  return path.join(path.dirname(require.resolve(entitiesModuleSpecifier)), '..')
}

function readSnapshotTables(snapshotPath: string): Record<string, string[]> {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
    tables: Array<{ name: string; columns: Record<string, unknown> }>
  }
  return Object.fromEntries(snapshot.tables.map((table) => [table.name, Object.keys(table.columns)]))
}

const staffTables = readSnapshotTables(path.join(moduleRoot, 'migrations', '.snapshot-open-mercato.json'))
const baseTablesByModule: Record<string, Record<string, string[]>> = {
  customers: readSnapshotTables(
    path.join(moduleRootOf('@open-mercato/core/modules/customers/data/entities'), 'migrations', '.snapshot-open-mercato.json'),
  ),
  sales: readSnapshotTables(
    path.join(moduleRootOf('@open-mercato/core/modules/sales/data/entities'), 'migrations', '.snapshot-open-mercato.json'),
  ),
}

describe('staff data/extensions.ts', () => {
  it('declares the four time-tracking foreign-key links', () => {
    expect(entityExtensions.map((link) => `${link.base} -> ${link.extension}.${link.join.extensionKey}`)).toEqual([
      'customers:customer_entity -> staff:staff_time_entry.customer_id',
      'customers:customer_deal -> staff:staff_time_entry.deal_id',
      'sales:sales_order -> staff:staff_time_entry.order_id',
      'customers:customer_entity -> staff:staff_time_project.customer_id',
    ])
  })

  it('owns every extension side and never the base side', () => {
    for (const link of entityExtensions) {
      expect(link.extension.split(':')[0]).toBe('staff')
      expect(link.base.split(':')[0]).not.toBe('staff')
    }
  })

  it('names an extension table that exists and carries the join column', () => {
    for (const link of entityExtensions) {
      expect(link.table).toBeDefined()
      expect(Object.keys(staffTables)).toContain(link.table)
      expect(staffTables[link.table!]).toContain(link.join.extensionKey)
    }
  })

  it('keeps the declared table in step with the ORM entity that owns it', () => {
    const entitiesSource = fs.readFileSync(path.join(moduleRoot, 'data', 'entities.ts'), 'utf8')
    for (const link of entityExtensions) {
      expect(entitiesSource).toContain(`@Entity({ tableName: '${link.table}' })`)
    }
  })

  it('names a base table that exists in the owning module and carries the join column', () => {
    for (const link of entityExtensions) {
      const [baseModule] = link.base.split(':')
      const baseTables = baseTablesByModule[baseModule]
      expect(baseTables).toBeDefined()
      const baseTable = resolveEntityTableName(undefined, link.base)
      expect(Object.keys(baseTables)).toContain(baseTable)
      expect(baseTables[baseTable]).toContain(link.join.baseKey)
    }
  })

  /**
   * The decoupling rule this module lives under: a link is strings, never an import.
   * Staff is slated for extraction into its own package, so a `customers` or `sales`
   * import here — or a new `requires` entry — would break that extraction.
   */
  it('imports nothing from the modules it links to', () => {
    const source = fs.readFileSync(path.join(moduleRoot, 'data', 'extensions.ts'), 'utf8')
    const importSpecifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    expect(importSpecifiers).toEqual(['@open-mercato/shared/modules/entities'])
  })

  it('does not make staff depend on customers or sales', () => {
    const indexSource = fs.readFileSync(path.join(moduleRoot, 'index.ts'), 'utf8')
    const requires = /requires:\s*\[([^\]]*)\]/.exec(indexSource)?.[1] ?? ''
    expect(requires).not.toContain('customers')
    expect(requires).not.toContain('sales')
  })
})
