/** @jest-environment node */

import { CustomerInteraction, CustomerTodoLink } from '../../data/entities'
import { listCanonicalTodoRows, listLegacyTodoRows } from '../todoCompatibility'

jest.mock('../interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
  loadCustomerSummaries: jest.fn(async () => new Map()),
}))

const TENANT = '00000000-0000-0000-0000-000000000001'
const ORG = '00000000-0000-0000-0000-000000000002'

function createEm() {
  return {
    find: jest.fn(async () => []),
    findAndCount: jest.fn(async () => [[], 0]),
    count: jest.fn(async () => 0),
  }
}

describe('todoCompatibility organization scoping', () => {
  it.each([null, [] as string[]])(
    'listLegacyTodoRows returns empty and does not query when restricted has organizationIds=%p',
    async (organizationIds) => {
      const em = createEm()
      const queryEngine = { query: jest.fn() } as any

      const rows = await listLegacyTodoRows(em as any, queryEngine, TENANT, organizationIds, undefined, {
        isUnrestricted: false,
      })

      expect(rows).toEqual([])
      expect(em.find).not.toHaveBeenCalled()
      expect(queryEngine.query).not.toHaveBeenCalled()
    },
  )

  it('listLegacyTodoRows fails closed when isUnrestricted is omitted and organizationIds is null', async () => {
    const em = createEm()
    const queryEngine = { query: jest.fn() } as any

    const rows = await listLegacyTodoRows(em as any, queryEngine, TENANT, null, undefined)

    expect(rows).toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })

  it.each([null, [] as string[]])(
    'listLegacyTodoRows queries tenant-wide when unrestricted has organizationIds=%p',
    async (organizationIds) => {
      const em = createEm()
      const queryEngine = { query: jest.fn() } as any

      await listLegacyTodoRows(em as any, queryEngine, TENANT, organizationIds, undefined, {
        isUnrestricted: true,
      })

      expect(em.find).toHaveBeenCalledTimes(1)
      expect(em.find.mock.calls[0][0]).toBe(CustomerTodoLink)
      expect(em.find.mock.calls[0][1]).toEqual({ tenantId: TENANT })
    },
  )

  it('listLegacyTodoRows applies $in when organizationIds is provided', async () => {
    const em = createEm()
    const queryEngine = { query: jest.fn() } as any

    await listLegacyTodoRows(em as any, queryEngine, TENANT, [ORG], undefined, {
      isUnrestricted: false,
    })

    expect(em.find.mock.calls[0][1]).toEqual({
      tenantId: TENANT,
      organizationId: { $in: [ORG] },
    })
  })

  it.each([null, [] as string[]])(
    'listCanonicalTodoRows returns empty and does not query when restricted has organizationIds=%p',
    async (organizationIds) => {
      const em = createEm()
      const container = { resolve: jest.fn() }

      const result = await listCanonicalTodoRows(
        em as any,
        container,
        { tenantId: TENANT, orgId: null },
        null,
        organizationIds,
        { isUnrestricted: false },
      )

      expect(result).toEqual({ items: [], bridgeIds: new Set(), total: 0 })
      expect(em.find).not.toHaveBeenCalled()
      expect(em.findAndCount).not.toHaveBeenCalled()
    },
  )

  it.each([null, [] as string[]])(
    'listCanonicalTodoRows queries tenant-wide when unrestricted has organizationIds=%p',
    async (organizationIds) => {
      const em = createEm()
      const container = { resolve: jest.fn() }

      await listCanonicalTodoRows(
        em as any,
        container,
        { tenantId: TENANT, orgId: null },
        null,
        organizationIds,
        { isUnrestricted: true },
      )

      expect(em.find).toHaveBeenCalledTimes(1)
      expect(em.find.mock.calls[0][0]).toBe(CustomerInteraction)
      expect(em.find.mock.calls[0][1]).toEqual({
        tenantId: TENANT,
        interactionType: 'task',
        deletedAt: null,
      })
    },
  )

  it('listCanonicalTodoRows applies $in when organizationIds is provided', async () => {
    const em = createEm()
    const container = { resolve: jest.fn() }

    await listCanonicalTodoRows(
      em as any,
      container,
      { tenantId: TENANT, orgId: ORG },
      ORG,
      [ORG],
      { isUnrestricted: false },
    )

    expect(em.find.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        tenantId: TENANT,
        organizationId: { $in: [ORG] },
      }),
    )
  })
})
