/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Asn, PutawayTask, ReceivingLine, WarehouseLocation } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const applyInventoryReceiveInTransaction = jest.fn()
const emitInventoryReceiveSideEffects = jest.fn(async () => undefined)

jest.mock('../inventory-actions', () => ({
  applyInventoryReceiveInTransaction: (...args: unknown[]) => applyInventoryReceiveInTransaction(...args),
  emitInventoryReceiveSideEffects: (...args: unknown[]) => emitInventoryReceiveSideEffects(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ASN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WH_ID = '55555555-5555-4555-8555-555555555555'
const LOC_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'

function createEm() {
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: `task-${String(payload.serialNumber ?? 'aggregate')}`,
      ...payload,
    })),
    persist: jest.fn(() => ({ flush: jest.fn(async () => undefined) })),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
    transactional: jest.fn(),
    getConnection: jest.fn(() => ({
      execute: jest.fn(async () => []),
    })),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (cb: (trx: typeof em) => Promise<unknown>) => cb(em))
  return em
}

function createCtx(em: ReturnType<typeof createEm>) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function asn() {
  return {
    id: ASN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WH_ID },
    status: 'in_transit',
    referenceNumber: null,
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
  }
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: LINE_ID,
    tenantId: TENANT,
    organizationId: ORG,
    asn: ASN_ID,
    catalogVariantId: VARIANT_ID,
    expectedQty: '2',
    receivedQty: '0',
    lotNumber: null,
    serialNumbers: null as string[] | null,
    qcStatus: 'pending',
    targetStagingLocationId: null,
    rejectionReason: null,
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function receiveInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    asnId: ASN_ID,
    lineId: LINE_ID,
    receivedQty: 2,
    targetReceivedQty: 2,
    targetStagingLocationId: LOC_ID,
    qcStatus: 'passed' as const,
    performedBy: USER_ID,
    ...overrides,
  }
}

describe('wms.asns.receive-line serial identity', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    applyInventoryReceiveInTransaction.mockReset()
    emitInventoryReceiveSideEffects.mockClear()
    applyInventoryReceiveInTransaction.mockImplementation(async (_trx, _ctx, input: { serialNumber?: string }) => ({
      movementId: `mov-${input.serialNumber ?? 'bulk'}`,
      lotId: null,
      balances: [],
    }))
  })

  it.each(['passed', 'failed'] as const)(
    'rejects duplicate serials (%s) before any write, including whitespace variants',
    async (qcStatus) => {
      const em = createEm()
      const ctx = createCtx(em)
      const receivingLine = line()
      findOneWithDecryption.mockResolvedValue(null)

      const handler = commandRegistry.get('wms.asns.receive-line')
      await expect(
        handler!.execute(
          receiveInput({
            qcStatus,
            serialNumbers: ['S1', ' S1 '],
            rejectionReason: qcStatus === 'failed' ? 'damaged' : undefined,
          }),
          ctx as never,
        ),
      ).rejects.toMatchObject({ status: 422, body: { error: 'duplicate_serial' } })

      expect(em.transactional).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
      expect(applyInventoryReceiveInTransaction).not.toHaveBeenCalled()
      expect(receivingLine.receivedQty).toBe('0')
      expect(em.create).not.toHaveBeenCalled()
    },
  )

  it('creates one quantity-one putaway task per serial', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const receivingLine = line()
    findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
      if (entity === Asn) return asn()
      if (entity === ReceivingLine) return receivingLine
      if (entity === WarehouseLocation) {
        return {
          id: (where as { id?: string }).id,
          tenantId: TENANT,
          organizationId: ORG,
          warehouse: { id: WH_ID },
          type: 'staging',
          isActive: true,
        }
      }
      if (entity === PutawayTask) return null
      return null
    })
    findWithDecryption.mockResolvedValue([])

    const handler = commandRegistry.get('wms.asns.receive-line')
    const result = await handler!.execute(
      receiveInput({ serialNumbers: ['S1', 'S2'] }),
      ctx as never,
    )

    expect(applyInventoryReceiveInTransaction).toHaveBeenCalledTimes(2)
    expect(applyInventoryReceiveInTransaction).toHaveBeenNthCalledWith(
      1,
      em,
      expect.anything(),
      expect.objectContaining({ serialNumber: 'S1', quantity: 1 }),
    )
    expect(applyInventoryReceiveInTransaction).toHaveBeenNthCalledWith(
      2,
      em,
      expect.anything(),
      expect.objectContaining({ serialNumber: 'S2', quantity: 1 }),
    )
    const tasks = em.create.mock.calls.filter((call) => call[0] === PutawayTask)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((call) => call[1])).toEqual([
      expect.objectContaining({ serialNumber: 'S1', quantity: '1' }),
      expect.objectContaining({ serialNumber: 'S2', quantity: '1' }),
    ])
    expect(result).toEqual(expect.objectContaining({
      putawayTaskIds: ['task-S1', 'task-S2'],
      receivedQty: 2,
    }))
    expect(receivingLine.receivedQty).toBe('2')
    expect(receivingLine.serialNumbers).toEqual(['S1', 'S2'])
  })

  function stubReceiveLookups(
    em: ReturnType<typeof createEm>,
    receivingLine: ReturnType<typeof line>,
  ) {
    findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
      if (entity === Asn) return asn()
      if (entity === ReceivingLine) return receivingLine
      if (entity === WarehouseLocation) {
        return {
          id: (where as { id?: string }).id,
          tenantId: TENANT,
          organizationId: ORG,
          warehouse: { id: WH_ID },
          type: 'staging',
          isActive: true,
        }
      }
      if (entity === PutawayTask) return null
      return null
    })
    findWithDecryption.mockResolvedValue([])
    return em
  }

  it('rejects a second receipt of the same serial without writes', async () => {
    const em = createEm()
    const receivingLine = line({
      expectedQty: '4',
      receivedQty: '1',
      serialNumbers: ['S1'],
      qcStatus: 'passed',
    })
    stubReceiveLookups(em, receivingLine)

    const handler = commandRegistry.get('wms.asns.receive-line')
    await expect(
      handler!.execute(
        receiveInput({
          receivedQty: 1,
          targetReceivedQty: 2,
          serialNumbers: ['S1'],
        }),
        createCtx(em) as never,
      ),
    ).rejects.toMatchObject({ status: 422, body: { error: 'duplicate_serial' } })

    expect(applyInventoryReceiveInTransaction).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(receivingLine.receivedQty).toBe('1')
    expect(receivingLine.serialNumbers).toEqual(['S1'])
  })

  it('appends a later serial without dropping the earlier one', async () => {
    const em = createEm()
    const receivingLine = line({ expectedQty: '4' })
    stubReceiveLookups(em, receivingLine)
    const handler = commandRegistry.get('wms.asns.receive-line')
    const ctx = createCtx(em)

    await handler!.execute(
      receiveInput({ receivedQty: 1, targetReceivedQty: 1, serialNumbers: ['S1'] }),
      ctx as never,
    )
    expect(receivingLine.serialNumbers).toEqual(['S1'])
    expect(receivingLine.receivedQty).toBe('1')

    await handler!.execute(
      receiveInput({ receivedQty: 1, targetReceivedQty: 2, serialNumbers: ['S2'] }),
      ctx as never,
    )

    expect(applyInventoryReceiveInTransaction).toHaveBeenLastCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ serialNumber: 'S2', quantity: 1 }),
    )
    expect(receivingLine.receivedQty).toBe('2')
    expect(receivingLine.serialNumbers).toEqual(['S1', 'S2'])
  })

  it('retries an already-received serial pair without a second receipt or aggregate task', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const receivingLine = line({ receivedQty: '2', serialNumbers: ['S1', 'S2'], qcStatus: 'passed' })
    const byKey = new Map<string, { id: string; quantity: string; status: string; serialNumber: string }>()
    findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
      if (entity === Asn) return asn()
      if (entity === ReceivingLine) return receivingLine
      if (entity === WarehouseLocation) {
        return {
          id: (where as { id?: string }).id,
          tenantId: TENANT,
          organizationId: ORG,
          warehouse: { id: WH_ID },
          type: 'staging',
          isActive: true,
        }
      }
      if (entity === PutawayTask) {
        const putawayKey = (where as { putawayKey?: string }).putawayKey
        if (!putawayKey) return null
        const existing = byKey.get(putawayKey)
        if (existing) return existing
        const created = {
          id: `open-${byKey.size + 1}`,
          quantity: '1',
          status: 'open',
          serialNumber: byKey.size === 0 ? 'S1' : 'S2',
        }
        byKey.set(putawayKey, created)
        return created
      }
      return null
    })

    const handler = commandRegistry.get('wms.asns.receive-line')
    const result = await handler!.execute(
      receiveInput({ serialNumbers: ['S1', 'S2'] }),
      ctx as never,
    )

    expect(applyInventoryReceiveInTransaction).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      movementIds: [],
      putawayTaskIds: ['open-1', 'open-2'],
      receivedQty: 2,
    }))
    expect(receivingLine.receivedQty).toBe('2')
  })
})
