/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Building, CommonArea, Floor, Space, Unit, UnitProductPeriod } from '../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string, params?: Record<string, string | number>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match)),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: FakeEm, entity: EntityClass, where: Where) => em.findOne(entity, where),
  findWithDecryption: (em: FakeEm, entity: EntityClass, where: Where) => em.find(entity, where),
}))

jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null), canManageAllBuildings: jest.fn(async () => true) }
})

jest.mock('../lib/productUse', () => {
  const actual = jest.requireActual('../lib/productUse')
  return {
    ...actual,
    resolveUnitProduct: jest.fn(async (_em: unknown, _scope: unknown, input: { catalogCategoryId: string; catalogProductId: string }) => ({
      catalogProductId: input.catalogProductId,
      catalogCategoryId: input.catalogCategoryId,
      productName: 'Private office',
      use: 'leasable',
      billingUnit: 'month',
    })),
    resolvePriceSnapshot: jest.fn(async () => ({ priceAmount: '1200.0000', currencyCode: 'PLN', priceKindId: null })),
  }
})

jest.mock('../lib/usageGuards', () => ({
  findActiveLeases: jest.fn(async () => []),
  findUpcomingBookings: jest.fn(async () => []),
  findUnitBlockers: jest.fn(async () => []),
  findUnitsEverUsed: jest.fn(async () => []),
}))

jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'
import { findActiveLeases } from '../lib/usageGuards'

type EntityClass = typeof Building | typeof Floor | typeof Space | typeof Unit | typeof CommonArea | typeof UnitProductPeriod
type Row = Record<string, unknown> & { id: string }
type Where = Record<string, unknown>

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null
    if (expected === null) return actual === null
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as { $in?: unknown[]; $ne?: unknown }
      if (condition.$in) return condition.$in.includes(actual)
      if ('$ne' in condition) return actual !== condition.$ne
      return true
    }
    return actual === expected
  })
}

class FakeEm {
  store = new Map<EntityClass, Row[]>()

  rows(entity: EntityClass): Row[] {
    const list = this.store.get(entity) ?? []
    this.store.set(entity, list)
    return list
  }

  async find(entity: EntityClass, where: Where) {
    return this.rows(entity).filter((row) => matches(row, where))
  }

  async findOne(entity: EntityClass, where: Where) {
    return this.rows(entity).find((row) => matches(row, where)) ?? null
  }

  create(entity: EntityClass, data: Row) {
    return Object.assign(Object.create(entity.prototype), { createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data })
  }

  persist(row: Row & { constructor: EntityClass }) {
    const list = this.rows(row.constructor)
    if (!list.includes(row)) list.push(row)
    return this
  }

  remove(row: Row & { constructor: EntityClass }) {
    const list = this.rows(row.constructor)
    const index = list.indexOf(row)
    if (index >= 0) list.splice(index, 1)
  }

  async flush() {}

  async transactional<T>(callback: (em: FakeEm) => Promise<T>) {
    return callback(this)
  }

  fork() {
    return this
  }

  seed(entity: EntityClass, data: Row) {
    const row = this.create(entity, { ...scope, ...data })
    this.rows(entity).push(row)
    return row
  }
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return dataEngine
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

const BUILDING = '30000000-0000-4000-8000-000000000001'
const FLOOR = '30000000-0000-4000-8000-000000000002'
const COWORKING = '30000000-0000-4000-8000-000000000003'
const RECEPTION = '30000000-0000-4000-8000-000000000004'
const DESKS = '30000000-0000-4000-8000-000000000005'
const KITCHEN = '30000000-0000-4000-8000-000000000006'
const CATEGORY = '30000000-0000-4000-8000-000000000007'
const PRODUCT = '30000000-0000-4000-8000-000000000008'

function seedFloor(): FakeEm {
  const em = new FakeEm()
  em.seed(Building, { id: BUILDING, name: 'Harbor Point', address: '120 Harbor Avenue', status: 'active' })
  em.seed(Floor, { id: FLOOR, buildingId: BUILDING, number: 0, name: 'Ground Floor', sizeX: '42.00', sizeY: '18.00' })
  em.seed(Space, { id: RECEPTION, buildingId: BUILDING, floorId: FLOOR, name: 'Reception', x: '0', y: '0', width: '8', depth: '12', isDefault: true })
  em.seed(Space, { id: COWORKING, buildingId: BUILDING, floorId: FLOOR, name: 'Coworking', x: '8', y: '0', width: '20', depth: '18', isDefault: false })
  em.seed(Unit, {
    id: DESKS,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: COWORKING,
    name: 'Dedicated desks',
    catalogCategoryId: CATEGORY,
    catalogProductId: PRODUCT,
    x: '12',
    y: '12',
    width: '8',
    depth: '6',
  })
  em.seed(CommonArea, { id: KITCHEN, buildingId: BUILDING, floorId: FLOOR, name: 'Kitchen', kind: 'kitchen', x: '24', y: '12', width: '4', depth: '6' })
  em.seed(UnitProductPeriod, { id: '30000000-0000-4000-8000-000000000009', unitId: DESKS, catalogProductId: PRODUCT, productName: 'Desk', use: 'leasable', billingUnit: 'month', validFrom: new Date(), validTo: null })
  return em
}

async function run<T>(commandId: string, input: Record<string, unknown>, em: FakeEm): Promise<T> {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] missing command ${commandId}`)
  return handler.execute({ ...scope, ...input }, buildCtx(em)) as Promise<T>
}

async function expectHttpError(promise: Promise<unknown>, status: number): Promise<CrudHttpError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(status)
    return err as CrudHttpError
  }
  throw new Error('[internal] expected the command to fail')
}

describe('property_management layout commands', () => {
  beforeEach(() => {
    jest.mocked(findActiveLeases).mockResolvedValue([])
  })

  it('creates a unit in a free gap and opens its product period', async () => {
    const em = seedFloor()
    const result = await run<{ unitId: string }>('property_management.unit.create', {
      floorId: FLOOR,
      spaceId: COWORKING,
      name: 'Focus Room',
      catalogCategoryId: CATEGORY,
      catalogProductId: PRODUCT,
      x: 20,
      y: 12,
      width: 4,
      depth: 6,
    }, em)
    const periods = await em.find(UnitProductPeriod, { unitId: result.unitId })
    expect(periods).toHaveLength(1)
    expect(periods[0].priceAmount).toBe('1200.0000')
  })

  it('refuses an overlapping unit with 422 naming the conflict', async () => {
    const em = seedFloor()
    const error = await expectHttpError(
      run('property_management.unit.create', {
        floorId: FLOOR,
        spaceId: COWORKING,
        name: 'Clash',
        catalogCategoryId: CATEGORY,
        catalogProductId: PRODUCT,
        x: 18,
        y: 12,
        width: 8,
        depth: 6,
      }, em),
      422,
    )
    expect(error.body.code).toBe('placement_invalid')
    expect(String(error.body.error)).toContain('Dedicated desks')
    expect(String(error.body.error)).toContain('Kitchen')
  })

  it('refuses shrinking a space that would strand a unit', async () => {
    const em = seedFloor()
    const error = await expectHttpError(run('property_management.space.update', { id: COWORKING, depth: 12 }, em), 422)
    expect(String(error.body.error)).toContain('Dedicated desks')
  })

  it('refuses an overlapping space', async () => {
    const em = seedFloor()
    const error = await expectHttpError(
      run('property_management.space.create', { floorId: FLOOR, name: 'Bike room', x: 0, y: 10, width: 9, depth: 6 }, em),
      422,
    )
    expect(String(error.body.error)).toContain('Reception')
  })

  it('refuses deleting a space that still holds units', async () => {
    const em = seedFloor()
    const error = await expectHttpError(run('property_management.space.delete', { id: COWORKING }, em), 409)
    expect(error.body.code).toBe('space_has_units')
  })

  it('refuses a common area on top of a unit', async () => {
    const em = seedFloor()
    await expectHttpError(
      run('property_management.common_area.create', { floorId: FLOOR, name: 'Storage', kind: 'storage', x: 13, y: 13, width: 2, depth: 2 }, em),
      422,
    )
  })

  it('refuses resizing a floor smaller than a unit on it', async () => {
    const em = seedFloor()
    const error = await expectHttpError(run('property_management.floor.update', { id: FLOOR, sizeX: 18 }, em), 422)
    expect(error.body.code).toBe('floor_resize_strands')
  })

  it('refuses lowering the floor count past a floor with units', async () => {
    const em = seedFloor()
    const upper = em.seed(Floor, { id: '30000000-0000-4000-8000-000000000010', buildingId: BUILDING, number: 1, name: 'First', sizeX: '42', sizeY: '18' })
    em.seed(Unit, {
      id: '30000000-0000-4000-8000-000000000011',
      buildingId: BUILDING,
      floorId: upper.id,
      spaceId: COWORKING,
      name: 'Office 101',
      catalogCategoryId: CATEGORY,
      catalogProductId: PRODUCT,
      x: '0',
      y: '0',
      width: '4',
      depth: '4',
    })
    const error = await expectHttpError(
      run('property_management.floor.layout_replace', {
        buildingId: BUILDING,
        layout: { below: 0, above: 1, floors: [{ number: 0, name: 'Ground Floor', sizeX: 42, sizeY: 18 }] },
      }, em),
      422,
    )
    expect(error.body.code).toBe('floor_has_units')
    expect(error.body.minimumAbove).toBe(2)
    expect(error.body.blockingFloor).toEqual({ id: upper.id, number: 1, name: 'First' })
  })

  it('adds floors with a default space covering each one', async () => {
    const em = seedFloor()
    await run('property_management.floor.layout_replace', {
      buildingId: BUILDING,
      layout: {
        below: 1,
        above: 2,
        floors: [
          { number: -1, name: 'Parking', sizeX: 30, sizeY: 20 },
          { number: 0, name: 'Ground Floor', sizeX: 42, sizeY: 18 },
          { number: 1, name: 'First', sizeX: 24, sizeY: 18 },
        ],
      },
    }, em)
    const floors = await em.find(Floor, { buildingId: BUILDING, deletedAt: null })
    expect(floors.map((floor) => floor.number).sort()).toEqual([-1, 0, 1])
    const basement = floors.find((floor) => floor.number === -1)
    const spaces = await em.find(Space, { floorId: basement?.id })
    expect(spaces).toHaveLength(1)
    expect(spaces[0]).toMatchObject({ isDefault: true, width: '30.00', depth: '20.00' })
  })

  it('locks the product while the unit has an active lease', async () => {
    const em = seedFloor()
    jest.mocked(findActiveLeases).mockResolvedValue([{ kind: 'lease', id: 'lease-1', label: 'L-2026-001', unitId: DESKS, until: null }])
    const error = await expectHttpError(
      run('property_management.unit.product_change', { id: DESKS, catalogProductId: '30000000-0000-4000-8000-000000000012' }, em),
      409,
    )
    expect(error.body.code).toBe('unit_product_locked')
  })

  it('switches the product period on a product change', async () => {
    const em = seedFloor()
    const next = '30000000-0000-4000-8000-000000000012'
    await run('property_management.unit.product_change', { id: DESKS, catalogProductId: next }, em)
    const periods = await em.find(UnitProductPeriod, { unitId: DESKS })
    expect(periods).toHaveLength(2)
    expect(periods.filter((period) => period.validTo === null).map((period) => period.catalogProductId)).toEqual([next])
  })
})
