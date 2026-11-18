/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { Building, Floor, ProductUse, Space, Unavailability, Unit, UnitProductPeriod } from '../data/entities'
import { FakeEm, type EntityClass, type Where } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
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
      use: 'bookable',
      billingUnit: 'hour',
      productName: 'Meeting room',
    })),
    resolvePriceSnapshot: jest.fn(async () => ({ priceAmount: '100.0000', currencyCode: 'PLN', priceKindId: null })),
  }
})
jest.mock('../lib/usageGuards', () => {
  const actual = jest.requireActual('../lib/usageGuards')
  return {
    findActiveLeases: jest.fn(async () => []),
    findUpcomingBookings: jest.fn(async () => []),
    findUpcomingBookingList: jest.fn(async () => ({ blockers: [], total: 0 })),
    findUnitBlockers: jest.fn(async () => []),
    findUnitBlockerList: jest.fn(async () => ({ blockers: [], total: 0 })),
    findUnitsEverUsed: jest.fn(async () => []),
    findBuildingUnitsEverUsed: jest.fn(async () => []),
    usageBlockerListOf: actual.usageBlockerListOf,
    usageBlockerConflictBody: actual.usageBlockerConflictBody,
    USAGE_BLOCKER_LIST_LIMIT: actual.USAGE_BLOCKER_LIST_LIMIT,
    HOLDING_BOOKING_STATUSES: ['pending', 'confirmed'],
  }
})
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'
import { permittedBuildingIds } from '../lib/buildingAccess'
import { emitPropertyManagementEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '80000000-0000-4000-8000-000000000001'
const FLOOR = '80000000-0000-4000-8000-000000000002'
const SPACE = '80000000-0000-4000-8000-000000000003'
const UNIT = '80000000-0000-4000-8000-000000000004'
const CATEGORY = '80000000-0000-4000-8000-000000000005'
const CURRENT_PRODUCT = '80000000-0000-4000-8000-000000000011'
const NEXT_PRODUCT = '80000000-0000-4000-8000-000000000012'
const CLOSURE = '80000000-0000-4000-8000-000000000020'
const VERSION = new Date('2026-11-10T10:00:00.000Z')
const STALE = '2026-11-01T10:00:00.000Z'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

class RecordingEm extends FakeEm {
  log: string[] = []

  async findOne(entity: EntityClass, where: Where, options?: { lockMode?: number }) {
    if (options?.lockMode !== undefined) this.log.push(`lock:${entity.name}`)
    return super.findOne(entity, where, options)
  }
}

function seed(): RecordingEm {
  const em = new RecordingEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground Floor', sizeX: '40.00', sizeY: '20.00', deletedAt: null } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Open plan', x: '0', y: '0', width: '40', depth: '20', isDefault: true, deletedAt: null } as never)
  em.seed(Unit, {
    id: UNIT,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: SPACE,
    name: 'Room 1',
    catalogCategoryId: CATEGORY,
    catalogProductId: CURRENT_PRODUCT,
    x: '2',
    y: '2',
    width: '4',
    depth: '4',
    deletedAt: null,
    updatedAt: VERSION,
  } as never)
  em.seed(UnitProductPeriod, {
    id: 'period-initial',
    ...scope,
    unitId: UNIT,
    catalogProductId: CURRENT_PRODUCT,
    productName: 'Meeting room',
    use: 'bookable',
    billingUnit: 'hour',
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
  } as never)
  for (const catalogProductId of [CURRENT_PRODUCT, NEXT_PRODUCT]) {
    em.seed(CatalogProduct, { id: catalogProductId, ...scope, deletedAt: null } as never)
    em.seed(ProductUse, { id: `use-${catalogProductId}`, ...scope, catalogProductId, use: 'bookable', billingUnit: 'hour', updatedAt: VERSION } as never)
  }
  return em
}

function buildCtx(em: FakeEm, expected?: string): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    request: expected ? new Request('http://localhost/api', { headers: { [LOCK_HEADER]: expected } }) : undefined,
  }
}

function handler(commandId: string) {
  const command = commandRegistry.get(commandId)
  if (!command) throw new Error(`[internal] missing command ${commandId}`)
  return command
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(status)
    if (code) expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

function unitOf(em: FakeEm): Unit {
  return em.rows(Unit)[0] as unknown as Unit
}

function productUseOf(em: FakeEm, catalogProductId: string): ProductUse | undefined {
  return (em.rows(ProductUse) as unknown as ProductUse[]).find((row) => row.catalogProductId === catalogProductId)
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(permittedBuildingIds).mockResolvedValue(null)
})

describe('unit.product_change optimistic lock', () => {
  const input = { ...scope, id: UNIT, catalogProductId: NEXT_PRODUCT }

  it('refuses a stale unit version with 409 and changes nothing', async () => {
    const em = seed()
    await expectHttpError(handler('property_management.unit.product_change').execute(input, buildCtx(em, STALE)), 409, 'optimistic_lock_conflict')
    expect(unitOf(em).catalogProductId).toBe(CURRENT_PRODUCT)
  })

  it('accepts the current unit version', async () => {
    const em = seed()
    await handler('property_management.unit.product_change').execute(input, buildCtx(em, VERSION.toISOString()))
    expect(unitOf(em).catalogProductId).toBe(NEXT_PRODUCT)
  })

  it('checks the version under the unit row lock', async () => {
    const em = seed()
    await expectHttpError(handler('property_management.unit.product_change').execute(input, buildCtx(em, STALE)), 409)
    expect(em.log).toContain('lock:Unit')
  })
})

describe('product_use.set optimistic lock', () => {
  it('refuses a stale product use version', async () => {
    const em = seed()
    const input = { ...scope, catalogProductId: NEXT_PRODUCT, use: 'bookable', billingUnit: 'day' }
    await expectHttpError(handler('property_management.product_use.set').execute(input, buildCtx(em, STALE)), 409, 'optimistic_lock_conflict')
    expect(productUseOf(em, NEXT_PRODUCT)?.billingUnit).toBe('hour')
  })

  it('refuses a versioned write to a product use deleted meanwhile', async () => {
    const em = seed()
    em.remove(productUseOf(em, NEXT_PRODUCT) as never)
    const input = { ...scope, catalogProductId: NEXT_PRODUCT, use: 'bookable', billingUnit: 'day' }
    await expectHttpError(handler('property_management.product_use.set').execute(input, buildCtx(em, STALE)), 409, 'optimistic_lock_conflict')
    expect(productUseOf(em, NEXT_PRODUCT)).toBeUndefined()
  })

  it('applies the change with the current version or without a version', async () => {
    const em = seed()
    await handler('property_management.product_use.set').execute(
      { ...scope, catalogProductId: NEXT_PRODUCT, use: 'bookable', billingUnit: 'day' },
      buildCtx(em, VERSION.toISOString()),
    )
    expect(productUseOf(em, NEXT_PRODUCT)?.billingUnit).toBe('day')
    await handler('property_management.product_use.set').execute(
      { ...scope, catalogProductId: NEXT_PRODUCT, use: 'bookable', billingUnit: 'hour' },
      buildCtx(em),
    )
    expect(productUseOf(em, NEXT_PRODUCT)?.billingUnit).toBe('hour')
  })
})

describe('unavailability.create undo', () => {
  function seedClosure(em: FakeEm): Unavailability {
    return em.seed(Unavailability, {
      id: CLOSURE,
      ...scope,
      buildingId: BUILDING,
      subjectType: 'unit',
      subjectId: UNIT,
      reasonEntryId: null,
      reasonText: 'Repairs',
      startsAt: '2099-01-01T00:00:00',
      endsAt: null,
      endedAt: null,
      applyStatus: 'applied',
      deletedAt: null,
    } as never) as unknown as Unavailability
  }

  async function undoCreate(em: FakeEm): Promise<void> {
    await handler('property_management.unavailability.create').undo?.({
      logEntry: { payload: { undo: { id: CLOSURE, ...scope } } } as never,
      ctx: buildCtx(em),
    } as never)
  }

  it('returns 404 when the actor no longer has access to the building', async () => {
    const em = seed()
    const closure = seedClosure(em)
    jest.mocked(permittedBuildingIds).mockResolvedValue([])
    await expectHttpError(undoCreate(em), 404)
    expect(closure.deletedAt).toBeNull()
  })

  it('removes the closure under its row lock and emits an ended event', async () => {
    const em = seed()
    const closure = seedClosure(em)
    await undoCreate(em)
    expect(closure.deletedAt).toBeInstanceOf(Date)
    expect(em.log).toEqual(['lock:Unavailability'])
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.unavailability.ended',
      expect.objectContaining({ id: CLOSURE, buildingId: BUILDING, removed: true, ...scope }),
      { persistent: true, ...scope },
    )
  })
})

describe('building version checks under the building lock', () => {
  function buildingOf(em: FakeEm): Building {
    return em.rows(Building)[0] as unknown as Building
  }

  function seedVersioned(): RecordingEm {
    const em = seed()
    buildingOf(em).updatedAt = VERSION
    return em
  }

  async function expectCheckedUnderLock(em: RecordingEm, run: Promise<unknown>): Promise<void> {
    await expectHttpError(run, 409, 'optimistic_lock_conflict')
    expect(em.log).toContain('lock:Building')
  }

  it('archives only with the current version, checked after locking the building', async () => {
    const stale = seedVersioned()
    await expectCheckedUnderLock(stale, handler('property_management.building.archive').execute({ ...scope, id: BUILDING }, buildCtx(stale, STALE)))
    expect(buildingOf(stale).status).toBe('active')
    const current = seedVersioned()
    await handler('property_management.building.archive').execute({ ...scope, id: BUILDING }, buildCtx(current, VERSION.toISOString()))
    expect(buildingOf(current).status).toBe('archived')
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.building.archived',
      expect.objectContaining({ id: BUILDING, ...scope }),
      { persistent: true, ...scope },
    )
  })

  it('updates only with the current version, checked after locking the building', async () => {
    const em = seedVersioned()
    await expectCheckedUnderLock(em, handler('property_management.building.update').execute({ ...scope, id: BUILDING, name: 'Stale' }, buildCtx(em, STALE)))
    expect(buildingOf(em).name).toBe('Harbor Point')
  })

  it('refuses the second of two updates sent with the same version', async () => {
    const em = seedVersioned()
    await handler('property_management.building.update').execute({ ...scope, id: BUILDING, name: 'First' }, buildCtx(em, VERSION.toISOString()))
    await expectHttpError(
      handler('property_management.building.update').execute({ ...scope, id: BUILDING, name: 'Second' }, buildCtx(em, VERSION.toISOString())),
      409,
      'optimistic_lock_conflict',
    )
    expect(buildingOf(em).name).toBe('First')
  })

  it('deletes only with the current version, checked after locking the building', async () => {
    const em = seedVersioned()
    await expectCheckedUnderLock(em, handler('property_management.building.delete').execute({ ...scope, id: BUILDING }, buildCtx(em, STALE)))
    expect(buildingOf(em).deletedAt ?? null).toBeNull()
  })

  it('replaces the floor layout only with the current version, checked after locking the building', async () => {
    const em = seedVersioned()
    const layout = { below: 0, above: 1, floors: [{ number: 0, name: 'Ground Floor', sizeX: 40, sizeY: 20 }] }
    await expectCheckedUnderLock(em, handler('property_management.floor.layout_replace').execute({ ...scope, buildingId: BUILDING, layout }, buildCtx(em, STALE)))
  })

  it('bumps the building version when a floor changes, so a stale building form cannot overwrite it', async () => {
    const em = seedVersioned()
    await handler('property_management.floor.update').execute({ ...scope, id: FLOOR, name: 'Lobby' }, buildCtx(em))
    expect(buildingOf(em).updatedAt.getTime()).toBeGreaterThan(VERSION.getTime())
    const layout = { below: 0, above: 1, floors: [{ number: 0, name: 'Ground Floor', sizeX: 40, sizeY: 20 }] }
    await expectHttpError(
      handler('property_management.floor.layout_replace').execute({ ...scope, buildingId: BUILDING, layout }, buildCtx(em, VERSION.toISOString())),
      409,
      'optimistic_lock_conflict',
    )
  })
})

describe('unit.update floor moves', () => {
  const OTHER_FLOOR = '80000000-0000-4000-8000-000000000030'

  it('refuses moving a unit to another floor with a field error', async () => {
    const em = seed()
    await expectHttpError(
      handler('property_management.unit.update').execute({ ...scope, id: UNIT, floorId: OTHER_FLOOR, name: 'Moved' }, buildCtx(em)),
      422,
      'unit_floor_move_unsupported',
    )
    expect(unitOf(em)).toMatchObject({ floorId: FLOOR, name: 'Room 1' })
  })

  it('accepts the unit’s own floor', async () => {
    const em = seed()
    await handler('property_management.unit.update').execute({ ...scope, id: UNIT, floorId: FLOOR, name: 'Renamed' }, buildCtx(em))
    expect(unitOf(em)).toMatchObject({ floorId: FLOOR, name: 'Renamed' })
  })
})
