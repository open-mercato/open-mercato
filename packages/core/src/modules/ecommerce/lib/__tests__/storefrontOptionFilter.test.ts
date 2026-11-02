import type { EntityManager } from '@mikro-orm/postgresql'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { queryStorefrontOptionProductIds } from '../storefrontOptionFilter'

type EmptyDatabase = Record<string, never>

const SCOPE = { tenantId: '10000000-0000-4000-8000-000000000001', organizationId: '10000000-0000-4000-8000-000000000002' }

function recordingEm(rows: Array<{ product_id: string }> = []): { em: EntityManager; queries: CompiledQuery[] } {
  const queries: CompiledQuery[] = []
  const driver = new DummyDriver()
  const db = new Kysely<EmptyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        ...driver,
        init: async () => {},
        destroy: async () => {},
        acquireConnection: async () => ({
          executeQuery: async (compiled: CompiledQuery) => {
            queries.push(compiled)
            return { rows }
          },
          streamQuery: async function* () {},
        }),
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
      }),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<EmptyDatabase>) => new PostgresIntrospector(instance),
    },
  })
  const em = { getKysely: () => db } as unknown as EntityManager
  return { em, queries }
}

describe('queryStorefrontOptionProductIds', () => {
  it('reads distinct product ids of active variants in the store organization, bounded by the cap', async () => {
    const { em, queries } = recordingEm([{ product_id: 'p-1' }, { product_id: 'p-2' }])
    const ids = await queryStorefrontOptionProductIds(em, SCOPE, { color: ['red', 'blue'], size: ['m'] }, 50)
    expect(ids).toEqual(['p-1', 'p-2'])
    expect(queries).toHaveLength(1)
    const { sql, parameters } = queries[0]
    expect(sql).toMatch(/^select distinct "v"\."product_id" as "product_id" from "catalog_product_variants" as "v"/)
    expect(sql).toContain('"v"."tenant_id" = $1')
    expect(sql).toContain('"v"."organization_id" = $2')
    expect(sql).toContain('"v"."is_active" = $3')
    expect(sql).toContain('"v"."deleted_at" is null')
    expect(sql.match(/"v"\."option_values" ->> \$\d+ = any\(\$\d+::text\[\]\)/g)).toHaveLength(2)
    expect(sql).toMatch(/limit \$\d+$/)
    expect(parameters).toEqual([SCOPE.tenantId, SCOPE.organizationId, true, 'color', ['red', 'blue'], 'size', ['m'], 51])
  })

  it('returns null when more products match than the cap allows', async () => {
    const { em } = recordingEm([{ product_id: 'p-1' }, { product_id: 'p-2' }, { product_id: 'p-3' }])
    await expect(queryStorefrontOptionProductIds(em, SCOPE, { color: ['red'] }, 2)).resolves.toBeNull()
  })

  it('returns the matches when exactly the cap matches', async () => {
    const { em } = recordingEm([{ product_id: 'p-1' }, { product_id: 'p-2' }])
    await expect(queryStorefrontOptionProductIds(em, SCOPE, { color: ['red'] }, 2)).resolves.toEqual(['p-1', 'p-2'])
  })
})
