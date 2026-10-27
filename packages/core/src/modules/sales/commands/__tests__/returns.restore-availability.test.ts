/** @jest-environment node */

/**
 * Restore-time return availability.
 *
 * `sales.returns.create` redo and `sales.returns.delete` undo re-apply a return
 * from its snapshot. The order may have changed since the snapshot was taken —
 * another return may have consumed the shipped quantity, a shipment may have
 * been removed, or the order line may be gone. Restoring must re-check the
 * current returnable quantity with the same rule as creating a return and
 * refuse with a 409 before any write, otherwise the same shipped units are
 * returned and credited twice.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  SalesOrder,
  SalesOrderAdjustment,
  SalesOrderLine,
  SalesReturn,
  SalesReturnLine,
  SalesShipment,
  SalesShipmentItem,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => {
    const translate = (key: string, fallback?: string) => `${key}|${fallback ?? ''}`
    return { locale: 'en', dict: {}, t: translate, translate }
  },
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const LINE_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const SHIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const RETURN_ID = '11111111-1111-4111-8111-111111111111'

type WorldLine = { id: string; quantity: string; returnedQuantity: string }
type World = {
  order: Record<string, unknown> | null
  orderLines: Array<Record<string, unknown>>
  shippedByLine: Record<string, number>
  restoredHeader: Record<string, unknown> | null
}

function makeOrderLine(line: WorldLine) {
  return {
    ...line,
    totalNetAmount: '500',
    totalGrossAmount: '615',
    unitPriceNet: '100',
    unitPriceGross: '123',
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  }
}

function setWorld(options: {
  lines: WorldLine[]
  shippedByLine: Record<string, number>
  orderMissing?: boolean
}): World {
  const world: World = {
    order: options.orderMissing
      ? null
      : {
          id: ORDER_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          deletedAt: null,
          currencyCode: 'USD',
          updatedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
    orderLines: options.lines.map(makeOrderLine),
    shippedByLine: options.shippedByLine,
    restoredHeader: null,
  }
  ;(globalThis as any).__restoreWorld = world
  return world
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__restoreWorld as World
    if (entityClass === SalesOrder) return world.order
    if (entityClass === SalesReturn) return world.restoredHeader
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__restoreWorld as World
    if (entityClass === SalesOrderLine) return world.orderLines
    if (entityClass === SalesShipment) {
      return Object.keys(world.shippedByLine).length ? [{ id: SHIPMENT_ID }] : []
    }
    if (entityClass === SalesShipmentItem) {
      return Object.entries(world.shippedByLine).map(([orderLineId, quantity]) => ({
        shipment: { id: SHIPMENT_ID },
        orderLine: { id: orderLineId },
        quantity: String(quantity),
      }))
    }
    return []
  }),
}))

function makeEm() {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const em: any = {
    fork: function () { return this },
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    isInTransaction: () => false,
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      created.push({ entity, data })
      if (entity === SalesReturn) (globalThis as any).__restoreWorld.restoredHeader = data
      return data
    }),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
  }
  return { em, created }
}

function makeCtx(em: unknown) {
  const calc = {
    calculateDocumentTotals: jest.fn(async () => ({ totals: {}, lines: [{}] })),
  }
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue(dataEngine),
    salesCalculationService: asValue(calc),
  })
  const ctx = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  }
  return { ctx, calc, dataEngine }
}

function makeSnapshot(lines: Array<{ orderLineId: string; quantity: number }>) {
  return {
    id: RETURN_ID,
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    returnNumber: 'RET-0001',
    returnedAt: '2026-10-01T00:00:00.000Z',
    reason: null,
    notes: null,
    lines: lines.map((line, index) => ({
      id: `22222222-2222-4222-8222-22222222222${index}`,
      orderLineId: line.orderLineId,
      quantityReturned: line.quantity,
      unitPriceNet: 100,
      unitPriceGross: 123,
      totalNetAmount: -100 * line.quantity,
      totalGrossAmount: -123 * line.quantity,
    })),
    adjustmentIds: lines.map((_line, index) => `33333333-3333-4333-8333-33333333333${index}`),
  }
}

type RestorePath = 'create-redo' | 'delete-undo'

async function runRestore(path: RestorePath, snapshot: ReturnType<typeof makeSnapshot>, ctx: unknown) {
  if (path === 'create-redo') {
    const handler = commandRegistry.get('sales.returns.create')!
    return handler.redo!({ input: undefined, ctx: ctx as never, logEntry: { commandPayload: { undo: { after: snapshot } } } as never })
  }
  const handler = commandRegistry.get('sales.returns.delete')!
  return handler.undo!({ input: undefined, ctx: ctx as never, logEntry: { commandPayload: { undo: { before: snapshot } } } as never })
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }
  return undefined
}

function expectNoRestoreWrites(em: any, calc: { calculateDocumentTotals: jest.Mock }, dataEngine: { markOrmEntityChange: jest.Mock }) {
  expect(em.create).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
  expect(calc.calculateDocumentTotals).not.toHaveBeenCalled()
  expect(em.commit).not.toHaveBeenCalled()
  expect(em.rollback).toHaveBeenCalled()
  expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  expect(invalidateCrudCache).not.toHaveBeenCalled()
}

describe('restoring a return re-checks the currently returnable quantity', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  afterEach(() => {
    delete (globalThis as any).__restoreWorld
    ;(invalidateCrudCache as jest.MockedFunction<typeof invalidateCrudCache>).mockClear()
    ;(findWithDecryption as jest.Mock).mockClear()
  })

  describe.each<RestorePath>(['create-redo', 'delete-undo'])('%s', (path) => {
    it('refuses when a replacement return already consumed the shipped quantity', async () => {
      const world = setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '5' }],
        shippedByLine: { [LINE_A]: 5 },
      })
      const { em } = makeEm()
      const { ctx, calc, dataEngine } = makeCtx(em)

      const err = await captureError(runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 5 }]), ctx))

      expect(isCrudHttpError(err)).toBe(true)
      expect((err as CrudHttpError).status).toBe(409)
      expect((err as CrudHttpError).body).toEqual({
        error: expect.stringContaining('sales.returns.restoreQuantityUnavailable|'),
      })
      expect(world.orderLines[0].returnedQuantity).toBe('5')
      expectNoRestoreWrites(em, calc, dataEngine)
    })

    it('refuses when the shipment no longer exists', async () => {
      const world = setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '0' }],
        shippedByLine: {},
      })
      const { em } = makeEm()
      const { ctx, calc, dataEngine } = makeCtx(em)

      const err = await captureError(runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 5 }]), ctx))

      expect(isCrudHttpError(err)).toBe(true)
      expect((err as CrudHttpError).status).toBe(409)
      expect(world.orderLines[0].returnedQuantity).toBe('0')
      expectNoRestoreWrites(em, calc, dataEngine)
    })

    it('refuses when the snapshot order line no longer exists instead of restoring an empty return', async () => {
      setWorld({ lines: [], shippedByLine: { [LINE_A]: 5 } })
      const { em } = makeEm()
      const { ctx, calc, dataEngine } = makeCtx(em)

      const err = await captureError(runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 5 }]), ctx))

      expect(isCrudHttpError(err)).toBe(true)
      expect((err as CrudHttpError).status).toBe(409)
      expect((err as CrudHttpError).body).toEqual({
        error: expect.stringContaining('sales.returns.restoreLineMissing|'),
      })
      expectNoRestoreWrites(em, calc, dataEngine)
    })

    it('refuses when the remaining capacity is smaller than the restored quantity', async () => {
      const world = setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '3' }],
        shippedByLine: { [LINE_A]: 5 },
      })
      const { em } = makeEm()
      const { ctx, calc, dataEngine } = makeCtx(em)

      const err = await captureError(runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 3 }]), ctx))

      expect(isCrudHttpError(err)).toBe(true)
      expect((err as CrudHttpError).status).toBe(409)
      expect(world.orderLines[0].returnedQuantity).toBe('3')
      expectNoRestoreWrites(em, calc, dataEngine)
    })

    it('refuses the whole restore when only one of several lines is unavailable', async () => {
      const world = setWorld({
        lines: [
          { id: LINE_A, quantity: '5', returnedQuantity: '0' },
          { id: LINE_B, quantity: '2', returnedQuantity: '2' },
        ],
        shippedByLine: { [LINE_A]: 5, [LINE_B]: 2 },
      })
      const { em } = makeEm()
      const { ctx, calc, dataEngine } = makeCtx(em)

      const err = await captureError(
        runRestore(
          path,
          makeSnapshot([
            { orderLineId: LINE_A, quantity: 5 },
            { orderLineId: LINE_B, quantity: 1 },
          ]),
          ctx,
        ),
      )

      expect(isCrudHttpError(err)).toBe(true)
      expect((err as CrudHttpError).status).toBe(409)
      expect(world.orderLines.map((line) => line.returnedQuantity)).toEqual(['0', '2'])
      expectNoRestoreWrites(em, calc, dataEngine)
    })

    it('restores when the remaining capacity exactly matches the restored quantity', async () => {
      const world = setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '2' }],
        shippedByLine: { [LINE_A]: 5 },
      })
      const { em, created } = makeEm()
      const { ctx, calc } = makeCtx(em)

      await runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 3 }]), ctx)

      expect(world.orderLines[0].returnedQuantity).toBe('5')
      expect(created.filter((entry) => entry.entity === SalesReturnLine)).toHaveLength(1)
      expect(created.filter((entry) => entry.entity === SalesOrderAdjustment)).toHaveLength(1)
      expect(calc.calculateDocumentTotals).toHaveBeenCalledTimes(1)
      expect(em.commit).toHaveBeenCalled()
    })

    it('restores a return normally when the shipped quantity is still unreturned', async () => {
      const world = setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '0' }],
        shippedByLine: { [LINE_A]: 5 },
      })
      const { em, created } = makeEm()
      const { ctx, calc } = makeCtx(em)

      await runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 5 }]), ctx)

      expect(world.orderLines[0].returnedQuantity).toBe('5')
      expect(created.filter((entry) => entry.entity === SalesReturn)).toHaveLength(1)
      expect(created.filter((entry) => entry.entity === SalesReturnLine)).toHaveLength(1)
      expect(created.filter((entry) => entry.entity === SalesOrderAdjustment)).toHaveLength(1)
      expect(calc.calculateDocumentTotals).toHaveBeenCalledTimes(1)
      expect(em.commit).toHaveBeenCalled()
      expect(em.rollback).not.toHaveBeenCalled()
    })

    it('reads shipped quantities only after locking the order lines', async () => {
      setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '0' }],
        shippedByLine: { [LINE_A]: 5 },
      })
      const { em } = makeEm()
      const { ctx } = makeCtx(em)

      await runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 5 }]), ctx)

      const calls = (findWithDecryption as jest.Mock).mock.calls
      const lineCallIndex = calls.findIndex(([, entityClass]) => entityClass === SalesOrderLine)
      const shipmentCallIndex = calls.findIndex(([, entityClass]) => entityClass === SalesShipment)
      expect(lineCallIndex).toBeGreaterThanOrEqual(0)
      expect(calls[lineCallIndex][3]).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE })
      expect(shipmentCallIndex).toBeGreaterThan(lineCallIndex)
    })

    it('loads shipped quantities inside the snapshot tenant and organization scope', async () => {
      setWorld({
        lines: [{ id: LINE_A, quantity: '5', returnedQuantity: '0' }],
        shippedByLine: { [LINE_A]: 5 },
      })
      const { em } = makeEm()
      const { ctx } = makeCtx(em)

      await runRestore(path, makeSnapshot([{ orderLineId: LINE_A, quantity: 5 }]), ctx)

      const shipmentCalls = (findWithDecryption as jest.Mock).mock.calls.filter(
        ([, entityClass]) => entityClass === SalesShipment || entityClass === SalesShipmentItem,
      )
      expect(shipmentCalls).toHaveLength(2)
      shipmentCalls.forEach((call) => {
        expect(call[4]).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
      })
      const shipmentFilter = shipmentCalls.find(([, entityClass]) => entityClass === SalesShipment)![2]
      expect(shipmentFilter).toEqual({ order: ORDER_ID, deletedAt: null })
    })
  })

  it('reports a missing order with a translated message', async () => {
    setWorld({ lines: [], shippedByLine: {}, orderMissing: true })
    const { em } = makeEm()
    const { ctx } = makeCtx(em)

    const err = await captureError(runRestore('delete-undo', makeSnapshot([{ orderLineId: LINE_A, quantity: 1 }]), ctx))

    expect(isCrudHttpError(err)).toBe(true)
    expect((err as CrudHttpError).status).toBe(404)
    expect((err as CrudHttpError).body).toEqual({ error: 'sales.returns.orderMissing|Order not found.' })
  })
})
