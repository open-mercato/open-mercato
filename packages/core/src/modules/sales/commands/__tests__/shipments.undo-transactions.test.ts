/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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
