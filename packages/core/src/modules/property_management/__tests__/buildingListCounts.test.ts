/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

type AfterList = (payload: unknown, ctx: CrudCtx & { query: Record<string, unknown> }) => Promise<void>

const captured: { afterList: AfterList | null } = { afterList: null }

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: { hooks?: { afterList?: AfterList } }) => {
    captured.afterList = config.hooks?.afterList ?? null
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))

const findWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null), canManageAllBuildings: jest.fn(async () => true) }
})

jest.mock('../lib/managers', () => ({ listBuildingManagers: jest.fn(async () => new Map()) }))
jest.mock('../lib/openingHours', () => ({
  loadOpeningHours: jest.fn(async () => new Map()),
  serializeWeeklyHours: jest.fn(() => []),
}))
jest.mock('../lib/productUse', () => ({
  loadProductUses: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => {
    const uses = new Map<string, { use: string; billingUnit: string }>()
    if (ids.includes('product-lease')) uses.set('product-lease', { use: 'leasable', billingUnit: 'month' })
    if (ids.includes('product-book')) uses.set('product-book', { use: 'bookable', billingUnit: 'hour' })
    return uses
  }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'

type QueryCall = { table: string; wheres: unknown[][]; groupBy: unknown }

const queries: QueryCall[] = []

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  property_management_spaces: [
    { building_id: 'building-1', floor_id: 'floor-1', count: '2' },
    { building_id: 'building-1', floor_id: 'floor-2', count: 1 },
  ],
  property_management_units: [
    { building_id: 'building-1', floor_id: 'floor-1', catalog_product_id: 'product-lease', count: '3' },
    { building_id: 'building-1', floor_id: 'floor-2', catalog_product_id: 'product-book', count: '4' },
    { building_id: 'building-1', floor_id: 'floor-2', catalog_product_id: 'product-other', count: '1' },
  ],
}

function fakeKysely() {
  return {
    selectFrom(table: string) {
      const call: QueryCall = { table, wheres: [], groupBy: null }
      queries.push(call)
      const builder = {
        select: () => builder,
        where: (...args: unknown[]) => {
          call.wheres.push(args)
          return builder
        },
        groupBy: (columns: unknown) => {
          call.groupBy = columns
          return builder
        },
        execute: async () => ROWS[table] ?? [],
      }
      return builder
    },
  }
}

const em = { getKysely: () => fakeKysely(), count: jest.fn(async () => 0) }

function ctxOf(): CrudCtx & { query: Record<string, unknown> } {
  return {
    container: { resolve: () => ({ fork: () => em }) } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as CrudCtx['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    query: {},
  }
}

beforeAll(async () => {
  await import('../api/buildings/route')
})

describe('buildings list decoration', () => {
  it('counts spaces and units with grouped queries instead of loading every row', async () => {
    findWithDecryption.mockResolvedValue([
      { id: 'floor-1', buildingId: 'building-1', number: 0, name: 'Ground', sizeX: '20', sizeY: '10', updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'floor-2', buildingId: 'building-1', number: 1, name: 'First', sizeX: '20', sizeY: '10', updatedAt: new Date('2026-01-01T00:00:00Z') },
    ])
    const payload = { items: [{ id: 'building-1' }, { id: 'building-2' }] }
    await captured.afterList!(payload, ctxOf())

    expect(findWithDecryption).toHaveBeenCalledTimes(1)
    expect(queries.map((call) => call.table).sort()).toEqual(['property_management_spaces', 'property_management_units'])
    for (const call of queries) {
      expect(call.wheres).toEqual(
        expect.arrayContaining([
          ['tenant_id', '=', TENANT],
          ['organization_id', '=', ORG],
          ['deleted_at', 'is', null],
          ['building_id', 'in', ['building-1', 'building-2']],
        ]),
      )
    }

    const [first, second] = payload.items as Array<Record<string, unknown>>
    expect(first).toMatchObject({ spaceCount: 3, unitCount: 8, leasableUnitCount: 3, bookableUnitCount: 4, floorCount: 2 })
    expect(first.floors).toEqual([
      expect.objectContaining({ id: 'floor-1', spaceCount: 2, unitCount: 3 }),
      expect.objectContaining({ id: 'floor-2', spaceCount: 1, unitCount: 5 }),
    ])
    expect(second).toMatchObject({ spaceCount: 0, unitCount: 0, leasableUnitCount: 0, bookableUnitCount: 0, floorCount: 0 })
  })

  it('derives canManageAll from the permitted set instead of a second rbac lookup', async () => {
    const access = jest.requireMock('../lib/buildingAccess') as { permittedBuildingIds: jest.Mock; canManageAllBuildings: jest.Mock }
    access.canManageAllBuildings.mockClear()
    access.permittedBuildingIds.mockResolvedValueOnce(['building-1'])
    findWithDecryption.mockResolvedValue([])
    const payload: Record<string, unknown> = { items: [{ id: 'building-1' }] }
    await captured.afterList!(payload, ctxOf())
    expect(payload.canManageAll).toBe(false)
    access.permittedBuildingIds.mockResolvedValueOnce(null)
    await captured.afterList!(payload, ctxOf())
    expect(payload.canManageAll).toBe(true)
    expect(access.canManageAllBuildings).not.toHaveBeenCalled()
  })
})
