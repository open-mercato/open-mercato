import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { refreshCoverageSnapshot } from '../lib/coverage'

/**
 * `organizations` has no `organization_id` column, yet its index rows carry one derived
 * from the record id (`deriveOrgFromId`). Filtering only the index side compared two
 * different populations and produced a permanent "out of sync" row no reindex could clear;
 * bailing out instead left the previous snapshot frozen with the same effect.
 */
function makeEm(options: {
  table: string
  columns: string[]
  baseCount: number
  indexCount: number
}) {
  const statements: CompiledQuery[] = []

  const respond = (compiled: CompiledQuery): unknown[] => {
    const text = compiled.sql
    if (text.includes('information_schema')) {
      const column = String(compiled.parameters[compiled.parameters.length - 1] ?? '')
      return options.columns.includes(column) ? [{ present: 1 }] : []
    }
    if (text.includes('from "entity_indexes"')) return [{ count: options.indexCount }]
    if (text.includes(`from "${options.table}"`)) return [{ count: options.baseCount }]
    if (text.includes('entity_index_coverage')) return []
    return []
  }

  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => undefined,
        acquireConnection: async () => ({
          executeQuery: async (compiled: CompiledQuery) => {
            statements.push(compiled)
            return { rows: respond(compiled), numAffectedRows: BigInt(0) }
          },
          streamQuery: async function* () { /* not used */ },
        }),
        beginTransaction: async () => undefined,
        commitTransaction: async () => undefined,
        rollbackTransaction: async () => undefined,
        releaseConnection: async () => undefined,
        destroy: async () => undefined,
      }),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  const em: any = {
    getKysely: () => db,
    getMetadata: () => ({
      find: () => ({ tableName: options.table }),
      getAll: () => [{ className: 'Organization', tableName: options.table }],
    }),
  }
  return { em, statements }
}

function indexCountStatement(statements: CompiledQuery[]): CompiledQuery | undefined {
  return statements.find((entry) => entry.sql.includes('from "entity_indexes"'))
}

describe('refreshCoverageSnapshot scope symmetry', () => {
  it('does not narrow the index side by a column the base table lacks', async () => {
    const { em, statements } = makeEm({
      // Unique table name per test: the column lookup is process-cached.
      table: 'organizations_symmetry_a',
      columns: ['id', 'tenant_id'],
      baseCount: 1,
      indexCount: 1,
    })

    const counts = await refreshCoverageSnapshot(em, {
      entityType: 'directory:organization',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      withDeleted: false,
    })

    expect(counts).toEqual({ baseCount: 1, indexedCount: 1 })
    const indexQuery = indexCountStatement(statements)
    expect(indexQuery?.sql).not.toContain('"organization_id"')
    expect(indexQuery?.sql).toContain('"tenant_id"')
  })

  it('still scopes both sides when the base table has the column', async () => {
    const { em, statements } = makeEm({
      table: 'organizations_symmetry_b',
      columns: ['id', 'tenant_id', 'organization_id'],
      baseCount: 4,
      indexCount: 4,
    })

    const counts = await refreshCoverageSnapshot(em, {
      entityType: 'example:todo',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      withDeleted: false,
    })

    expect(counts).toEqual({ baseCount: 4, indexedCount: 4 })
    expect(indexCountStatement(statements)?.sql).toContain('"organization_id"')
  })
})
