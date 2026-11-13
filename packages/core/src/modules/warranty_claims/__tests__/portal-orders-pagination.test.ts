/** @jest-environment node */
import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'

const mockGetCustomerAuth = jest.fn()
const queries: CompiledQuery[] = []

const db = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createIntrospector: (instance: Kysely<unknown>) => new PostgresIntrospector(instance),
  },
})
const executor = db.getExecutor() as unknown as { executeQuery: (compiled: CompiledQuery) => Promise<unknown> }
executor.executeQuery = async (compiled: CompiledQuery) => {
  queries.push(compiled)
  return { rows: compiled.sql.includes('count(*)') ? [{ total: '45' }] : [] }
}
const em = { fork: () => em, getKysely: () => db }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => em }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...args: unknown[]) => mockGetCustomerAuth(...args),
}))

import { GET } from '../api/portal/orders/route'

describe('portal order picker pagination', () => {
  beforeEach(() => {
    queries.length = 0
    mockGetCustomerAuth.mockResolvedValue({ tenantId: 'tenant-1', orgId: 'org-1', customerEntityId: 'customer-1' })
  })

  it('breaks placed_at ties by id so orders sharing a timestamp land on exactly one page', async () => {
    const response = await GET(new Request('http://localhost/api/warranty_claims/portal/orders?page=2'))
    expect(response.status).toBe(200)
    const listQuery = queries.find((query) => query.sql.includes('order by'))
    expect(listQuery?.sql).toMatch(/order by "placed_at" desc, "id" desc limit \$\d+ offset \$\d+$/)
    expect(listQuery?.parameters).toEqual(['tenant-1', 'org-1', 'customer-1', 20, 20])
  })
})
