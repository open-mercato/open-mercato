/** @jest-environment node */
// The portfolio grid renders its customer column from `_staff.customerName`,
// which used to come from the project's denormalized snapshot alone. A project
// written with a customer id but no snapshot therefore listed itself as having
// no customer at all. The write path now denormalizes; this enricher is the
// second line of defence for rows written before it did (or around it).
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('../../lib/timesheets-projects/computeProjectHoursTrend', () => ({
  computeProjectHoursTrend: jest.fn(async () => new Map()),
}))

jest.mock('../../lib/timesheets-projects/computeProjectFinancials', () => ({
  computeProjectFinancials: jest.fn(async () => new Map()),
}))

jest.mock('../../lib/timesheets-projects/listProjectMembersPreview', () => ({
  listProjectMembersPreview: jest.fn(async () => new Map()),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichers } from '../enrichers'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_CUSTOMER_ID = '77777777-7777-4777-8777-777777777777'

const portfolioEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-projects-portfolio')!

type ProjectRow = {
  id: string
  customerId?: string | null
  customerSnapshot?: Record<string, unknown> | null
}

type CustomerQuery = { where: Record<string, unknown>; scope: Record<string, unknown> }

function createContext(projects: ProjectRow[]): EnricherContext {
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    userId: 'user-1',
    em: {
      fork: () => ({
        find: async () => projects,
      }),
    },
    container: { resolve: () => undefined },
  } as unknown as EnricherContext
}

function stubCustomers(customers: Array<Record<string, unknown>>): CustomerQuery[] {
  const queries: CustomerQuery[] = []
  mockFindWithDecryption.mockImplementation(
    async (_em: unknown, _entity: unknown, where: Record<string, unknown>, _options: unknown, scope: Record<string, unknown>) => {
      queries.push({ where, scope })
      const ids = ((where.id as { $in?: unknown[] })?.$in ?? []) as string[]
      return customers.filter((customer) => ids.includes(customer.id as string))
    },
  )
  return queries
}

describe('staff.timesheets-projects-portfolio customer name', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves the name from the snapshot without touching the customers module', async () => {
    const queries = stubCustomers([])
    const context = createContext([
      { id: 'project-1', customerId: CUSTOMER_ID, customerSnapshot: { name: 'Alpha Customer' } },
    ])

    const [enriched] = await portfolioEnricher.enrichMany!([{ id: 'project-1' }], context)

    expect((enriched as { _staff: { customerName: string | null } })._staff.customerName).toBe('Alpha Customer')
    expect(queries).toHaveLength(0)
  })

  it('falls back to a live lookup for a project that has a customer id but no snapshot', async () => {
    const queries = stubCustomers([
      { id: CUSTOMER_ID, displayName: 'Alpha Customer', primaryEmail: 'billing@alpha.example' },
      { id: OTHER_CUSTOMER_ID, displayName: null, primaryEmail: 'beata@example.com' },
    ])
    const context = createContext([
      { id: 'project-1', customerId: CUSTOMER_ID, customerSnapshot: null },
      { id: 'project-2', customerId: OTHER_CUSTOMER_ID, customerSnapshot: {} },
      { id: 'project-3', customerId: null, customerSnapshot: null },
    ])

    const enriched = await portfolioEnricher.enrichMany!(
      [{ id: 'project-1' }, { id: 'project-2' }, { id: 'project-3' }],
      context,
    )

    const names = enriched.map((record) => (record as { _staff: { customerName: string | null } })._staff.customerName)
    expect(names).toEqual(['Alpha Customer', 'beata@example.com', null])
    // One scoped query answers the whole page, never one per row.
    expect(queries).toHaveLength(1)
    expect(queries[0].where).toMatchObject({
      id: { $in: [CUSTOMER_ID, OTHER_CUSTOMER_ID] },
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
    expect(queries[0].scope).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('degrades to no name when the customers module cannot answer', async () => {
    mockFindWithDecryption.mockRejectedValue(new Error('customers module not loaded'))
    const context = createContext([{ id: 'project-1', customerId: CUSTOMER_ID, customerSnapshot: null }])

    const [enriched] = await portfolioEnricher.enrichMany!([{ id: 'project-1' }], context)

    expect((enriched as { _staff: { customerName: string | null } })._staff.customerName).toBeNull()
  })
})
