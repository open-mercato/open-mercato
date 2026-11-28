/** @jest-environment node */

/**
 * Order lines that reference a catalog service are hidden from the shipment
 * dialog, and the shipment commands enforce the same rule server-side: an item
 * pointing at a line with a `serviceId` is rejected before anything is written,
 * while ordinary product lines keep shipping.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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
const SERVICE_ID = '99999999-9999-4999-8999-999999999999'

const findOneMock = findOneWithDecryption as jest.Mock
const findMock = findWithDecryption as jest.Mock

type MockEm = {
  getKysely: () => { selectFrom: () => LockQuery }
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  remove: jest.Mock
  flush: jest.Mock
  getReference: jest.Mock
}

type LockQuery = {
  select: () => LockQuery
  where: () => LockQuery
  forNoKeyUpdate: () => LockQuery
  executeTakeFirst: () => Promise<{ id: string }>
}

function buildMockEm(): MockEm {
  const query: LockQuery = {
    select: () => query,
    where: () => query,
    forNoKeyUpdate: () => query,
    executeTakeFirst: async () => ({ id: ORDER_ID }),
  }
  return {
    getKysely: () => ({ selectFrom: () => query }),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      ...data,
      id: data.id ?? 'new-shipment-id',
    })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
  }
}

function buildCtx(tx: MockEm): CommandRuntimeContext {
  const em = {
    ...buildMockEm(),
    transactional: jest.fn(async (callback: (trx: MockEm) => Promise<unknown>) => callback(tx)),
  }
  const container = {
    resolve: jest.fn((name: string) => (name === 'em' ? { fork: () => em } : {})),
  }
  return {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: null,
  } as unknown as CommandRuntimeContext
}

const order = {
  id: ORDER_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  deletedAt: null,
  paidTotalAmount: '0',
  refundedTotalAmount: '0',
  grandTotalGrossAmount: '100',
}

const serviceLine = { id: LINE_ID, lineNumber: 3, quantity: '2', fulfilledQuantity: '0', serviceId: SERVICE_ID }
const productLine = { id: LINE_ID, lineNumber: 1, quantity: '5', fulfilledQuantity: '0', serviceId: null }

describe('shipment commands reject catalog service lines', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../shipments')
  })

  beforeEach(() => {
    findOneMock.mockReset().mockResolvedValue(null)
    findMock.mockReset().mockResolvedValue([])
  })

  it('sales.shipments.create rejects an item on a service line before writing', async () => {
    const tx = buildMockEm()
    findOneMock.mockResolvedValue(order)
    findMock.mockResolvedValueOnce([serviceLine]).mockResolvedValue([])

    await expect(
      commandRegistry.get('sales.shipments.create')!.execute(
        {
          orderId: ORDER_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          items: [{ orderLineId: LINE_ID, quantity: 1 }],
        },
        buildCtx(tx),
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'sales.shipments.service_line_not_shippable' },
    })

    expect(tx.create).not.toHaveBeenCalled()
    expect(tx.persist).not.toHaveBeenCalled()
    expect(tx.flush).not.toHaveBeenCalled()
  })

  it('sales.shipments.create still ships a product line', async () => {
    const tx = buildMockEm()
    findOneMock.mockResolvedValue(order)
    findMock
      .mockResolvedValueOnce([productLine])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([productLine])
      .mockResolvedValue([])

    const result = await commandRegistry.get('sales.shipments.create')!.execute(
      {
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        items: [{ orderLineId: LINE_ID, quantity: 2 }],
      },
      buildCtx(tx),
    )

    expect(result).toMatchObject({ shipmentId: expect.any(String) })
    expect(tx.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderLine: { id: LINE_ID }, quantity: '2' }),
    )
  })

  it('sales.shipments.update rejects an item on a service line before mutating the shipment', async () => {
    const tx = buildMockEm()
    const shipment = {
      id: SHIPMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      order,
      carrierName: 'Original carrier',
      status: null,
    }
    findOneMock.mockResolvedValue(shipment)
    findMock.mockResolvedValueOnce([serviceLine]).mockResolvedValue([])

    await expect(
      commandRegistry.get('sales.shipments.update')!.execute(
        {
          id: SHIPMENT_ID,
          orderId: ORDER_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          carrierName: 'Changed carrier',
          items: [{ orderLineId: LINE_ID, quantity: 1 }],
        },
        buildCtx(tx),
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'sales.shipments.service_line_not_shippable' },
    })

    expect(shipment.carrierName).toBe('Original carrier')
    expect(tx.create).not.toHaveBeenCalled()
    expect(tx.flush).not.toHaveBeenCalled()
  })

  describe('sales.shipments.delete undo', () => {
    const snapshot = {
      id: SHIPMENT_ID,
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      shipmentNumber: 'SH-1',
      items: [{ id: 'item-1', orderLineId: LINE_ID, orderLineName: 'Line', orderLineNumber: 3, quantity: 1, metadata: null }],
    }
    const logEntry = { commandPayload: { undo: { before: snapshot } } }

    it('refuses to restore a shipment whose line now references a catalog service', async () => {
      const tx = buildMockEm()
      findMock.mockResolvedValueOnce([serviceLine]).mockResolvedValue([])

      await expect(
        commandRegistry.get('sales.shipments.delete')!.undo!({ logEntry, ctx: buildCtx(tx) } as never),
      ).rejects.toMatchObject({
        status: 409,
        body: { error: 'sales.shipments.undo_service_line' },
      })

      expect(findMock).toHaveBeenCalledWith(
        tx,
        expect.anything(),
        expect.objectContaining({ id: { $in: [LINE_ID] }, tenantId: TENANT_ID, organizationId: ORG_ID }),
        {},
        { tenantId: TENANT_ID, organizationId: ORG_ID },
      )
      expect(tx.create).not.toHaveBeenCalled()
      expect(tx.persist).not.toHaveBeenCalled()
      expect(tx.flush).not.toHaveBeenCalled()
    })

    it('looks the restored lines up before restoring a product-line shipment', async () => {
      const tx = buildMockEm()
      findMock.mockResolvedValueOnce([productLine]).mockResolvedValue([])

      await commandRegistry.get('sales.shipments.delete')!.undo!({ logEntry, ctx: buildCtx(tx) } as never).catch(() => undefined)

      expect(findMock.mock.calls[0][2]).toEqual(expect.objectContaining({ id: { $in: [LINE_ID] } }))
      expect(tx.flush).toHaveBeenCalled()
    })
  })

  describe('restoring shipment items through redo and update undo', () => {
    const snapshot = {
      id: SHIPMENT_ID,
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      shipmentNumber: 'SH-1',
      items: [{ id: 'item-1', orderLineId: LINE_ID, orderLineName: 'Line', orderLineNumber: 3, quantity: 1, metadata: null }],
    }

    it('refuses to redo a shipment create once its line references a catalog service', async () => {
      const tx = buildMockEm()
      findMock.mockResolvedValueOnce([serviceLine]).mockResolvedValue([])

      await expect(
        commandRegistry.get('sales.shipments.create')!.redo!({
          input: {},
          ctx: buildCtx(tx),
          logEntry: { resourceId: SHIPMENT_ID, commandPayload: { undo: { after: snapshot } }, snapshotAfter: snapshot },
        } as never),
      ).rejects.toMatchObject({ status: 409, body: { error: 'sales.shipments.undo_service_line' } })

      expect(tx.create).not.toHaveBeenCalled()
      expect(tx.flush).not.toHaveBeenCalled()
    })

    it('refuses to undo a shipment update that would put a service line back on the shipment', async () => {
      const tx = buildMockEm()
      findMock.mockResolvedValueOnce([serviceLine]).mockResolvedValue([])

      await expect(
        commandRegistry.get('sales.shipments.update')!.undo!({
          logEntry: { commandPayload: { undo: { before: snapshot, after: { ...snapshot, items: [] } } } },
          ctx: buildCtx(tx),
        } as never),
      ).rejects.toMatchObject({ status: 409, body: { error: 'sales.shipments.undo_service_line' } })

      expect(findMock.mock.calls[0][2]).toEqual(
        expect.objectContaining({ id: { $in: [LINE_ID] }, tenantId: TENANT_ID, organizationId: ORG_ID }),
      )
      expect(tx.create).not.toHaveBeenCalled()
      expect(tx.flush).not.toHaveBeenCalled()
    })
  })
})
