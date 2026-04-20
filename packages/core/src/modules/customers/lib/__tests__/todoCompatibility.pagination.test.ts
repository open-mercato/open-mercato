/** @jest-environment node */

import { CustomerInteraction, CustomerTodoLink } from '../../data/entities'
import { listCanonicalTodoRows, listLegacyTodoRows } from '../todoCompatibility'

jest.mock('../interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async ({ interactions }) =>
    interactions.map((row: { id: string }) => ({
      id: row.id,
      interactionType: 'task',
      title: 'Hydrated',
      status: 'planned',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityId: null,
      _integrations: null,
      customValues: null,
    })),
  ),
  loadCustomerSummaries: jest.fn(async () => new Map()),
}))

const TENANT = '00000000-0000-0000-0000-000000000001'
const ORG = '00000000-0000-0000-0000-000000000002'

describe('listCanonicalTodoRows pagination', () => {
  it('pushes pagination to the DB via findAndCount when options.pagination is provided', async () => {
    const findAndCount = jest.fn(async () => [
      [{ id: 'i1', deletedAt: null, organizationId: ORG, tenantId: TENANT }],
      42,
    ])
    const find = jest.fn(async () => [])
    const em = { findAndCount, find } as any
    const container = { resolve: jest.fn() }

    const result = await listCanonicalTodoRows(
      em,
      container,
      { tenantId: TENANT, orgId: ORG },
      ORG,
      [ORG],
      { pagination: { page: 3, pageSize: 25 } },
    )

    expect(findAndCount).toHaveBeenCalledTimes(1)
    expect(find).not.toHaveBeenCalled()
    const [, , findOptions] = findAndCount.mock.calls[0]
    expect(findOptions).toEqual(
      expect.objectContaining({
        offset: 50,
        limit: 25,
        orderBy: { createdAt: 'desc' },
      }),
    )
    expect(result.total).toBe(42)
    expect(result.items).toHaveLength(1)
    expect(result.bridgeIds.has('i1')).toBe(true)
  })

  it('pushes search text to the DB as $ilike on title and body', async () => {
    const findAndCount = jest.fn(async () => [[], 0])
    const em = { findAndCount, find: jest.fn() } as any
    const container = { resolve: jest.fn() }

    await listCanonicalTodoRows(
      em,
      container,
      { tenantId: TENANT, orgId: ORG },
      ORG,
      [ORG],
      { pagination: { page: 1, pageSize: 50 }, searchText: 'Invoice' },
    )

    const [entity, where] = findAndCount.mock.calls[0]
    expect(entity).toBe(CustomerInteraction)
    expect(where).toEqual(
      expect.objectContaining({
        tenantId: TENANT,
        interactionType: 'task',
        $or: [
          { title: { $ilike: '%Invoice%' } },
          { body: { $ilike: '%Invoice%' } },
        ],
      }),
    )
  })

  it('falls back to unpaginated em.find when no pagination is requested', async () => {
    const find = jest.fn(async () => [])
    const em = { find, findAndCount: jest.fn() } as any
    const container = { resolve: jest.fn() }

    const result = await listCanonicalTodoRows(
      em,
      container,
      { tenantId: TENANT, orgId: ORG },
      ORG,
      [ORG],
    )

    expect(find).toHaveBeenCalledTimes(1)
    const [, , findOptions] = find.mock.calls[0]
    expect(findOptions).toEqual({ orderBy: { createdAt: 'desc' } })
    expect(result.total).toBe(0)
  })

  it('honors options.limit without pagination for bounded merged reads', async () => {
    const find = jest.fn(async () => [])
    const em = { find, findAndCount: jest.fn() } as any
    const container = { resolve: jest.fn() }

    await listCanonicalTodoRows(
      em,
      container,
      { tenantId: TENANT, orgId: ORG },
      ORG,
      [ORG],
      { limit: 250 },
    )

    const [, , findOptions] = find.mock.calls[0]
    expect(findOptions).toEqual(
      expect.objectContaining({ limit: 250, orderBy: { createdAt: 'desc' } }),
    )
  })
})

describe('listLegacyTodoRows pagination', () => {
  it('passes limit to em.find when options.limit is provided', async () => {
    const find = jest.fn(async () => [])
    const em = { find } as any
    const queryEngine = { query: jest.fn() } as any

    await listLegacyTodoRows(em, queryEngine, TENANT, [ORG], undefined, { limit: 500 })

    const [entity, , findOptions] = find.mock.calls[0]
    expect(entity).toBe(CustomerTodoLink)
    expect(findOptions).toEqual(
      expect.objectContaining({ limit: 500, orderBy: { createdAt: 'desc' } }),
    )
  })

  it('does not include limit when options.limit is not provided', async () => {
    const find = jest.fn(async () => [])
    const em = { find } as any
    const queryEngine = { query: jest.fn() } as any

    await listLegacyTodoRows(em, queryEngine, TENANT, [ORG], undefined)

    const [, , findOptions] = find.mock.calls[0]
    expect(findOptions.limit).toBeUndefined()
  })
})
