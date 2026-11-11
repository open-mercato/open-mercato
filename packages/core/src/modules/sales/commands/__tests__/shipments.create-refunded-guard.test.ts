/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesOrder, SalesOrderLine, SalesShipment } from '../../data/entities'
import type { ShipmentSnapshot } from '../shipments'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../lib/shipments/snapshots', () => ({
  coerceShipmentQuantity: (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0),
  readShipmentItemsSnapshot: jest.fn().mockReturnValue([]),
  refreshShipmentItemsSnapshot: jest.fn().mockResolvedValue(undefined),
  buildShipmentItemSnapshots: jest.fn().mockReturnValue([]),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINE_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const SHIPMENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

type OrderTotals = { paid: string; refunded: string; grandTotal: string }

function buildOrder(totals: OrderTotals) {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
    currencyCode: 'USD',
    status: 'confirmed',
    paidTotalAmount: totals.paid,
    refundedTotalAmount: totals.refunded,
    grandTotalGrossAmount: totals.grandTotal,
  }
}

function buildTx() {
  const lockQuery = {
    select: () => lockQuery,
    where: () => lockQuery,
    forNoKeyUpdate: () => lockQuery,
    executeTakeFirst: jest.fn().mockResolvedValue({ id: ORDER_ID }),
  }
  return {
    getKysely: () => ({ selectFrom: () => lockQuery }),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
  }
}

function buildHarness(totals: OrderTotals) {
  const order = buildOrder(totals)
  const line = { id: LINE_ID, quantity: '5', fulfilledQuantity: '0' }
  ;(findOneWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: unknown) =>
    entity === SalesOrder ? order : null,
  )
  ;(findWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: unknown) =>
    entity === SalesOrderLine ? [line] : [],
  )
  const tx = buildTx()
  const em = { fork: () => em, transactional: jest.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)) }
  const ctx = {
    container: {
      resolve: (name: string) => (name === 'em' ? em : {}),
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: {} as Request,
    organizationScope: null,
  } as unknown as CommandRuntimeContext
  return { tx, ctx }
}

function createInput() {
  return {
    orderId: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    items: [{ orderLineId: LINE_ID, quantity: 2 }],
  }
}

function shipmentCreatedOn(tx: ReturnType<typeof buildTx>): boolean {
  return tx.create.mock.calls.some(([entity]) => entity === SalesShipment)
}

function buildRedoLogEntry(): CommandUndoLogEntry {
  const after: ShipmentSnapshot = {
    id: SHIPMENT_ID,
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    shipmentNumber: 'SHIP-1',
    shippingMethodId: null,
    statusEntryId: null,
    status: null,
    carrierName: null,
    trackingNumbers: null,
    shippedAt: null,
    deliveredAt: null,
    weightValue: null,
    weightUnit: null,
    declaredValueNet: null,
    declaredValueGross: null,
    currencyCode: 'USD',
    notesText: null,
    metadata: null,
    customFields: null,
    items: [],
  }
  return { resourceId: SHIPMENT_ID, payload: { undo: { after } } } as unknown as CommandUndoLogEntry
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return null
}

describe('createShipmentCommand — refuses new shipments on fully refunded orders', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../shipments')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    ['payments fully refunded', { paid: '100.00', refunded: '100.00', grandTotal: '100.00' }],
    ['refunds exceed payments', { paid: '100.00', refunded: '120.00', grandTotal: '100.00' }],
  ])('rejects create with 422 when %s', async (_label, totals) => {
    const handler = commandRegistry.get('sales.shipments.create')
    const { tx, ctx } = buildHarness(totals)

    const error = await captureError(async () => handler?.execute(createInput(), ctx))

    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(422)
    expect((error as CrudHttpError).body).toEqual({ error: 'sales.shipments.create_order_refunded' })
    expect(shipmentCreatedOn(tx)).toBe(false)
  })

  it.each([
    ['fully paid and not refunded', { paid: '100.00', refunded: '0', grandTotal: '100.00' }],
    ['returned goods refunded while other lines remain paid', { paid: '100.00', refunded: '50.00', grandTotal: '50.00' }],
    ['a deposit refunded on an order still due', { paid: '30.00', refunded: '30.00', grandTotal: '100.00' }],
    ['unpaid', { paid: '0', refunded: '0', grandTotal: '100.00' }],
    ['zero total', { paid: '0', refunded: '0', grandTotal: '0' }],
  ])('still creates the shipment when the order is %s', async (_label, totals) => {
    const handler = commandRegistry.get('sales.shipments.create')
    const { tx, ctx } = buildHarness(totals)

    await expect(handler?.execute(createInput(), ctx)).resolves.toEqual({ shipmentId: expect.any(String) })
    expect(shipmentCreatedOn(tx)).toBe(true)
  })

  it('rejects redo with 422 before restoring the shipment when the order was fully refunded after undo', async () => {
    const handler = commandRegistry.get('sales.shipments.create')
    const { tx, ctx } = buildHarness({ paid: '100.00', refunded: '100.00', grandTotal: '100.00' })

    const error = await captureError(async () => handler?.redo?.({ input: createInput(), ctx, logEntry: buildRedoLogEntry() }))

    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(422)
    expect((error as CrudHttpError).body).toEqual({ error: 'sales.shipments.create_order_refunded' })
    expect(shipmentCreatedOn(tx)).toBe(false)
    expect(tx.persist).not.toHaveBeenCalled()
    expect(tx.flush).not.toHaveBeenCalled()
  })

  it('still restores the shipment on redo when the order was not refunded', async () => {
    const handler = commandRegistry.get('sales.shipments.create')
    const { tx, ctx } = buildHarness({ paid: '100.00', refunded: '0', grandTotal: '100.00' })

    await expect(handler?.redo?.({ input: createInput(), ctx, logEntry: buildRedoLogEntry() })).resolves.toEqual({
      shipmentId: SHIPMENT_ID,
    })
    expect(shipmentCreatedOn(tx)).toBe(true)
  })
})
