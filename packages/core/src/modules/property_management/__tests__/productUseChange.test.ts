/** @jest-environment node */
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { ProductUse, Unit, UnitProductPeriod } from '../data/entities'
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
jest.mock('../lib/usageGuards', () => {
  const actual = jest.requireActual('../lib/usageGuards')
  return {
    findActiveLeases: jest.fn(async () => []),
    findUpcomingBookings: jest.fn(async () => []),
    findUpcomingBookingList: jest.fn(async () => ({ blockers: [], total: 0 })),
    usageBlockerListOf: actual.usageBlockerListOf,
    usageBlockerConflictBody: actual.usageBlockerConflictBody,
  }
})
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, canManageAllBuildings: jest.fn(async () => true) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import { assertProductUseChangeAllowed } from '../commands/product-use'
import { findActiveLeases, findUpcomingBookingList } from '../lib/usageGuards'
import { canManageAllBuildings } from '../lib/buildingAccess'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const upcoming = [{ kind: 'booking' as const, id: 'booking-1', label: 'Meeting room · 2026-11-20T10:00', unitId: 'unit-1', until: '2026-11-20T11:00' }]
const upcomingList = { blockers: upcoming, total: 140 }

function seedUnit(em: FakeEm): void {
  em.seed(Unit, { id: 'unit-1', ...scope, catalogProductId: 'product-1', name: 'Meeting room 1', deletedAt: null } as never)
}

async function conflictOf(promise: Promise<void>): Promise<Record<string, unknown> | null> {
  try {
    await promise
    return null
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    return (err as CrudHttpError).body as Record<string, unknown>
  }
}

beforeEach(() => jest.clearAllMocks())

describe('assertProductUseChangeAllowed', () => {
  it('refuses a billing unit change while upcoming bookings use the current one', async () => {
    const em = new FakeEm()
    seedUnit(em)
    ;(findUpcomingBookingList as jest.Mock).mockResolvedValueOnce(upcomingList)
    const body = await conflictOf(
      assertProductUseChangeAllowed(em as never, scope, 'product-1', { use: 'bookable', billingUnit: 'hour' }, { use: 'bookable', billingUnit: 'day' }),
    )
    expect(body).toMatchObject({ code: 'product_billing_unit_strands', blockers: upcoming, blockerCount: 140 })
  })

  it('allows a billing unit change when no upcoming booking uses the product', async () => {
    const em = new FakeEm()
    seedUnit(em)
    await expect(
      assertProductUseChangeAllowed(em as never, scope, 'product-1', { use: 'bookable', billingUnit: 'hour' }, { use: 'bookable', billingUnit: 'day' }),
    ).resolves.toBeUndefined()
    expect(findUpcomingBookingList).toHaveBeenCalledWith(em, scope, ['unit-1'])
  })

  it('skips the usage check when neither the use nor the billing unit changes', async () => {
    const em = new FakeEm()
    seedUnit(em)
    await assertProductUseChangeAllowed(em as never, scope, 'product-1', { use: 'bookable', billingUnit: 'hour' }, { use: 'bookable', billingUnit: 'hour' })
    expect(findUpcomingBookingList).not.toHaveBeenCalled()
  })

  it('still refuses a use change that strands upcoming bookings', async () => {
    const em = new FakeEm()
    seedUnit(em)
    ;(findUpcomingBookingList as jest.Mock).mockResolvedValueOnce(upcomingList)
    const body = await conflictOf(
      assertProductUseChangeAllowed(em as never, scope, 'product-1', { use: 'bookable', billingUnit: 'hour' }, { use: 'leasable', billingUnit: 'month' }),
    )
    expect(body).toMatchObject({ code: 'product_use_strands' })
  })
})

const PRODUCT = '30000000-0000-4000-8000-000000000001'
const lease = [{ kind: 'lease' as const, id: 'lease-1', label: 'L-2026-001', unitId: 'unit-a', until: '2027-01-31' }]
const SWITCHED_AT = new Date('2026-03-01T00:00:00Z')

type PeriodSwitch = { closedPeriodId: string; openedPeriodId: string }
type ProductUseState = { use: string; billingUnit: string } | null
type ProductUseResult = { catalogProductId: string; before: ProductUseState; after: ProductUseState; periodSwitches: PeriodSwitch[] }

function seedProduct(use: 'leasable' | 'bookable'): FakeEm {
  const em = new FakeEm()
  const billingUnit = use === 'leasable' ? 'month' : 'hour'
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Studio', deletedAt: null } as never)
  em.seed(ProductUse, { id: 'use-1', ...scope, catalogProductId: PRODUCT, use, billingUnit } as never)
  em.seed(UnitProductPeriod, {
    id: 'period-closed',
    ...scope,
    unitId: 'unit-a',
    catalogProductId: PRODUCT,
    productName: 'Studio',
    use,
    billingUnit,
    priceAmount: '40.0000',
    currencyCode: 'PLN',
    priceKindId: null,
    validFrom: new Date('2025-01-01T00:00:00Z'),
    validTo: new Date('2026-01-01T00:00:00Z'),
  } as never)
  for (const unitId of ['unit-b', 'unit-a']) {
    em.seed(Unit, { id: unitId, ...scope, catalogProductId: PRODUCT, name: unitId, deletedAt: null } as never)
    em.seed(UnitProductPeriod, {
      id: `period-${unitId}`,
      ...scope,
      unitId,
      catalogProductId: PRODUCT,
      productName: 'Studio',
      use,
      billingUnit,
      priceAmount: '50.0000',
      currencyCode: 'PLN',
      priceKindId: 'kind-1',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: null,
    } as never)
  }
  return em
}

function uniqueViolation(constraint: string): UniqueConstraintViolationException {
  return new UniqueConstraintViolationException(
    Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: '23505', constraint }),
  )
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId } as never,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

function handler() {
  const command = commandRegistry.get('property_management.product_use.set')
  if (!command) throw new Error('[internal] missing product_use.set')
  return command
}

async function setUse(em: FakeEm, use: string, billingUnit: string): Promise<ProductUseResult> {
  return handler().execute({ ...scope, catalogProductId: PRODUCT, use, billingUnit }, buildCtx(em)) as Promise<ProductUseResult>
}

async function undoSet(em: FakeEm, result: ProductUseResult, options: { legacy?: boolean } = {}): Promise<void> {
  const undo = {
    scope,
    catalogProductId: result.catalogProductId,
    before: result.before,
    ...(options.legacy ? {} : { after: result.after, periodSwitches: result.periodSwitches }),
  }
  await handler().undo?.({ logEntry: { payload: { undo } } as never, ctx: buildCtx(em) } as never)
}

function periods(em: FakeEm): UnitProductPeriod[] {
  return em.rows(UnitProductPeriod) as unknown as UnitProductPeriod[]
}

function periodOf(em: FakeEm, id: string): UnitProductPeriod {
  const period = periods(em).find((entry) => entry.id === id)
  if (!period) throw new Error(`[internal] missing period ${id}`)
  return period
}

function openStates(em: FakeEm): Array<[string, string, string, string | null]> {
  return periods(em)
    .filter((period) => !period.validTo)
    .map((period): [string, string, string, string | null] => [period.unitId, period.id, `${period.use}/${period.billingUnit}`, period.priceAmount ?? null])
    .sort((left, right) => left[0].localeCompare(right[0]))
}

function backdateSwitch(em: FakeEm, result: ProductUseResult): void {
  for (const entry of result.periodSwitches) {
    periodOf(em, entry.closedPeriodId).validTo = SWITCHED_AT
    periodOf(em, entry.openedPeriodId).validFrom = SWITCHED_AT
  }
}

describe('property_management.product_use.set access', () => {
  it('refuses with 403 for a caller who does not manage every building and leaves the use alone', async () => {
    const em = seedProduct('leasable')
    jest.mocked(canManageAllBuildings).mockResolvedValueOnce(false)
    const failure = setUse(em, 'bookable', 'hour').then(() => null, (err: unknown) => err)
    const err = await failure
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(403)
    expect((err as CrudHttpError).body).toMatchObject({ code: 'product_use_forbidden' })
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'leasable', billingUnit: 'month' })
    expect(canManageAllBuildings).toHaveBeenCalledWith(expect.objectContaining({ tenantId: scope.tenantId, organizationId: scope.organizationId }))
  })

  it('refuses the undo with 403 for a caller who does not manage every building', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    jest.mocked(canManageAllBuildings).mockResolvedValueOnce(false)
    const err = await undoSet(em, result).then(() => null, (failure: unknown) => failure)
    expect((err as CrudHttpError).status).toBe(403)
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'bookable', billingUnit: 'hour' })
  })
})

describe('property_management.product_use.set', () => {
  it('closes the open periods of a leasable product and opens bookable periods without a price snapshot', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    expect(result.before).toEqual({ use: 'leasable', billingUnit: 'month' })
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'bookable', billingUnit: 'hour' })
    expect(result.periodSwitches.map((entry) => entry.closedPeriodId).sort()).toEqual(['period-unit-a', 'period-unit-b'])
    const opened = openStates(em)
    expect(opened.map(([unitId, , state, price]) => [unitId, state, price])).toEqual([
      ['unit-a', 'bookable/hour', null],
      ['unit-b', 'bookable/hour', null],
    ])
    for (const entry of result.periodSwitches) {
      const closed = periodOf(em, entry.closedPeriodId)
      const next = periodOf(em, entry.openedPeriodId)
      expect(closed).toMatchObject({ use: 'leasable', billingUnit: 'month', priceAmount: '50.0000', currencyCode: 'PLN' })
      expect(closed.validTo).toBeInstanceOf(Date)
      expect(next).toMatchObject({ unitId: closed.unitId, catalogProductId: PRODUCT, productName: 'Studio', currencyCode: null, priceKindId: null })
      expect(next.validFrom).toEqual(closed.validTo)
    }
    expect(periodOf(em, 'period-closed')).toMatchObject({ use: 'leasable', billingUnit: 'month' })
  })

  it('does not carry the hourly price over when a bookable product becomes leasable', async () => {
    const em = seedProduct('bookable')
    await setUse(em, 'leasable', 'month')
    expect(openStates(em).map(([unitId, , state, price]) => [unitId, state, price])).toEqual([
      ['unit-a', 'leasable/month', null],
      ['unit-b', 'leasable/month', null],
    ])
    expect(periodOf(em, 'period-unit-a')).toMatchObject({ use: 'bookable', billingUnit: 'hour', priceAmount: '50.0000' })
  })

  it('opens new periods on a billing unit change', async () => {
    const em = seedProduct('bookable')
    await setUse(em, 'bookable', 'day')
    expect(openStates(em).map(([, , state, price]) => [state, price])).toEqual([
      ['bookable/day', null],
      ['bookable/day', null],
    ])
  })

  it('keeps the open periods when neither the use nor the billing unit changes', async () => {
    const em = seedProduct('bookable')
    const result = await setUse(em, 'bookable', 'hour')
    expect(result.periodSwitches).toEqual([])
    expect(openStates(em).map(([, id]) => id)).toEqual(['period-unit-a', 'period-unit-b'])
  })

  it('collapses the undone periods and reopens their predecessors with their price on undo', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    backdateSwitch(em, result)
    await undoSet(em, result)
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'leasable', billingUnit: 'month' })
    expect(openStates(em)).toEqual([
      ['unit-a', 'period-unit-a', 'leasable/month', '50.0000'],
      ['unit-b', 'period-unit-b', 'leasable/month', '50.0000'],
    ])
    for (const entry of result.periodSwitches) {
      const undone = periodOf(em, entry.openedPeriodId)
      expect(undone.validTo).toEqual(undone.validFrom)
    }
  })

  it('refuses the undo with 409 when the product use changed again since and keeps the later change', async () => {
    const em = seedProduct('leasable')
    const first = await setUse(em, 'bookable', 'hour')
    await setUse(em, 'bookable', 'day')
    const before = openStates(em)
    await expect(undoSet(em, first)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'product_use_undo_stale' }) })
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'bookable', billingUnit: 'day' })
    expect(openStates(em)).toEqual(before)
  })

  it('records the requested state as the after state of the undo payload', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    const log = await handler().buildLog?.({ input: { ...scope, catalogProductId: PRODUCT, use: 'bookable', billingUnit: 'hour' }, result, ctx: buildCtx(em) } as never)
    expect((log as { payload: { undo: Record<string, unknown> } }).payload.undo).toMatchObject({
      before: { use: 'leasable', billingUnit: 'month' },
      after: { use: 'bookable', billingUnit: 'hour' },
    })
  })

  it('opens a fresh period on undo when the predecessor is no longer the latest closed period of the unit', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    backdateSwitch(em, result)
    const switchA = result.periodSwitches.find((entry) => entry.closedPeriodId === 'period-unit-a') as PeriodSwitch
    em.seed(UnitProductPeriod, {
      id: 'period-later',
      ...scope,
      unitId: 'unit-a',
      catalogProductId: PRODUCT,
      productName: 'Studio',
      use: 'leasable',
      billingUnit: 'month',
      validFrom: SWITCHED_AT,
      validTo: new Date('2026-04-01T00:00:00Z'),
    } as never)
    await undoSet(em, result)
    const open = openStates(em)
    expect(open[0][1]).not.toBe('period-unit-a')
    expect(open[0][1]).not.toBe(switchA.openedPeriodId)
    expect(open[0].slice(2)).toEqual(['leasable/month', null])
    expect(open[1]).toEqual(['unit-b', 'period-unit-b', 'leasable/month', '50.0000'])
  })

  it('undoes a legacy entry without a recorded after state over a later change', async () => {
    const em = seedProduct('leasable')
    const first = await setUse(em, 'bookable', 'hour')
    await setUse(em, 'bookable', 'day')
    await undoSet(em, first, { legacy: true })
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'leasable', billingUnit: 'month' })
  })

  it('opens fresh periods with the previous use when undoing a legacy entry without recorded switches', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    await undoSet(em, result, { legacy: true })
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'leasable', billingUnit: 'month' })
    const open = openStates(em)
    expect(open.map(([unitId, , state, price]) => [unitId, state, price])).toEqual([
      ['unit-a', 'leasable/month', null],
      ['unit-b', 'leasable/month', null],
    ])
    expect(open.map(([, id]) => id)).not.toContain('period-unit-a')
  })

  it('refuses the undo and keeps the periods when it would strand upcoming bookings', async () => {
    const em = seedProduct('leasable')
    const result = await setUse(em, 'bookable', 'hour')
    const before = openStates(em)
    ;(findUpcomingBookingList as jest.Mock).mockResolvedValueOnce(upcomingList)
    await expect(undoSet(em, result)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'product_use_strands' }) })
    expect(em.rows(ProductUse)[0]).toMatchObject({ use: 'bookable', billingUnit: 'hour' })
    expect(openStates(em)).toEqual(before)
  })

  it('refuses a use change while units of the product have active leases and leaves the periods alone', async () => {
    const em = seedProduct('leasable')
    ;(findActiveLeases as jest.Mock).mockResolvedValueOnce(lease)
    await expect(setUse(em, 'bookable', 'hour')).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'product_use_strands', blockers: lease, blockerCount: 1 }),
    })
    expect(openStates(em).map(([, id, state]) => [id, state])).toEqual([
      ['period-unit-a', 'leasable/month'],
      ['period-unit-b', 'leasable/month'],
    ])
  })

  it('locks the product use row before locking the units in id order', async () => {
    const em = seedProduct('leasable')
    const find = jest.spyOn(em, 'find')
    const findOne = jest.spyOn(em, 'findOne')
    await setUse(em, 'bookable', 'hour')
    const unitLock = find.mock.calls.findIndex(([entity]) => entity === Unit)
    expect(find.mock.calls[unitLock][2]).toEqual(expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } }))
    const useReads = findOne.mock.calls
      .map((call, index) => ({ call, order: findOne.mock.invocationCallOrder[index] }))
      .filter(({ call }) => call[0] === ProductUse)
    expect(useReads).toHaveLength(1)
    expect(useReads[0].call[2]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
    expect(useReads[0].order).toBeLessThan(find.mock.invocationCallOrder[unitLock])
  })

  it('answers 409 when a concurrent request created the product use first', async () => {
    const em = seedProduct('leasable')
    em.store.set(ProductUse.name, [])
    const flush = em.flush.bind(em)
    const insertFlushes: number[] = []
    jest.spyOn(em, 'flush').mockImplementation(async () => {
      if (em.rows(ProductUse).length) {
        insertFlushes.push(em.flushes)
        throw uniqueViolation('property_management_product_uses_product_unique')
      }
      await flush()
    })
    await expect(setUse(em, 'bookable', 'hour')).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'product_use_changed' }) })
    expect(insertFlushes).toHaveLength(1)
  })

  it('answers 409 when a concurrent request opened a period of the unit first', async () => {
    const em = seedProduct('leasable')
    const flush = em.flush.bind(em)
    jest.spyOn(em, 'flush').mockImplementationOnce(async () => {
      throw uniqueViolation('property_management_unit_product_periods_open_unique')
    }).mockImplementation(flush)
    await expect(setUse(em, 'bookable', 'hour')).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'product_use_changed' }) })
  })

  it('rethrows a unique violation of any other constraint instead of answering product_use_changed', async () => {
    const em = seedProduct('leasable')
    const unrelated = uniqueViolation('some_other_unique')
    jest.spyOn(em, 'flush').mockRejectedValueOnce(unrelated)
    await expect(setUse(em, 'bookable', 'hour')).rejects.toBe(unrelated)
  })

  it('locks deleted units of the product too, switches their periods and checks the usage of live units only', async () => {
    const em = seedProduct('leasable')
    const deleted = em.rows(Unit).find((unit) => unit.id === 'unit-b') as unknown as Unit
    deleted.deletedAt = new Date('2026-02-01T00:00:00Z')
    const find = jest.spyOn(em, 'find')
    await setUse(em, 'bookable', 'hour')
    const unitLock = find.mock.calls.find(([entity, , options]) => entity === Unit && options?.lockMode === LockMode.PESSIMISTIC_WRITE)
    expect(unitLock?.[1]).not.toHaveProperty('deletedAt')
    expect(findActiveLeases).toHaveBeenCalledWith(em, scope, ['unit-a'])
    expect(openStates(em).map(([unitId, , state]) => [unitId, state])).toEqual([
      ['unit-a', 'bookable/hour'],
      ['unit-b', 'bookable/hour'],
    ])
  })

  it('locks no unit when the set changes nothing', async () => {
    const em = seedProduct('leasable')
    const find = jest.spyOn(em, 'find')
    const result = await setUse(em, 'leasable', 'month')
    expect(result.periodSwitches).toEqual([])
    expect(find.mock.calls.some(([entity]) => entity === Unit)).toBe(false)
    expect(openStates(em).map(([, id]) => id)).toEqual(['period-unit-a', 'period-unit-b'])
  })
})
