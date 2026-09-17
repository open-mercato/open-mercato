/** @jest-environment node */

/**
 * Bulk order-line writes (`sales.orders.lines.upsert_many`).
 *
 * The per-line command reloads the order aggregate, recalculates the document
 * and flushes once per line, so an integration mirroring an ERP into sales
 * orders pays O(N²) row reads to write N lines. The bulk command loads the
 * aggregate once and must land on the same end state N sequential per-line
 * upserts would land on — that equivalence is what lets a caller swap one for
 * the other.
 *
 * The batch also owns two transaction boundaries the per-line command never
 * had to state: totals are published only after the write commits, and
 * reverting a batch restores the order graph inside one transaction.
 */

import { randomUUID } from 'crypto'
import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  SalesOrder,
  SalesShipment,
  SalesShipmentItem,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
  deriveResourceFromCommandId: jest.fn(() => 'sales.order'),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    async (em: TestEntityManager, entityClass: unknown, where: TestWhere) => {
      const { order } = em.world
      if (entityClass !== SalesOrder) return null
      return order.id === where.id && order.deletedAt === null ? order : null
    },
  ),
  findWithDecryption: jest.fn(
    async (em: TestEntityManager, entityClass: unknown, where: TestWhere) => {
      const world = em.world
      if (entityClass === SalesShipment) {
        return world.shipments.filter((shipment) => shipment.deletedAt === null)
      }
      if (entityClass === SalesShipmentItem) {
        const shipmentIds = readIdList(where.shipment)
        return world.shipmentItems.filter((item) => shipmentIds.includes(item.shipment.id))
      }
      return []
    },
  ),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_TENANT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const MISSING_ORDER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const STATUS_ENTRY_ID = '11111111-1111-4111-8111-111111111111'

const TOTALS_EVENT = 'sales.document.totals.calculated'

type TestWhere = Record<string, unknown>

/** `{ $in: [...] }` or a bare id, as the command's queries spell them. */
function readIdList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object' && '$in' in value) {
    const candidates = (value as { $in: unknown }).$in
    if (Array.isArray(candidates)) {
      return candidates.filter((entry): entry is string => typeof entry === 'string')
    }
  }
  return []
}

/**
 * The persisted columns this suite reads back. The index signature is what
 * lets the command `Object.assign` its own payload onto a row without the
 * double having to restate every column of `SalesOrderLine`.
 */
type TestLine = {
  id: string
  lineNumber: number
  name: string | null
  statusEntryId: string | null
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  taxRate: string
  taxAmount: string | null
  totalNetAmount: string | null
  totalGrossAmount: string | null
  [column: string]: unknown
}

type TestOrder = {
  id: string
  organizationId: string
  tenantId: string
  deletedAt: Date | null
  currencyCode: string
  status: string | null
  fulfillmentStatus: string | null
  lineItemCount?: number
  [column: string]: unknown
}

type TestShipment = { id: string; deletedAt: Date | null }
type TestShipmentItem = {
  id: string
  shipment: { id: string }
  orderLine: string
  quantity: string
}

type World = {
  order: TestOrder
  lines: TestLine[]
  adjustments: unknown[]
  shipments: TestShipment[]
  shipmentItems: TestShipmentItem[]
}

function makeOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    currencyCode: 'USD',
    status: 'draft',
    fulfillmentStatus: null,
    customerEntityId: null,
    shippingMethodSnapshot: null,
    paymentMethodSnapshot: null,
    shippingMethodId: null,
    paymentMethodId: null,
    shippingMethodCode: null,
    paymentMethodCode: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    updatedAt: new Date('2026-07-08T09:21:29.000Z'),
    ...overrides,
  }
}

function makeLine(index: number, overrides: Partial<TestLine> = {}): TestLine {
  const quantity = 1
  const unitPriceNet = 100 * index
  const unitPriceGross = 123 * index
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    lineNumber: index,
    kind: 'product',
    statusEntryId: null,
    status: null,
    productId: null,
    productVariantId: null,
    catalogSnapshot: null,
    promotionSnapshot: null,
    name: `Line ${index}`,
    description: null,
    comment: null,
    quantity: String(quantity),
    quantityUnit: null,
    normalizedQuantity: String(quantity),
    normalizedUnit: null,
    uomSnapshot: null,
    currencyCode: 'USD',
    unitPriceNet: String(unitPriceNet),
    unitPriceGross: String(unitPriceGross),
    discountAmount: '0',
    discountPercent: '0',
    taxRate: '23',
    taxAmount: String(unitPriceGross - unitPriceNet),
    totalNetAmount: String(unitPriceNet),
    totalGrossAmount: String(unitPriceGross),
    configuration: null,
    promotionCode: null,
    metadata: null,
    customFieldSetId: null,
    updatedAt: new Date('2026-07-08T09:21:29.000Z'),
    ...overrides,
  }
}

function makeWorld(lineCount: number, orderOverrides: Partial<TestOrder> = {}): World {
  return {
    order: makeOrder(orderOverrides),
    lines: Array.from({ length: lineCount }, (_, index) => makeLine(index + 1)),
    adjustments: [],
    shipments: [],
    shipmentItems: [],
  }
}

type TestEntityManager = {
  world: World
  findCounts: Record<string, number>
  /** Ordered record of the calls whose relative order this suite asserts on. */
  trace: string[]
  fork(): TestEntityManager
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  find: jest.Mock
  findOne: jest.Mock
  count: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  remove: jest.Mock
  flush: jest.Mock
  nativeDelete: jest.Mock
  getUnitOfWork: () => { unsetIdentity: jest.Mock }
  getReference: jest.Mock
  getConnection: () => { execute: jest.Mock }
}

function makeEm(world: World, trace: string[] = []): TestEntityManager {
  const findCounts: Record<string, number> = {}
  const unsetIdentity = jest.fn()
  const em: TestEntityManager = {
    world,
    findCounts,
    trace,
    fork() {
      return em
    },
    begin: jest.fn(async () => {
      trace.push('begin')
    }),
    commit: jest.fn(async () => {
      trace.push('commit')
    }),
    rollback: jest.fn(async () => {
      trace.push('rollback')
    }),
    find: jest.fn(async (entityClass: unknown, where: TestWhere) => {
      const entityName = readEntityName(entityClass)
      findCounts[entityName] = (findCounts[entityName] ?? 0) + 1
      if (entityName === 'SalesOrderLine') {
        return [...world.lines].sort((left, right) => left.lineNumber - right.lineNumber)
      }
      if (entityName === 'SalesOrderAdjustment') return world.adjustments
      if (entityName === 'SalesShipmentItem') {
        const orderLineIds = readIdList(where?.orderLine)
        return world.shipmentItems.filter((item) => orderLineIds.includes(item.orderLine))
      }
      return []
    }),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entityClass: unknown, data: TestWhere): TestLine => {
      const id = typeof data.id === 'string' ? data.id : randomUUID()
      return { ...(data as Partial<TestLine>), id } as TestLine
    }),
    persist: jest.fn((entity: TestLine) => {
      if (!world.lines.includes(entity)) world.lines.push(entity)
    }),
    remove: jest.fn((entity: TestLine) => {
      const index = world.lines.indexOf(entity)
      if (index !== -1) world.lines.splice(index, 1)
    }),
    flush: jest.fn(async () => {
      trace.push('flush')
    }),
    nativeDelete: jest.fn(async (entityClass: unknown) => {
      trace.push(`nativeDelete:${readEntityName(entityClass)}`)
      return 0
    }),
    getUnitOfWork: () => ({ unsetIdentity }),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  return em
}

function readEntityName(entityClass: unknown): string {
  if (typeof entityClass === 'function') return entityClass.name
  return ''
}

type CalcLine = {
  quantity?: number | string | null
  unitPriceNet?: number | string | null
  unitPriceGross?: number | string | null
}

function calculateDocumentTotals(input: { lines: CalcLine[] }) {
  const lines = input.lines.map((line) => {
    const quantity = Number(line.quantity ?? 0)
    const netAmount = quantity * Number(line.unitPriceNet ?? 0)
    const grossAmount = quantity * Number(line.unitPriceGross ?? 0)
    return { line, netAmount, grossAmount, taxAmount: grossAmount - netAmount, discountAmount: 0 }
  })
  const subtotalNetAmount = lines.reduce((sum, line) => sum + line.netAmount, 0)
  const subtotalGrossAmount = lines.reduce((sum, line) => sum + line.grossAmount, 0)
  return {
    totals: {
      subtotalNetAmount,
      subtotalGrossAmount,
      discountTotalAmount: 0,
      taxTotalAmount: subtotalGrossAmount - subtotalNetAmount,
      shippingNetAmount: 0,
      shippingGrossAmount: 0,
      surchargeTotalAmount: 0,
      grandTotalNetAmount: subtotalNetAmount,
      grandTotalGrossAmount: subtotalGrossAmount,
      paidTotalAmount: 0,
      refundedTotalAmount: 0,
      outstandingAmount: subtotalGrossAmount,
    },
    lines,
  }
}

type Harness = {
  em: TestEntityManager
  ctx: unknown
  emitEvent: jest.Mock
  trace: string[]
}

function makeHarness(world: World, tenantId: string = TENANT_ID): Harness {
  const trace: string[] = []
  const em = makeEm(world, trace)
  const emitEvent = jest.fn(async (eventId: string) => {
    trace.push(`emit:${eventId}`)
  })
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    eventBus: asValue({ emitEvent }),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue({
      calculateDocumentTotals: jest.fn(async (input: { lines: CalcLine[] }) =>
        calculateDocumentTotals(input),
      ),
    }),
  })
  const ctx = {
    container,
    auth: { tenantId, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/order-lines', { method: 'POST' }),
  }
  return { em, ctx, emitEvent, trace }
}

function newLineBody(index: number, overrides: TestWhere = {}): TestWhere {
  return {
    kind: 'product',
    name: `Added ${index}`,
    currencyCode: 'USD',
    quantity: index,
    unitPriceNet: 10 * index,
    unitPriceGross: 12 * index,
    taxRate: 20,
    ...overrides,
  }
}

function bulkHandler() {
  const handler = commandRegistry.get('sales.orders.lines.upsert_many')
  if (!handler) throw new Error('[internal] bulk order-line command is not registered')
  return handler
}

type BulkResult = { orderId: string; lineIds: string[] }

async function runBulk(world: World, body: TestWhere, tenantId: string = TENANT_ID) {
  const harness = makeHarness(world, tenantId)
  let caught: unknown
  let result: BulkResult | undefined
  try {
    result = (await bulkHandler().execute(
      { body: { organizationId: ORG_ID, tenantId: TENANT_ID, orderId: ORDER_ID, ...body } } as never,
      harness.ctx as never,
    )) as BulkResult
  } catch (err) {
    caught = err
  }
  return { ...harness, caught, result }
}

async function runSingle(world: World, body: TestWhere) {
  const harness = makeHarness(world)
  const handler = commandRegistry.get('sales.orders.lines.upsert')
  if (!handler) throw new Error('[internal] per-line order-line command is not registered')
  return (await handler.execute(
    { body: { organizationId: ORG_ID, tenantId: TENANT_ID, orderId: ORDER_ID, ...body } } as never,
    harness.ctx as never,
  )) as { orderId: string; lineId: string }
}

const projectLine = (line: TestLine) => ({
  lineNumber: line.lineNumber,
  name: line.name,
  quantity: line.quantity,
  unitPriceNet: line.unitPriceNet,
  unitPriceGross: line.unitPriceGross,
  taxRate: line.taxRate,
  taxAmount: line.taxAmount,
  totalNetAmount: line.totalNetAmount,
  totalGrossAmount: line.totalGrossAmount,
})

const projectOrder = (order: TestOrder) => ({
  lineItemCount: order.lineItemCount,
  subtotalNetAmount: order.subtotalNetAmount,
  subtotalGrossAmount: order.subtotalGrossAmount,
  taxTotalAmount: order.taxTotalAmount,
  grandTotalNetAmount: order.grandTotalNetAmount,
  grandTotalGrossAmount: order.grandTotalGrossAmount,
})

const orderedLines = (world: World) =>
  [...world.lines].sort((left, right) => left.lineNumber - right.lineNumber)

const lineNames = (world: World) => orderedLines(world).map((line) => line.name)

const conflictMessage = (caught: unknown): string =>
  isCrudHttpError(caught) ? String((caught as CrudHttpError).body?.error ?? '') : ''

describe('sales.orders.lines.upsert_many', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  it('reaches the same line set and totals as the equivalent sequence of single upserts', async () => {
    const added = [newLineBody(1), newLineBody(2), newLineBody(3)]

    const sequentialWorld = makeWorld(1)
    for (const line of added) {
      await runSingle(sequentialWorld, line)
    }

    const bulkWorld = makeWorld(1)
    const { caught, result } = await runBulk(bulkWorld, { lines: added })

    expect(caught).toBeUndefined()
    expect(result?.lineIds).toHaveLength(3)
    expect(orderedLines(bulkWorld).map(projectLine)).toEqual(
      orderedLines(sequentialWorld).map(projectLine),
    )
    expect(projectOrder(bulkWorld.order)).toEqual(projectOrder(sequentialWorld.order))
    expect(bulkWorld.order.lineItemCount).toBe(4)
  })

  it('loads the order lines once for the whole batch instead of once per line', async () => {
    const bulkWorld = makeWorld(1)
    const { em } = await runBulk(bulkWorld, {
      lines: [newLineBody(1), newLineBody(2), newLineBody(3), newLineBody(4)],
    })
    expect(em.findCounts.SalesOrderLine).toBe(1)
  })

  it('updates a line by id and appends an id-less line in the same call', async () => {
    const world = makeWorld(2)
    const existingId = world.lines[0].id
    const { caught, result } = await runBulk(world, {
      lines: [
        { id: existingId, ...newLineBody(5, { name: 'Renamed' }) },
        newLineBody(6, { name: 'Appended' }),
      ],
    })

    expect(caught).toBeUndefined()
    expect(result?.lineIds?.[0]).toBe(existingId)
    expect(lineNames(world)).toEqual(['Renamed', 'Line 2', 'Appended'])
    expect(world.lines.find((line) => line.id === existingId)?.name).toBe('Renamed')
  })

  it('deletes the listed lines while upserting the others in the same call', async () => {
    const world = makeWorld(3)
    const deletedId = world.lines[1].id
    const { caught } = await runBulk(world, {
      lines: [newLineBody(7, { name: 'Appended' })],
      deleteIds: [deletedId],
    })

    expect(caught).toBeUndefined()
    expect(lineNames(world)).toEqual(['Line 1', 'Line 3', 'Appended'])
    expect(orderedLines(world).map((line) => line.lineNumber)).toEqual([1, 2, 3])
  })

  it('refuses a batch that would leave the order with no lines', async () => {
    const world = makeWorld(1)
    const { caught, em } = await runBulk(world, { deleteIds: [world.lines[0].id] })

    expect(conflictMessage(caught)).toBe('An order must contain at least one line item.')
    expect(em.flush).not.toHaveBeenCalled()
    expect(world.lines).toHaveLength(1)
  })

  it('refuses to delete a line that has shipped items', async () => {
    const world = makeWorld(2)
    const shippedLineId = world.lines[0].id
    world.shipments.push({ id: 'shipment-1', deletedAt: null })
    world.shipmentItems.push({
      id: 'shipment-item-1',
      shipment: { id: 'shipment-1' },
      orderLine: shippedLineId,
      quantity: '1',
    })

    const { caught, em } = await runBulk(world, { deleteIds: [shippedLineId] })

    expect(conflictMessage(caught)).toBe('Cannot delete a line that has shipped items.')
    expect(em.flush).not.toHaveBeenCalled()
    expect(world.lines).toHaveLength(2)
  })

  it('moves a line earlier when lineNumber names an earlier position', async () => {
    const world = makeWorld(3)
    const { caught } = await runBulk(world, {
      lines: [{ id: world.lines[2].id, currencyCode: 'USD', quantity: 1, lineNumber: 2 }],
    })

    expect(caught).toBeUndefined()
    expect(lineNames(world)).toEqual(['Line 1', 'Line 3', 'Line 2'])
  })

  it('moves a line later when lineNumber names a later position', async () => {
    const world = makeWorld(3)
    const { caught } = await runBulk(world, {
      lines: [{ id: world.lines[0].id, currencyCode: 'USD', quantity: 1, lineNumber: 2 }],
    })

    expect(caught).toBeUndefined()
    expect(lineNames(world)).toEqual(['Line 2', 'Line 1', 'Line 3'])
  })

  it('leaves the order unchanged when lineNumber names the line it already occupies', async () => {
    const world = makeWorld(3)
    const { caught } = await runBulk(world, {
      lines: [{ id: world.lines[1].id, currencyCode: 'USD', quantity: 1, lineNumber: 2 }],
    })

    expect(caught).toBeUndefined()
    expect(lineNames(world)).toEqual(['Line 1', 'Line 2', 'Line 3'])
  })

  it('preserves the per-line status entry of lines the batch does not touch', async () => {
    const world = makeWorld(2)
    world.lines[1].statusEntryId = STATUS_ENTRY_ID
    await runBulk(world, { lines: [newLineBody(1, { name: 'Appended' })] })

    expect(world.lines.find((line) => line.name === 'Line 2')?.statusEntryId).toBe(
      STATUS_ENTRY_ID,
    )
  })

  it('writes nothing when one entry in the batch is refused', async () => {
    const world = makeWorld(2, { status: 'fulfilled' })
    const { caught, em } = await runBulk(world, {
      lines: [
        { id: world.lines[0].id, currencyCode: 'USD', quantity: 4, name: 'Edited' },
        newLineBody(1, { name: 'Appended' }),
      ],
    })

    expect(conflictMessage(caught)).toContain('fulfilled order')
    expect(em.flush).not.toHaveBeenCalled()
    expect(lineNames(world)).toEqual(['Line 1', 'Line 2'])
  })

  it('publishes the recalculated totals once, after the write commits', async () => {
    const world = makeWorld(1)
    const { caught, emitEvent, trace } = await runBulk(world, {
      lines: [newLineBody(1, { name: 'Appended' })],
    })

    expect(caught).toBeUndefined()
    const totalsEmissions = emitEvent.mock.calls.filter(([eventId]) => eventId === TOTALS_EVENT)
    expect(totalsEmissions).toHaveLength(1)
    expect(totalsEmissions[0][1]).toMatchObject({
      documentKind: 'order',
      documentId: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      lineCount: 2,
    })
    expect(trace.indexOf(`emit:${TOTALS_EVENT}`)).toBeGreaterThan(trace.lastIndexOf('commit'))
  })

  it('publishes no totals when the write fails to flush', async () => {
    const world = makeWorld(1)
    const harness = makeHarness(world)
    harness.em.flush.mockRejectedValue(new Error('[internal] flush failed'))

    await expect(
      bulkHandler().execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: ORDER_ID,
            lines: [newLineBody(1, { name: 'Appended' })],
          },
        } as never,
        harness.ctx as never,
      ),
    ).rejects.toThrow('flush failed')

    expect(harness.emitEvent).not.toHaveBeenCalled()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
    expect(harness.em.commit).not.toHaveBeenCalled()
  })

  it('publishes no totals when the write fails to commit', async () => {
    const world = makeWorld(1)
    const harness = makeHarness(world)
    harness.em.commit.mockRejectedValue(new Error('[internal] commit failed'))

    await expect(
      bulkHandler().execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: ORDER_ID,
            lines: [newLineBody(1, { name: 'Appended' })],
          },
        } as never,
        harness.ctx as never,
      ),
    ).rejects.toThrow('commit failed')

    expect(harness.emitEvent).not.toHaveBeenCalled()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
  })

  it('records one audit entry whose undo payload holds the pre-batch line set', async () => {
    const world = makeWorld(2)
    const before = { order: world.order, lines: orderedLines(world).map(projectLine) }
    await runBulk(world, { lines: [newLineBody(1, { name: 'Appended' })] })

    const log = await bulkHandler().buildLog!({
      input: {} as never,
      result: { orderId: ORDER_ID, lineIds: [] } as never,
      ctx: {} as never,
      snapshots: {
        before,
        after: { order: { tenantId: TENANT_ID, organizationId: ORG_ID }, lines: [] },
      },
    })

    expect(log?.actionLabel).toBe('Update order lines')
    expect(log?.resourceId).toBe(ORDER_ID)
    expect((log?.payload as { undo: { before: unknown } }).undo.before).toBe(before)
  })

  it('restores the order graph inside one transaction when undoing a batch', async () => {
    const world = makeWorld(2)
    const harness = makeHarness(world)

    await bulkHandler().undo!({
      input: {} as never,
      ctx: harness.ctx as never,
      logEntry: { commandPayload: { undo: { before: undoSnapshot() } } } as never,
    })

    expect(harness.em.begin).toHaveBeenCalledTimes(1)
    expect(harness.em.commit).toHaveBeenCalledTimes(1)
    expect(harness.em.rollback).not.toHaveBeenCalled()
    expect(harness.trace.indexOf('begin')).toBeLessThan(
      harness.trace.findIndex((entry) => entry.startsWith('nativeDelete:')),
    )
  })

  it('rolls the undo back when the graph restore fails after deleting the old lines', async () => {
    const world = makeWorld(2)
    const harness = makeHarness(world)
    harness.em.nativeDelete.mockImplementation(async (entityClass: unknown) => {
      harness.trace.push(`nativeDelete:${readEntityName(entityClass)}`)
      if (readEntityName(entityClass) === 'SalesOrderLine') {
        throw new Error('[internal] line delete failed')
      }
      return 0
    })

    await expect(
      bulkHandler().undo!({
        input: {} as never,
        ctx: harness.ctx as never,
        logEntry: { commandPayload: { undo: { before: undoSnapshot() } } } as never,
      }),
    ).rejects.toThrow('line delete failed')

    expect(harness.em.begin).toHaveBeenCalledTimes(1)
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
    expect(harness.em.commit).not.toHaveBeenCalled()
  })

  it('fails with the not-found error when the order id is unknown', async () => {
    const world = makeWorld(1)
    const harness = makeHarness(world)
    await expect(
      bulkHandler().execute(
        {
          body: {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            orderId: MISSING_ORDER_ID,
            lines: [newLineBody(1)],
          },
        } as never,
        harness.ctx as never,
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('refuses a batch whose caller is scoped to a different tenant', async () => {
    const world = makeWorld(1)
    const { caught, em } = await runBulk(
      world,
      { lines: [newLineBody(1)] },
      OTHER_TENANT_ID,
    )

    expect(caught).toBeDefined()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses a batch that upserts and deletes the same line id', async () => {
    const world = makeWorld(2)
    const lineId = world.lines[0].id
    const { caught, em } = await runBulk(world, {
      lines: [{ id: lineId, currencyCode: 'USD', quantity: 2 }],
      deleteIds: [lineId],
    })

    expect(caught).toBeDefined()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses a batch that carries neither lines nor deleteIds', async () => {
    const world = makeWorld(1)
    const { caught, em } = await runBulk(world, { lines: [], deleteIds: [] })

    expect(caught).toBeDefined()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

/** The pre-batch order graph an undo restores, trimmed to what it reads. */
function undoSnapshot() {
  return {
    order: {
      id: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      orderNumber: 'SO-1',
      currencyCode: 'USD',
      status: 'draft',
      lineItemCount: 2,
    },
    lines: [],
    adjustments: [],
    addresses: [],
    notes: [],
    tags: [],
    shipments: [],
    payments: [],
  }
}
