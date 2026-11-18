/** @jest-environment node */
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Building, Floor, ProductUse, Space, Unit, UnitProductPeriod } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null), canManageAllBuildings: jest.fn(async () => true) }
})
jest.mock('../lib/productUse', () => {
  const actual = jest.requireActual('../lib/productUse')
  const uses: Record<string, { use: string; billingUnit: string; productName: string }> = {
    '60000000-0000-4000-8000-000000000011': { use: 'leasable', billingUnit: 'month', productName: 'Private office' },
    '60000000-0000-4000-8000-000000000012': { use: 'bookable', billingUnit: 'hour', productName: 'Meeting room' },
    '60000000-0000-4000-8000-000000000013': { use: 'bookable', billingUnit: 'day', productName: 'Day office' },
  }
  return {
    ...actual,
    resolveUnitProduct: jest.fn(async (_em: unknown, _scope: unknown, input: { catalogCategoryId: string; catalogProductId: string }) => ({
      catalogProductId: input.catalogProductId,
      catalogCategoryId: input.catalogCategoryId,
      ...uses[input.catalogProductId],
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
jest.mock('../lib/leaseRecords', () => {
  const actual = jest.requireActual('../lib/leaseRecords')
  return { ...actual, lockUnitRow: jest.fn(actual.lockUnitRow) }
})
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'
import { transitionProductUse } from '../commands/product-use'
import { lockUnitRow } from '../lib/leaseRecords'
import { resolveUnitProduct } from '../lib/productUse'
import { findActiveLeases, findUnitBlockerList, findUpcomingBookingList } from '../lib/usageGuards'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '60000000-0000-4000-8000-000000000001'
const FLOOR = '60000000-0000-4000-8000-000000000002'
const SPACE = '60000000-0000-4000-8000-000000000003'
const UNIT = '60000000-0000-4000-8000-000000000004'
const CATEGORY = '60000000-0000-4000-8000-000000000005'
const LEASABLE = '60000000-0000-4000-8000-000000000011'
const HOURLY = '60000000-0000-4000-8000-000000000012'
const DAILY = '60000000-0000-4000-8000-000000000013'
const DAILY_XL = '60000000-0000-4000-8000-000000000014'

const PRODUCT_USES: Record<string, { use: string; billingUnit: string }> = {
  [LEASABLE]: { use: 'leasable', billingUnit: 'month' },
  [HOURLY]: { use: 'bookable', billingUnit: 'hour' },
  [DAILY]: { use: 'bookable', billingUnit: 'day' },
  [DAILY_XL]: { use: 'bookable', billingUnit: 'day' },
}

const upcoming = [{ kind: 'booking' as const, id: 'booking-1', label: 'Meeting room · 2026-11-20T10:00', unitId: UNIT, until: '2026-11-20T11:00' }]
const upcomingList = { blockers: upcoming, total: upcoming.length }

function seed(productId: string): FakeEm {
  const em = new FakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Floor, { id: FLOOR, ...scope, buildingId: BUILDING, number: 0, name: 'Ground Floor', sizeX: '40.00', sizeY: '20.00', deletedAt: null } as never)
  em.seed(Space, { id: SPACE, ...scope, buildingId: BUILDING, floorId: FLOOR, name: 'Open plan', x: '0', y: '0', width: '40', depth: '20', isDefault: true, deletedAt: null } as never)
  em.seed(Unit, {
    id: UNIT,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: SPACE,
    name: 'Studio 2B',
    catalogCategoryId: CATEGORY,
    catalogProductId: productId,
    x: '2',
    y: '2',
    width: '6',
    depth: '4',
    deletedAt: null,
  } as never)
  em.seed(UnitProductPeriod, {
    id: 'period-initial',
    ...scope,
    unitId: UNIT,
    catalogProductId: productId,
    productName: 'Initial',
    ...PRODUCT_USES[productId],
    priceAmount: '80.0000',
    currencyCode: 'PLN',
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
  } as never)
  for (const [catalogProductId, use] of Object.entries(PRODUCT_USES)) {
    em.seed(ProductUse, { id: `use-${catalogProductId}`, ...scope, catalogProductId, ...use } as never)
  }
  return em
}

function productUseOf(em: FakeEm, catalogProductId: string): ProductUse {
  return (em.rows(ProductUse) as unknown as ProductUse[]).find((row) => row.catalogProductId === catalogProductId) as ProductUse
}

function removeProductUse(em: FakeEm, catalogProductId: string): void {
  em.remove(productUseOf(em, catalogProductId) as never)
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function handler(commandId: string) {
  const command = commandRegistry.get(commandId)
  if (!command) throw new Error(`[internal] missing command ${commandId}`)
  return command
}

type ProductChangeResult = { unitId: string; productChange: { closedPeriodId: string | null; openedPeriodId: string } | null }

async function run(commandId: string, input: Record<string, unknown>, em: FakeEm): Promise<ProductChangeResult> {
  return handler(commandId).execute({ ...scope, ...input }, buildCtx(em)) as Promise<ProductChangeResult>
}

function snapshotOf(productId: string) {
  return {
    id: UNIT,
    ...scope,
    buildingId: BUILDING,
    floorId: FLOOR,
    spaceId: SPACE,
    name: 'Studio 2B',
    catalogCategoryId: CATEGORY,
    catalogProductId: productId,
    x: '2',
    y: '2',
    width: '6',
    depth: '4',
  }
}

async function undo(commandId: string, em: FakeEm, before: string, after: string, result: ProductChangeResult): Promise<void> {
  const logEntry = { payload: { undo: { before: snapshotOf(before), after: snapshotOf(after), productChange: result.productChange } } }
  await handler(commandId).undo?.({ logEntry: logEntry as never, ctx: buildCtx(em) } as never)
}

async function expectConflict(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(409)
    expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

function openPeriods(em: FakeEm): UnitProductPeriod[] {
  return (em.rows(UnitProductPeriod) as unknown as UnitProductPeriod[]).filter((period) => !period.validTo)
}

function unitOf(em: FakeEm): Unit {
  return em.rows(Unit)[0] as unknown as Unit
}

function periodById(em: FakeEm, id: string): UnitProductPeriod {
  const period = (em.rows(UnitProductPeriod) as unknown as UnitProductPeriod[]).find((entry) => entry.id === id)
  if (!period) throw new Error(`[internal] missing period ${id}`)
  return period
}

function archiveBuilding(em: FakeEm): void {
  Object.assign(em.rows(Building)[0], { status: 'archived' })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(findUpcomingBookingList).mockReset()
  jest.mocked(findUpcomingBookingList).mockResolvedValue({ blockers: [], total: 0 })
  jest.mocked(findActiveLeases).mockReset()
  jest.mocked(findActiveLeases).mockResolvedValue([])
})

describe.each([
  ['property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY }],
  ['property_management.unit.update', { id: UNIT, catalogProductId: HOURLY }],
])('%s', (commandId, input) => {
  it('locks the unit row before switching the product', async () => {
    const em = seed(LEASABLE)
    await run(commandId, input, em)
    expect(lockUnitRow).toHaveBeenCalledWith(expect.anything(), scope, UNIT)
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
  })

  it('locks the unit and refuses the undo when the restored leasable product would strand upcoming bookings', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    jest.mocked(lockUnitRow).mockClear()
    jest.mocked(findUpcomingBookingList).mockResolvedValueOnce(upcomingList)
    await expectConflict(undo(commandId, em, LEASABLE, HOURLY, result), 'unit_has_upcoming_bookings')
    expect(lockUnitRow).toHaveBeenCalledWith(expect.anything(), scope, UNIT)
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
    expect(unitOf(em).catalogProductId).toBe(HOURLY)
  })

  it('reopens the previous product period with its price on undo and collapses the undone period', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    await undo(commandId, em, LEASABLE, HOURLY, result)
    const undone = periodById(em, result.productChange?.openedPeriodId ?? '')
    expect(undone.validTo).toEqual(undone.validFrom)
    expect(lockUnitRow).toHaveBeenLastCalledWith(expect.anything(), scope, UNIT)
    expect(openPeriods(em).map((period) => [period.id, period.use, period.billingUnit, period.priceAmount])).toEqual([
      ['period-initial', 'leasable', 'month', '80.0000'],
    ])
    expect(unitOf(em).catalogProductId).toBe(LEASABLE)
  })

  it('opens a fresh period without a price on undo when the previous product use changed meanwhile', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    Object.assign(productUseOf(em, LEASABLE), { use: 'bookable', billingUnit: 'day' })
    await undo(commandId, em, LEASABLE, HOURLY, result)
    const open = openPeriods(em)
    expect(open.map((period) => [period.catalogProductId, period.use, period.billingUnit, period.priceAmount ?? null])).toEqual([[LEASABLE, 'bookable', 'day', null]])
    expect(open[0].id).not.toBe('period-initial')
    expect(unitOf(em).catalogProductId).toBe(LEASABLE)
  })

  it('switches with the product use read under the lock when it changed after the pre-check', async () => {
    const em = seed(LEASABLE)
    Object.assign(productUseOf(em, HOURLY), { use: 'leasable', billingUnit: 'month' })
    await run(commandId, input, em)
    expect(openPeriods(em).map((period) => [period.catalogProductId, period.use, period.billingUnit, period.priceAmount ?? null])).toEqual([
      [HOURLY, 'leasable', 'month', null],
    ])
  })

  it('checks the usage against the product use read under the lock', async () => {
    const em = seed(LEASABLE)
    Object.assign(productUseOf(em, HOURLY), { use: 'leasable', billingUnit: 'month' })
    jest.mocked(findUpcomingBookingList).mockResolvedValueOnce(upcomingList)
    await expectConflict(run(commandId, input, em), 'unit_has_upcoming_bookings')
    expect(openPeriods(em).map((period) => period.id)).toEqual(['period-initial'])
  })

  it('refuses with 422 when the target product lost its use before the lock', async () => {
    const em = seed(LEASABLE)
    removeProductUse(em, HOURLY)
    await expect(run(commandId, input, em)).rejects.toMatchObject({ status: 422 })
    expect(openPeriods(em).map((period) => period.id)).toEqual(['period-initial'])
    expect(unitOf(em).catalogProductId).toBe(LEASABLE)
  })

  it('takes the product use share lock after the floor and before the unit row', async () => {
    const em = seed(LEASABLE)
    const findOne = jest.spyOn(em, 'findOne')
    await run(commandId, input, em)
    const calls = findOne.mock.calls.map((call, index) => ({ entity: call[0], options: call[2], order: findOne.mock.invocationCallOrder[index] }))
    const useLock = calls.find((call) => call.entity === ProductUse)
    const unitLock = calls.find((call) => call.entity === Unit && call.options?.lockMode === LockMode.PESSIMISTIC_WRITE)
    const floorRead = calls.find((call) => call.entity === Floor)
    expect(useLock?.options).toEqual({ lockMode: LockMode.PESSIMISTIC_READ, refresh: true })
    expect(floorRead && useLock && floorRead.order < useLock.order).toBe(true)
    expect(useLock && unitLock && useLock.order < unitLock.order).toBe(true)
  })

  it('leaves a unit that was deleted meanwhile untouched on undo', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    unitOf(em).deletedAt = new Date()
    jest.mocked(findActiveLeases).mockClear()
    jest.mocked(lockUnitRow).mockClear()
    jest.mocked(findUpcomingBookingList).mockResolvedValue(upcomingList)
    await undo(commandId, em, LEASABLE, HOURLY, result)
    expect(findActiveLeases).not.toHaveBeenCalled()
    expect(lockUnitRow).not.toHaveBeenCalled()
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
    expect(unitOf(em).catalogProductId).toBe(HOURLY)
  })

  it('refuses the undo with 409 when the previous product can no longer be resolved', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    const { resolveUnitProduct } = jest.requireMock('../lib/productUse') as { resolveUnitProduct: jest.Mock }
    resolveUnitProduct.mockRejectedValueOnce(new CrudHttpError(422, { error: 'The product is not a catalog product of this organization.' }))
    await expectConflict(undo(commandId, em, LEASABLE, HOURLY, result), 'unit_undo_product_unavailable')
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
    expect(unitOf(em).catalogProductId).toBe(HOURLY)
  })

  it('closes the period that replaced the opened one and restores the previous product on undo', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    await transitionProductUse(em as never, scope, HOURLY, { use: 'bookable', billingUnit: 'day' })
    expect(openPeriods(em).map((period) => [period.catalogProductId, period.billingUnit])).toEqual([[HOURLY, 'day']])
    await undo(commandId, em, LEASABLE, HOURLY, result)
    expect(openPeriods(em).map((period) => [period.catalogProductId, period.use, period.billingUnit])).toEqual([[LEASABLE, 'leasable', 'month']])
    expect(unitOf(em).catalogProductId).toBe(LEASABLE)
  })

  it('refuses the undo with 409 when the unit moved to another product since', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    await run(commandId, { id: UNIT, catalogProductId: DAILY }, em)
    await expectConflict(undo(commandId, em, LEASABLE, HOURLY, result), 'unit_undo_stale')
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([DAILY])
    expect(unitOf(em).catalogProductId).toBe(DAILY)
  })

  it('refuses the undo with 409 when a racing change closed a period of another product than the one captured before', async () => {
    const em = seed(LEASABLE)
    await run(commandId, input, em)
    const raced = await run(commandId, { id: UNIT, catalogProductId: DAILY }, em)
    const closedPeriodId = raced.productChange?.closedPeriodId ?? ''
    expect(periodById(em, closedPeriodId).catalogProductId).toBe(HOURLY)
    await expectConflict(undo(commandId, em, LEASABLE, DAILY, raced), 'unit_undo_stale')
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([DAILY])
    expect(periodById(em, closedPeriodId).validTo).not.toBeNull()
    expect(unitOf(em).catalogProductId).toBe(DAILY)
  })

  it('refuses the undo with 409 when the previous product lost its use before the lock', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    removeProductUse(em, LEASABLE)
    await expectConflict(undo(commandId, em, LEASABLE, HOURLY, result), 'unit_undo_product_unavailable')
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
    expect(unitOf(em).catalogProductId).toBe(HOURLY)
  })

  it('refuses the undo with 409 when the building was archived since and keeps the product', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    archiveBuilding(em)
    jest.mocked(lockUnitRow).mockClear()
    await expect(undo(commandId, em, LEASABLE, HOURLY, result)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ error: expect.stringContaining('archived') }),
    })
    expect(lockUnitRow).not.toHaveBeenCalled()
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
    expect(unitOf(em).catalogProductId).toBe(HOURLY)
  })

  it('opens a fresh period on undo of a legacy entry that recorded no closed period', async () => {
    const em = seed(LEASABLE)
    const result = await run(commandId, input, em)
    const legacy = { ...result, productChange: { closedPeriodId: null, openedPeriodId: result.productChange?.openedPeriodId ?? '' } }
    await undo(commandId, em, LEASABLE, HOURLY, legacy)
    const open = openPeriods(em)
    expect(open.map((period) => [period.catalogProductId, period.use, period.billingUnit, period.priceAmount ?? null])).toEqual([[LEASABLE, 'leasable', 'month', null]])
    expect(open[0].id).not.toBe('period-initial')
    expect(unitOf(em).catalogProductId).toBe(LEASABLE)
  })

  describe('with undos of a product use change in between', () => {
    afterEach(() => jest.useRealTimers())

    function at(iso: string): void {
      jest.setSystemTime(new Date(iso))
    }

    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date('2026-05-01T00:00:00Z'),
        doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
      })
    })

    it('reopens the original priced period when the product use change is undone before the product change', async () => {
      const em = seed(LEASABLE)
      at('2026-05-01T10:00:00Z')
      const result = await run(commandId, input, em)
      at('2026-05-02T10:00:00Z')
      const set = await transitionProductUse(em as never, scope, HOURLY, { use: 'bookable', billingUnit: 'day' })
      at('2026-05-03T10:00:00Z')
      await transitionProductUse(em as never, scope, HOURLY, { use: 'bookable', billingUnit: 'hour' }, {
        revert: set.periodSwitches,
        expected: { use: 'bookable', billingUnit: 'day' },
      })
      expect(openPeriods(em).map((period) => period.id)).toEqual([result.productChange?.openedPeriodId])
      at('2026-05-04T10:00:00Z')
      await undo(commandId, em, LEASABLE, HOURLY, result)
      expect(openPeriods(em).map((period) => [period.id, period.use, period.billingUnit, period.priceAmount])).toEqual([
        ['period-initial', 'leasable', 'month', '80.0000'],
      ])
      expect(unitOf(em).catalogProductId).toBe(LEASABLE)
    })

    it('reopens the original priced period when the product change is undone before the product use change', async () => {
      const em = seed(HOURLY)
      at('2026-05-01T10:00:00Z')
      const set = await transitionProductUse(em as never, scope, HOURLY, { use: 'bookable', billingUnit: 'day' })
      at('2026-05-02T10:00:00Z')
      const result = await run(commandId, { ...input, catalogProductId: LEASABLE }, em)
      at('2026-05-03T10:00:00Z')
      await undo(commandId, em, HOURLY, LEASABLE, result)
      expect(openPeriods(em).map((period) => period.id)).toEqual([set.periodSwitches[0].openedPeriodId])
      at('2026-05-04T10:00:00Z')
      await transitionProductUse(em as never, scope, HOURLY, { use: 'bookable', billingUnit: 'hour' }, {
        revert: set.periodSwitches,
        expected: { use: 'bookable', billingUnit: 'day' },
      })
      expect(openPeriods(em).map((period) => [period.id, period.use, period.billingUnit, period.priceAmount])).toEqual([
        ['period-initial', 'bookable', 'hour', '80.0000'],
      ])
      expect(unitOf(em).catalogProductId).toBe(HOURLY)
    })
  })
})

describe('property_management.unit.update undo without a product change', () => {
  it('keeps the product fields and the open period when the product changed since the rename', async () => {
    const em = seed(LEASABLE)
    const rename = await run('property_management.unit.update', { id: UNIT, name: 'Studio 2B renamed' }, em)
    expect(rename.productChange).toBeNull()
    await run('property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY }, em)
    const logEntry = {
      payload: { undo: { before: snapshotOf(LEASABLE), after: { ...snapshotOf(LEASABLE), name: 'Studio 2B renamed' }, productChange: null } },
    }
    await handler('property_management.unit.update').undo?.({ logEntry: logEntry as never, ctx: buildCtx(em) } as never)
    expect(unitOf(em)).toMatchObject({ name: 'Studio 2B', catalogProductId: HOURLY, catalogCategoryId: CATEGORY })
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
  })

  it('restores a category-only change while the unit still has the category it set', async () => {
    const em = seed(LEASABLE)
    const OTHER_CATEGORY = '60000000-0000-4000-8000-000000000006'
    unitOf(em).catalogCategoryId = OTHER_CATEGORY
    const logEntry = {
      payload: { undo: { before: snapshotOf(LEASABLE), after: { ...snapshotOf(LEASABLE), catalogCategoryId: OTHER_CATEGORY }, productChange: null } },
    }
    await handler('property_management.unit.update').undo?.({ logEntry: logEntry as never, ctx: buildCtx(em) } as never)
    expect(unitOf(em)).toMatchObject({ catalogCategoryId: CATEGORY, catalogProductId: LEASABLE })
  })
})

describe('property_management.unit.product_change to the product the unit already has', () => {
  it('keeps the open period, emits nothing and skips the usage check', async () => {
    const em = seed(LEASABLE)
    jest.mocked(findActiveLeases).mockResolvedValueOnce([{ kind: 'lease', id: 'lease-1', label: 'L-2026-001', unitId: UNIT, until: null }])
    const { emitPropertyManagementEvent } = jest.requireMock('../events') as { emitPropertyManagementEvent: jest.Mock }
    const { emitSideEffects } = jest.requireMock('../commands/shared') as { emitSideEffects: jest.Mock }
    const updatedAt = unitOf(em).updatedAt
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: LEASABLE }, em)
    expect(result).toEqual({ unitId: UNIT, productChange: null })
    expect(lockUnitRow).toHaveBeenCalledWith(expect.anything(), scope, UNIT)
    expect(findActiveLeases).not.toHaveBeenCalled()
    expect(openPeriods(em).map((period) => [period.id, period.priceAmount])).toEqual([['period-initial', '80.0000']])
    expect(emitPropertyManagementEvent).not.toHaveBeenCalled()
    expect(emitSideEffects).not.toHaveBeenCalled()
    expect(unitOf(em).updatedAt).toBe(updatedAt)
  })

  it('treats the undo of the no-op as a no-op', async () => {
    const em = seed(LEASABLE)
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: LEASABLE }, em)
    jest.mocked(lockUnitRow).mockClear()
    await undo('property_management.unit.product_change', em, LEASABLE, LEASABLE, result)
    expect(lockUnitRow).not.toHaveBeenCalled()
    expect(openPeriods(em).map((period) => period.id)).toEqual(['period-initial'])
  })

  it('still switches the period when only the unit type differs', async () => {
    const em = seed(LEASABLE)
    const OTHER_CATEGORY = '60000000-0000-4000-8000-000000000006'
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: LEASABLE, catalogCategoryId: OTHER_CATEGORY }, em)
    expect(result.productChange).toMatchObject({ closedPeriodId: 'period-initial' })
    expect(unitOf(em).catalogCategoryId).toBe(OTHER_CATEGORY)
  })
})

describe('property_management.unit.product_change racing a category-only unit update', () => {
  const OTHER_CATEGORY = '60000000-0000-4000-8000-000000000006'
  const actualLockUnitRow = jest.requireActual('../lib/leaseRecords').lockUnitRow as typeof lockUnitRow

  function recategoriseWhileLocking(em: FakeEm): void {
    jest.mocked(lockUnitRow).mockImplementationOnce(async (trx, lockScope, unitId, options) => {
      unitOf(em).catalogCategoryId = OTHER_CATEGORY
      return actualLockUnitRow(trx, lockScope, unitId, options)
    })
  }

  it('keeps the unit type committed before the unit lock instead of restoring the one read before it', async () => {
    const em = seed(LEASABLE)
    recategoriseWhileLocking(em)
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY }, em)
    expect(resolveUnitProduct).toHaveBeenLastCalledWith(expect.anything(), scope, { catalogCategoryId: OTHER_CATEGORY, catalogProductId: HOURLY })
    expect(result.productChange).toMatchObject({ closedPeriodId: 'period-initial' })
    expect(unitOf(em)).toMatchObject({ catalogCategoryId: OTHER_CATEGORY, catalogProductId: HOURLY })
    expect(openPeriods(em).map((period) => [period.catalogProductId, period.priceAmount])).toEqual([[HOURLY, '100.0000']])
  })

  it('treats the request as a no-op when the unit already has the product under its new unit type', async () => {
    const em = seed(LEASABLE)
    recategoriseWhileLocking(em)
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: LEASABLE }, em)
    expect(result.productChange).toBeNull()
    expect(unitOf(em)).toMatchObject({ catalogCategoryId: OTHER_CATEGORY, catalogProductId: LEASABLE })
    expect(openPeriods(em).map((period) => period.id)).toEqual(['period-initial'])
  })

  it('applies an explicitly requested unit type over the one committed meanwhile', async () => {
    const em = seed(LEASABLE)
    recategoriseWhileLocking(em)
    await run('property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY, catalogCategoryId: CATEGORY }, em)
    expect(unitOf(em)).toMatchObject({ catalogCategoryId: CATEGORY, catalogProductId: HOURLY })
  })
})

describe('property_management.unit.update racing a product change', () => {
  const OTHER_CATEGORY = '60000000-0000-4000-8000-000000000006'

  function switchProductBeforeFloorLock(em: FakeEm): void {
    const findOne = em.findOne.bind(em)
    let switched = false
    em.findOne = async (entity, where, options) => {
      if (!switched && entity === Floor && options?.lockMode !== undefined) {
        switched = true
        unitOf(em).catalogProductId = HOURLY
        periodById(em, 'period-initial').validTo = new Date('2026-06-01T00:00:00Z')
        em.seed(UnitProductPeriod, {
          id: 'period-hourly',
          ...scope,
          unitId: UNIT,
          catalogProductId: HOURLY,
          productName: 'Meeting room',
          ...PRODUCT_USES[HOURLY],
          priceAmount: null,
          currencyCode: null,
          validFrom: new Date('2026-06-01T00:00:00Z'),
          validTo: null,
        } as never)
      }
      return findOne(entity, where, options)
    }
  }

  it.each([
    ['omits the product', { catalogCategoryId: OTHER_CATEGORY }],
    ['resends the product it read before the lock', { catalogCategoryId: OTHER_CATEGORY, catalogProductId: LEASABLE }],
  ])('keeps the product committed meanwhile when a category-only update %s', async (_label, input) => {
    const em = seed(LEASABLE)
    switchProductBeforeFloorLock(em)
    const result = await run('property_management.unit.update', { id: UNIT, ...input }, em)
    expect(result.productChange).toBeNull()
    expect(unitOf(em)).toMatchObject({ catalogCategoryId: OTHER_CATEGORY, catalogProductId: HOURLY })
    expect(openPeriods(em).map((period) => period.id)).toEqual(['period-hourly'])
    expect(resolveUnitProduct).toHaveBeenLastCalledWith(expect.anything(), scope, { catalogCategoryId: OTHER_CATEGORY, catalogProductId: HOURLY })
  })

  it('still switches to a product the update explicitly asks for', async () => {
    const em = seed(LEASABLE)
    switchProductBeforeFloorLock(em)
    const result = await run('property_management.unit.update', { id: UNIT, catalogProductId: DAILY }, em)
    expect(result.productChange).toMatchObject({ closedPeriodId: 'period-hourly' })
    expect(unitOf(em)).toMatchObject({ catalogCategoryId: CATEGORY, catalogProductId: DAILY })
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([DAILY])
  })
})

describe('property_management.unit.product_change audit log', () => {
  async function buildLog(input: Record<string, unknown>, result: ProductChangeResult, em: FakeEm) {
    const command = handler('property_management.unit.product_change')
    return command.buildLog?.({ input: { ...scope, ...input }, result, ctx: buildCtx(em), snapshots: { before: snapshotOf(LEASABLE), after: snapshotOf(LEASABLE) } } as never)
  }

  it('skips the audit entry, and so its undo token, when the change is a no-op', async () => {
    const em = seed(LEASABLE)
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: LEASABLE }, em)
    expect(await buildLog({ id: UNIT, catalogProductId: LEASABLE }, result, em)).toEqual({ skipLog: true })
  })

  it('emits the product change with trusted tenant and organization scope as a persistent event', async () => {
    const em = seed(LEASABLE)
    const { emitPropertyManagementEvent } = jest.requireMock('../events') as { emitPropertyManagementEvent: jest.Mock }
    await run('property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY }, em)
    expect(emitPropertyManagementEvent).toHaveBeenCalledWith(
      'property_management.unit.product_changed',
      expect.objectContaining({ unitId: UNIT, catalogProductId: HOURLY, ...scope }),
      { persistent: true, ...scope },
    )
  })

  it('records an undoable audit entry when the product changed', async () => {
    const em = seed(LEASABLE)
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY }, em)
    const log = await buildLog({ id: UNIT, catalogProductId: HOURLY }, result, em)
    expect(log).toMatchObject({ resourceId: UNIT, payload: { undo: { productChange: result.productChange } } })
    expect(log).not.toHaveProperty('skipLog')
  })
})

describe('property_management.unit.product_change on an archived building', () => {
  it('refuses with 409 and keeps the product', async () => {
    const em = seed(LEASABLE)
    archiveBuilding(em)
    await expect(run('property_management.unit.product_change', { id: UNIT, catalogProductId: HOURLY }, em)).rejects.toMatchObject({ status: 409 })
    expect(openPeriods(em).map((period) => period.id)).toEqual(['period-initial'])
    expect(unitOf(em).catalogProductId).toBe(LEASABLE)
  })
})

describe('property_management.unit.create', () => {
  it('opens the first period with the product use read under the floor lock', async () => {
    const em = seed(LEASABLE)
    Object.assign(productUseOf(em, HOURLY), { billingUnit: 'day' })
    const result = (await handler('property_management.unit.create').execute(
      { ...scope, floorId: FLOOR, spaceId: SPACE, name: 'Studio 3C', catalogCategoryId: CATEGORY, catalogProductId: HOURLY, x: 20, y: 2, width: 4, depth: 4 },
      buildCtx(em),
    )) as { unitId: string }
    const period = openPeriods(em).find((entry) => entry.unitId === result.unitId)
    expect(period).toMatchObject({ catalogProductId: HOURLY, use: 'bookable', billingUnit: 'day' })
    expect(period?.priceAmount ?? null).toBeNull()
  })

  async function createUnit(em: FakeEm): Promise<string> {
    const result = (await handler('property_management.unit.create').execute(
      { ...scope, floorId: FLOOR, spaceId: SPACE, name: 'Studio 3C', catalogCategoryId: CATEGORY, catalogProductId: HOURLY, x: 20, y: 2, width: 4, depth: 4 },
      buildCtx(em),
    )) as { unitId: string }
    return result.unitId
  }

  async function undoCreate(em: FakeEm, unitId: string): Promise<void> {
    const after = { ...snapshotOf(HOURLY), id: unitId, name: 'Studio 3C', x: '20.00', y: '2.00', width: '4.00', depth: '4.00' }
    await handler('property_management.unit.create').undo?.({ logEntry: { payload: { undo: { after } } } as never, ctx: buildCtx(em) } as never)
  }

  function createdUnit(em: FakeEm, unitId: string): Unit {
    return (em.rows(Unit) as unknown as Unit[]).find((unit) => unit.id === unitId) as Unit
  }

  it('undoes the creation after locking the building, the floor and the unit row, then checking the blockers', async () => {
    const em = seed(LEASABLE)
    const unitId = await createUnit(em)
    const findOne = jest.spyOn(em, 'findOne')
    await undoCreate(em, unitId)
    expect(createdUnit(em, unitId).deletedAt).toBeInstanceOf(Date)
    const order = (entity: unknown) => {
      const index = findOne.mock.calls.findIndex((call) => call[0] === entity && (call[2] as { lockMode?: number } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE)
      return index >= 0 ? findOne.mock.invocationCallOrder[index] : -1
    }
    const buildingLock = order(Building)
    const floorLock = order(Floor)
    const unitLock = order(Unit)
    const blockerCheck = jest.mocked(findUnitBlockerList).mock.invocationCallOrder.at(-1) ?? -1
    expect(buildingLock).toBeGreaterThan(0)
    expect(floorLock).toBeGreaterThan(buildingLock)
    expect(unitLock).toBeGreaterThan(floorLock)
    expect(blockerCheck).toBeGreaterThan(unitLock)
  })

  it('refuses the undo with 409 while the unit is in use', async () => {
    const em = seed(LEASABLE)
    const unitId = await createUnit(em)
    jest.mocked(findUnitBlockerList).mockResolvedValueOnce({ blockers: upcoming, total: 250 })
    await expect(undoCreate(em, unitId)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'unit_in_use', blockers: upcoming, blockerCount: 250 }),
    })
    expect(createdUnit(em, unitId).deletedAt ?? null).toBeNull()
  })

  it('refuses the undo with 409 when the building was archived since', async () => {
    const em = seed(LEASABLE)
    const unitId = await createUnit(em)
    archiveBuilding(em)
    await expect(undoCreate(em, unitId)).rejects.toMatchObject({ status: 409 })
    expect(findUnitBlockerList).not.toHaveBeenCalled()
    expect(createdUnit(em, unitId).deletedAt ?? null).toBeNull()
  })

  it('refuses with 422 when the product lost its use before the floor lock', async () => {
    const em = seed(LEASABLE)
    removeProductUse(em, HOURLY)
    await expect(
      handler('property_management.unit.create').execute(
        { ...scope, floorId: FLOOR, spaceId: SPACE, name: 'Studio 3C', catalogCategoryId: CATEGORY, catalogProductId: HOURLY, x: 20, y: 2, width: 4, depth: 4 },
        buildCtx(em),
      ),
    ).rejects.toMatchObject({ status: 422 })
    expect(em.rows(Unit)).toHaveLength(1)
  })
})

describe('property_management.unit.delete undo', () => {
  async function deleteUnit(em: FakeEm): Promise<void> {
    await handler('property_management.unit.delete').execute({ ...scope, id: UNIT }, buildCtx(em))
  }

  async function undoDelete(em: FakeEm): Promise<void> {
    const logEntry = { payload: { undo: { before: snapshotOf(LEASABLE) } } }
    await handler('property_management.unit.delete').undo?.({ logEntry: logEntry as never, ctx: buildCtx(em) } as never)
  }

  it('restores the unit after locking its product use and then its row', async () => {
    const em = seed(LEASABLE)
    await deleteUnit(em)
    const findOne = jest.spyOn(em, 'findOne')
    await undoDelete(em)
    expect(unitOf(em).deletedAt).toBeNull()
    const order = (predicate: (call: unknown[]) => boolean) => {
      const index = findOne.mock.calls.findIndex(predicate)
      return index >= 0 ? findOne.mock.invocationCallOrder[index] : -1
    }
    const useLock = order((call) => call[0] === ProductUse)
    const unitLock = order((call) => call[0] === Unit && (call[2] as { lockMode?: number } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE)
    expect(useLock).toBeGreaterThan(0)
    expect(unitLock).toBeGreaterThan(useLock)
  })

  it('refuses with 409 when the building was archived since', async () => {
    const em = seed(LEASABLE)
    await deleteUnit(em)
    archiveBuilding(em)
    await expect(undoDelete(em)).rejects.toMatchObject({ status: 409 })
    expect(unitOf(em).deletedAt).toBeInstanceOf(Date)
  })

  it('refuses with 409 while the product of the unit is neither leasable nor bookable', async () => {
    const em = seed(LEASABLE)
    await deleteUnit(em)
    removeProductUse(em, LEASABLE)
    await expectConflict(undoDelete(em), 'unit_undo_product_unavailable')
    expect(unitOf(em).deletedAt).toBeInstanceOf(Date)
  })
})

describe('bookable billing unit switch through a product change', () => {
  it('refuses an hour to day switch while upcoming bookings use the hourly product', async () => {
    const em = seed(HOURLY)
    jest.mocked(findUpcomingBookingList).mockResolvedValueOnce(upcomingList)
    await expectConflict(run('property_management.unit.product_change', { id: UNIT, catalogProductId: DAILY }, em), 'product_billing_unit_strands')
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([HOURLY])
  })

  it('allows an hour to day switch when no booking is upcoming', async () => {
    const em = seed(HOURLY)
    await run('property_management.unit.product_change', { id: UNIT, catalogProductId: DAILY }, em)
    expect(openPeriods(em).map((period) => [period.catalogProductId, period.billingUnit])).toEqual([[DAILY, 'day']])
  })

  it('allows a switch between bookable products of the same billing unit despite upcoming bookings', async () => {
    const em = seed(DAILY)
    jest.mocked(findUpcomingBookingList).mockResolvedValue(upcomingList)
    const other = DAILY_XL
    const { resolveUnitProduct } = jest.requireMock('../lib/productUse') as { resolveUnitProduct: jest.Mock }
    resolveUnitProduct.mockResolvedValueOnce({ catalogProductId: other, catalogCategoryId: CATEGORY, productName: 'Day office XL', use: 'bookable', billingUnit: 'day' })
    await run('property_management.unit.product_change', { id: UNIT, catalogProductId: other }, em)
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([other])
    expect(findUpcomingBookingList).not.toHaveBeenCalled()
  })

  it('refuses the undo of a day to hour switch while upcoming bookings use the day product', async () => {
    const em = seed(HOURLY)
    const result = await run('property_management.unit.product_change', { id: UNIT, catalogProductId: DAILY }, em)
    jest.mocked(findUpcomingBookingList).mockResolvedValueOnce(upcomingList)
    await expectConflict(undo('property_management.unit.product_change', em, HOURLY, DAILY, result), 'product_billing_unit_strands')
    expect(openPeriods(em).map((period) => period.catalogProductId)).toEqual([DAILY])
  })
})
