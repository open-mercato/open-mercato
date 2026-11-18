/** @jest-environment node */

type CapturedListConfig = {
  entityId?: string
  disableListCache?: boolean
}

const captured: CapturedListConfig[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: { list?: CapturedListConfig }) => {
    if (config.list) captured.push(config.list)
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))

const ROUTES = ['buildings', 'floors', 'spaces', 'common-areas', 'units', 'leases', 'bookings'] as const

describe('building-scoped list routes', () => {
  beforeAll(async () => {
    for (const route of ROUTES) await import(`../api/${route}/route`)
  })

  it('registers a list config for every building-scoped route', () => {
    expect(captured).toHaveLength(ROUTES.length)
  })

  it('opts every building-scoped list out of the CRUD list cache so a removed manager stops seeing the building at once', () => {
    for (const config of captured) {
      expect({ entityId: config.entityId, disableListCache: config.disableListCache }).toEqual({
        entityId: config.entityId,
        disableListCache: true,
      })
    }
  })
})

describe('listQueryBase', () => {
  it('caps the list search at 200 characters', async () => {
    const { z } = await import('zod')
    const { listQueryBase } = await import('../api/crudShared')
    const schema = z.object(listQueryBase)
    expect(schema.safeParse({ search: 'a'.repeat(200) }).success).toBe(true)
    expect(schema.safeParse({ search: 'a'.repeat(201) }).success).toBe(false)
  })
})
