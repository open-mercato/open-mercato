/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'

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
  coerceShipmentQuantity: (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0),
  readShipmentItemsSnapshot: jest.fn().mockReturnValue([]),
  refreshShipmentItemsSnapshot: jest.fn().mockResolvedValue(undefined),
  buildShipmentItemSnapshots: jest.fn().mockReturnValue([]),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_SHIPMENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function buildMockTx() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(0),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn(),
  }
}

function buildEnvelope(snapshotPayload: Record<string, unknown>) {
  const tx = buildMockTx()
  const transactional = jest.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
    return callback(tx)
  })
  const em = { ...buildMockTx(), transactional }
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
  const logEntry = { payload: { undo: snapshotPayload } } as any
  return { tx, em, transactional, container, ctx, logEntry }
}

// ---------------------------------------------------------------------------
// Regression: shipment undo handlers must wrap recomputeFulfilledQuantities in
// a transaction because it issues PESSIMISTIC_WRITE locks. Without an active
// transaction the driver throws and the request 500s. (issue #1541)
// ---------------------------------------------------------------------------

describe('shipment undo handlers — transactional wrapping', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../shipments')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
  })

  it('createShipmentCommand.undo runs inside em.transactional', async () => {
    const undo = commandRegistry.get('sales.shipments.create')?.undo
    expect(undo).toBeInstanceOf(Function)

    const envelope = buildEnvelope({
      after: {
        id: TEST_SHIPMENT_ID,
        orderId: TEST_ORDER_ID,
        organizationId: TEST_ORG_ID,
        tenantId: TEST_TENANT_ID,
        items: [],
      },
    })

    await undo?.({ logEntry: envelope.logEntry, ctx: envelope.ctx as any } as any)

    expect(envelope.transactional).toHaveBeenCalledTimes(1)
  })

  it('updateShipmentCommand.undo runs inside em.transactional', async () => {
    const undo = commandRegistry.get('sales.shipments.update')?.undo
    expect(undo).toBeInstanceOf(Function)

    const envelope = buildEnvelope({
      before: {
        id: TEST_SHIPMENT_ID,
        orderId: TEST_ORDER_ID,
        organizationId: TEST_ORG_ID,
        tenantId: TEST_TENANT_ID,
        items: [],
      },
    })

    await undo?.({ logEntry: envelope.logEntry, ctx: envelope.ctx as any } as any)

    expect(envelope.transactional).toHaveBeenCalledTimes(1)
  })

  it('deleteShipmentCommand.undo runs inside em.transactional', async () => {
    const undo = commandRegistry.get('sales.shipments.delete')?.undo
    expect(undo).toBeInstanceOf(Function)

    const envelope = buildEnvelope({
      before: {
        id: TEST_SHIPMENT_ID,
        orderId: TEST_ORDER_ID,
        organizationId: TEST_ORG_ID,
        tenantId: TEST_TENANT_ID,
        items: [],
      },
    })

    await undo?.({ logEntry: envelope.logEntry, ctx: envelope.ctx as any } as any)

    expect(envelope.transactional).toHaveBeenCalledTimes(1)
  })
})

describe('restoreShipmentSnapshot custom fields (issue #6449)', () => {
  it('writes snapshot custom fields under their definition keys, not cf_-prefixed', async () => {
    const { restoreShipmentSnapshot } = await import('../shipments')
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue({ id: TEST_ORDER_ID })
    ;(setRecordCustomFields as jest.Mock).mockClear()
    const tx = buildMockTx()
    tx.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))

    await restoreShipmentSnapshot(tx as any, {
      id: TEST_SHIPMENT_ID,
      orderId: TEST_ORDER_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      weightValue: null,
      declaredValueNet: null,
      declaredValueGross: null,
      items: [],
      customFields: { cf_carrier_ref: 'R-1', cf_tags: ['a', 'b'] },
    } as any)

    expect(setRecordCustomFields).toHaveBeenCalledTimes(1)
    expect((setRecordCustomFields as jest.Mock).mock.calls[0][1].values).toEqual({
      carrier_ref: 'R-1',
      tags: ['a', 'b'],
    })
  })

  it('purges stale item custom fields and restores each item under its original id (issue #10904 review)', async () => {
    const { restoreShipmentSnapshot } = await import('../shipments')
    const TEST_LINE_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
    const STALE_ITEM_ID = 'ffffffff-ffff-4fff-afff-ffffffffffff'
    const RESTORED_ITEM_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'

    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue({ id: TEST_ORDER_ID })
    ;(setRecordCustomFields as jest.Mock).mockClear()
    const tx = buildMockTx()
    tx.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
    tx.find
      .mockImplementationOnce(() => Promise.resolve([{ id: STALE_ITEM_ID }])) // existing shipment items
      .mockImplementationOnce(() => Promise.resolve([{ id: TEST_LINE_ID }])) // order lines for restored items

    await restoreShipmentSnapshot(tx as any, {
      id: TEST_SHIPMENT_ID,
      orderId: TEST_ORDER_ID,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      weightValue: null,
      declaredValueNet: null,
      declaredValueGross: null,
      items: [{ id: RESTORED_ITEM_ID, orderLineId: TEST_LINE_ID, quantity: 1, metadata: null }],
      itemCustomFields: { [RESTORED_ITEM_ID]: { priority: 'high' } },
    } as any)

    expect(tx.nativeDelete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recordId: { $in: [STALE_ITEM_ID] },
        $or: [{ tenantId: TEST_TENANT_ID }, { tenantId: null }],
      }),
    )
    const itemCreateCall = (tx.create as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.quantity !== undefined,
    )
    expect(itemCreateCall?.[1]).toMatchObject({ id: RESTORED_ITEM_ID })
    const itemCustomFieldsCall = (setRecordCustomFields as jest.Mock).mock.calls.find(
      (args: unknown[]) => (args[1] as Record<string, unknown>)?.recordId === RESTORED_ITEM_ID,
    )
    expect(itemCustomFieldsCall?.[1]).toMatchObject({ values: { priority: 'high' } })
  })
})
