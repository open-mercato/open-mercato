/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { Asn, ReceivingLine } from '../../data/entities'

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

const emitCrudSideEffectsMock = emitCrudSideEffects as jest.MockedFunction<typeof emitCrudSideEffects>

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ASN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WH_ID = '55555555-5555-4555-8555-555555555555'

function createEm() {
  const em = {
    findOne: jest.fn(),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
    transactional: jest.fn(),
    getConnection: jest.fn(() => ({
      execute: jest.fn(async () => []),
    })),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(
    async (cb: (trx: typeof em) => Promise<unknown>) => cb(em),
  )
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
    auth: { sub: '99999999-9999-4999-8999-999999999999', tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

describe('wms.asns.delete undo', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  it('undo restores soft-deleted receiving lines with the ASN header', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const deletedAt = new Date('2026-08-22T12:00:00.000Z')
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt,
    }
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === Asn) return asn
      return null
    })
    findWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return [line]
      return []
    })

    const handler = commandRegistry.get('wms.asns.delete')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: ASN_ID,
              organizationId: ORG,
              tenantId: TENANT,
              warehouseId: WH_ID,
              vendorId: null,
              status: 'draft',
              expectedAt: '2026-08-20T00:00:00.000Z',
              referenceNumber: null,
              notes: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
            lineIds: [LINE_ID],
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(asn.deletedAt).toBeNull()
    expect(line.deletedAt).toBeNull()
    expect(findWithDecryption).toHaveBeenCalledWith(
      em,
      ReceivingLine,
      { id: { $in: [LINE_ID] }, asn: ASN_ID },
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(em.flush).toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(2)
    expect(emitCrudSideEffectsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'updated',
        entity: asn,
        identifiers: { id: ASN_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
    expect(emitCrudSideEffectsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'updated',
        entity: line,
        identifiers: { id: LINE_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
  })

  it('refuses undo when another active ASN holds the same source_key', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const sourceKey = 'procurement.goods_receipt:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const deletedAt = new Date('2026-08-22T12:00:00.000Z')
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt,
    }
    const replacementAsn = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      tenantId: TENANT,
      organizationId: ORG,
      sourceKey,
      deletedAt: null,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
      if (entity !== Asn) return null
      if (where && typeof where === 'object' && 'id' in where && (where as { id: unknown }).id === ASN_ID) {
        return asn
      }
      if (
        where &&
        typeof where === 'object' &&
        'sourceKey' in where &&
        (where as { sourceKey?: string }).sourceKey === sourceKey
      ) {
        return replacementAsn
      }
      return null
    })

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: ASN_ID,
                organizationId: ORG,
                tenantId: TENANT,
                warehouseId: WH_ID,
                vendorId: null,
                status: 'draft',
                expectedAt: '2026-08-20T00:00:00.000Z',
                referenceNumber: null,
                notes: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
              lineIds: [],
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'asn_source_key_conflict' },
    })
    expect(asn.deletedAt).toEqual(deletedAt)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('maps unique constraint race on undelete flush to asn_source_key_conflict', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const sourceKey = 'procurement.goods_receipt:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const deletedAt = new Date('2026-08-22T12:00:00.000Z')
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
      if (entity !== Asn) return null
      if (where && typeof where === 'object' && 'id' in where && (where as { id: unknown }).id === ASN_ID) {
        return asn
      }
      return null
    })
    em.flush.mockRejectedValueOnce({ code: '23505', name: 'UniqueConstraintViolationException' })

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: ASN_ID,
                organizationId: ORG,
                tenantId: TENANT,
                warehouseId: WH_ID,
                vendorId: null,
                status: 'draft',
                expectedAt: '2026-08-20T00:00:00.000Z',
                referenceNumber: null,
                notes: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
              lineIds: [],
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'asn_source_key_conflict' },
    })
  })
})

describe('wms.receiving-lines.update execute', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  function draftAsn(overrides: Record<string, unknown> = {}) {
    return {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  function pendingLine(overrides: Record<string, unknown> = {}) {
    return {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  it('updates untouched pending line under ASN+line pessimistic locks', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine()
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        // Unlocked probe then locked re-load
        return line
      }
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    const result = await handler!.execute!(
      { id: LINE_ID, expectedQty: 12, lotNumber: 'LOT-A' },
      ctx as never,
    )

    expect(result).toEqual({ lineId: LINE_ID })
    expect(line.expectedQty).toBe('12')
    expect(line.lotNumber).toBe('LOT-A')
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('refuses update when line has receivedQty > 0', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ receivedQty: '4', catalogVariantId: '88888888-8888-4888-8888-888888888888' })
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    await expect(
      handler!.execute!({ id: LINE_ID, expectedQty: 99 }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.expectedQty).toBe('10')
    expect(line.catalogVariantId).toBe('88888888-8888-4888-8888-888888888888')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses update when line QC is not pending', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ qcStatus: 'failed', expectedQty: '10' })
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    await expect(
      handler!.execute!({ id: LINE_ID, targetStagingLocationId: '66666666-6666-4666-8666-666666666666' }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.targetStagingLocationId).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.receiving-lines.delete execute', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  function draftAsn(overrides: Record<string, unknown> = {}) {
    return {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  function pendingLine(overrides: Record<string, unknown> = {}) {
    return {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  it('soft-deletes pending line under ASN+line pessimistic locks', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine()
    const lockOrder: string[] = []
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          lockOrder.push('line')
        }
        return line
      }
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        lockOrder.push('asn')
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.delete')
    const result = await handler!.execute!({ id: LINE_ID }, ctx as never)

    expect(result).toEqual({ lineId: LINE_ID })
    expect(line.deletedAt).toBeInstanceOf(Date)
    expect(lockOrder).toEqual(['asn', 'line'])
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('re-checks activity under locks before soft-delete', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ receivedQty: '0', qcStatus: 'pending' })
    let asnLocked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          expect(asnLocked).toBe(true)
          line.receivedQty = '5'
          line.qcStatus = 'passed'
        }
        return line
      }
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        asnLocked = true
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.delete')
    await expect(handler!.execute!({ id: LINE_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses delete when line has receivedQty > 0', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ receivedQty: '2' })
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.delete')
    await expect(handler!.execute!({ id: LINE_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.receiving-lines.create execute', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  it('creates line under ASN pessimistic lock after mutable assert', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    const createdLine = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return asn
      }
      return null
    })
    em.create.mockReturnValue(createdLine)

    const handler = commandRegistry.get('wms.receiving-lines.create')
    const result = await handler!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        asnId: ASN_ID,
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        expectedQty: 10,
      },
      ctx as never,
    )

    expect(result).toEqual({ lineId: LINE_ID })
    expect(em.transactional).toHaveBeenCalled()
    expect(em.create).toHaveBeenCalledWith(
      ReceivingLine,
      expect.objectContaining({
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        expectedQty: '10',
        receivedQty: '0',
        qcStatus: 'pending',
      }),
    )
    expect(em.persist).toHaveBeenCalledWith(createdLine)
    expect(em.flush).toHaveBeenCalled()
  })

  it('refuses create when ASN is received', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'received',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.create')
    await expect(
      handler!.execute!(
        {
          tenantId: TENANT,
          organizationId: ORG,
          asnId: ASN_ID,
          catalogVariantId: '77777777-7777-4777-8777-777777777777',
          expectedQty: 10,
        },
        ctx as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.asns.delete guards', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  function draftAsn(overrides: Record<string, unknown> = {}) {
    return {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      sourceKey: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null,
      ...overrides,
    }
  }

  function pendingLine(overrides: Record<string, unknown> = {}) {
    return {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null,
      ...overrides,
    }
  }

  it('soft-deletes draft ASN with untouched lines', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine()
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return asn
      }
      return null
    })
    findWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return [line]
      return []
    })
    em.getConnection = jest.fn(() => ({
      execute: jest.fn(async () => []),
    }))

    const handler = commandRegistry.get('wms.asns.delete')
    const result = await handler!.execute!({ id: ASN_ID }, ctx as never)

    expect(result).toEqual({ asnId: ASN_ID })
    expect(asn.deletedAt).toBeInstanceOf(Date)
    expect(line.deletedAt).toBeInstanceOf(Date)
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('re-checks line activity under ASN pessimistic lock before soft-delete', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ receivedQty: '2' })
    let locked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        locked = true
        return asn
      }
      return null
    })
    findWithDecryption.mockImplementation(async () => {
      expect(locked).toBe(true)
      return [line]
    })

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(handler!.execute!({ id: ASN_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(em.transactional).toHaveBeenCalled()
    expect(asn.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('soft-deletes all active lines re-queried under ASN lock', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const lineA = pendingLine({ id: LINE_ID })
    const lineB = pendingLine({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      catalogVariantId: '88888888-8888-4888-8888-888888888888',
    })
    let locked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        locked = true
        return asn
      }
      return null
    })
    findWithDecryption.mockImplementation(async () => {
      expect(locked).toBe(true)
      // Simulate a line created after prepare but before delete flush (create waits on ASN lock).
      return [lineA, lineB]
    })
    em.getConnection = jest.fn(() => ({
      execute: jest.fn(async () => []),
    }))

    const handler = commandRegistry.get('wms.asns.delete')
    await handler!.execute!({ id: ASN_ID }, ctx as never)

    expect(asn.deletedAt).toBeInstanceOf(Date)
    expect(lineA.deletedAt).toBeInstanceOf(Date)
    expect(lineB.deletedAt).toBeInstanceOf(Date)
    expect(lineA.deletedAt).toEqual(lineB.deletedAt)
    expect(em.transactional).toHaveBeenCalled()
  })

  it('refuses delete when ASN status is received', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn({ status: 'received' })
    findOneWithDecryption.mockResolvedValue(asn)

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(handler!.execute!({ id: ASN_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses delete when a line has receivedQty > 0', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ receivedQty: '3' })
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([line])

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(handler!.execute!({ id: ASN_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.deletedAt).toBeNull()
    expect(line.deletedAt).toBeNull()
  })

  it('refuses delete when a line has non-pending QC', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine({ qcStatus: 'failed' })
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([line])

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(handler!.execute!({ id: ASN_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
  })

  it('refuses delete when open putaway exists for the ASN', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = pendingLine()
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([line])
    const execute = jest.fn(async () => [{ hit: 1 }])
    em.getConnection = jest.fn(() => ({ execute }))

    const handler = commandRegistry.get('wms.asns.delete')
    await expect(handler!.execute!({ id: ASN_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'asn_has_open_putaway' },
    })
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("metadata->>'asnId'"),
      [ORG, TENANT, ASN_ID],
    )
    expect(asn.deletedAt).toBeNull()
  })
})

describe('wms.asns.update mutability', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  function mutableAsn(overrides: Record<string, unknown> = {}) {
    return {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null as string | null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null as string | null,
      notes: null as string | null,
      metadata: null as Record<string, unknown> | null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  it('refuses update when ASN status is received', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'received' })
    findOneWithDecryption.mockResolvedValue(asn)

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.execute!({ id: ASN_ID, status: 'draft' }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.status).toBe('received')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses update when ASN status is closed', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'closed' })
    findOneWithDecryption.mockResolvedValue(asn)

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.execute!({ id: ASN_ID, notes: 'x' }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.notes).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses prepare when ASN status is received', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'received' })
    findOneWithDecryption.mockResolvedValue(asn)

    const handler = commandRegistry.get('wms.asns.update')
    await expect(handler!.prepare!({ id: ASN_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
  })

  it('refuses warehouse change on received ASN', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'received' })
    findOneWithDecryption.mockResolvedValue(asn)
    const otherWh = '66666666-6666-4666-8666-666666666666'

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.execute!({ id: ASN_ID, warehouseId: otherWh }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.warehouse).toEqual({ id: WH_ID })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses warehouse/header change after line receipt while still in_transit', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'in_transit' })
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([
      {
        id: LINE_ID,
        receivedQty: '5',
        qcStatus: 'passed',
      },
    ])
    const otherWh = '66666666-6666-4666-8666-666666666666'

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.execute!({ id: ASN_ID, warehouseId: otherWh }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.warehouse).toEqual({ id: WH_ID })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses notes update after QC activity while still in_transit', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'in_transit' })
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([
      {
        id: LINE_ID,
        receivedQty: '0',
        qcStatus: 'failed',
      },
    ])

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.execute!({ id: ASN_ID, notes: 'after qc' }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.notes).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows draft → in_transit status update when lines have no receipt activity', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'draft' })
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return asn
      }
      return null
    })
    findWithDecryption.mockResolvedValue([])

    const handler = commandRegistry.get('wms.asns.update')
    const result = await handler!.execute!({ id: ASN_ID, status: 'in_transit' }, ctx as never)

    expect(result).toEqual({ asnId: ASN_ID })
    expect(asn.status).toBe('in_transit')
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('re-checks line activity under ASN pessimistic lock before header mutate', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = mutableAsn({ status: 'in_transit' })
    let locked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        locked = true
        return asn
      }
      return null
    })
    findWithDecryption.mockImplementation(async () => {
      expect(locked).toBe(true)
      return [{ id: LINE_ID, receivedQty: '1', qcStatus: 'passed' }]
    })

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.execute!({ id: ASN_ID, notes: 'after race' }, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(em.transactional).toHaveBeenCalled()
    expect(asn.notes).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.asns.update undo', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  it('undo restores prior ASN snapshot and emits updated side effects', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: '33333333-3333-4333-8333-333333333333',
      status: 'in_transit',
      expectedAt: new Date('2026-08-21T00:00:00.000Z'),
      referenceNumber: 'changed',
      notes: 'changed',
      metadata: { k: 'v' },
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([])

    const handler = commandRegistry.get('wms.asns.update')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: ASN_ID,
              organizationId: ORG,
              tenantId: TENANT,
              warehouseId: WH_ID,
              vendorId: null,
              status: 'draft',
              expectedAt: '2026-08-20T00:00:00.000Z',
              referenceNumber: null,
              notes: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(asn.status).toBe('draft')
    expect(asn.vendorId).toBeNull()
    expect(asn.referenceNumber).toBeNull()
    expect(asn.notes).toBeNull()
    expect(asn.metadata).toBeNull()
    expect(em.transactional).toHaveBeenCalled()
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      Asn,
      { id: ASN_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(em.flush).toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        entity: asn,
        identifiers: { id: ASN_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
  })

  it('refuses undo after line receipt while still in_transit (would rewrite warehouse)', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'in_transit',
      expectedAt: new Date('2026-08-21T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([{ id: LINE_ID, receivedQty: '3', qcStatus: 'passed' }])

    const handler = commandRegistry.get('wms.asns.update')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: ASN_ID,
                organizationId: ORG,
                tenantId: TENANT,
                warehouseId: '66666666-6666-4666-8666-666666666666',
                vendorId: null,
                status: 'draft',
                expectedAt: '2026-08-20T00:00:00.000Z',
                referenceNumber: null,
                notes: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.warehouse).toEqual({ id: WH_ID })
    expect(asn.status).toBe('in_transit')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['received', 'closed'] as const)(
    'refuses undo when current ASN status is %s (would demote past receipt)',
    async (status) => {
      const em = createEm()
      const ctx = createCtx(em)
      const asn = {
        id: ASN_ID,
        tenantId: TENANT,
        organizationId: ORG,
        warehouse: { id: WH_ID },
        vendorId: null,
        status,
        expectedAt: new Date('2026-08-21T00:00:00.000Z'),
        referenceNumber: 'RCV-1',
        notes: null,
        metadata: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        deletedAt: null as Date | null,
      }
      findOneWithDecryption.mockResolvedValue(asn)

      const handler = commandRegistry.get('wms.asns.update')
      await expect(
        handler!.undo!({
          logEntry: {
            commandPayload: {
              undo: {
                before: {
                  id: ASN_ID,
                  organizationId: ORG,
                  tenantId: TENANT,
                  warehouseId: WH_ID,
                  vendorId: null,
                  status: 'draft',
                  expectedAt: '2026-08-20T00:00:00.000Z',
                  referenceNumber: null,
                  notes: null,
                  metadata: null,
                  createdAt: '2026-08-01T00:00:00.000Z',
                  updatedAt: '2026-08-01T00:00:00.000Z',
                },
              },
            },
          } as never,
          ctx: ctx as never,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { error: 'invalid_receipt_state' },
      })
      expect(asn.status).toBe(status)
      expect(em.flush).not.toHaveBeenCalled()
      expect(emitCrudSideEffectsMock).not.toHaveBeenCalled()
    },
  )
})

describe('wms.receiving-lines.create undo', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  function draftAsn(overrides: Record<string, unknown> = {}) {
    return {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  it('undo soft-deletes the line under ASN+line locks and emits deleted side effects', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }

    let asnLocked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          expect(asnLocked).toBe(true)
          expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
          return line
        }
        return line
      }
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        asnLocked = true
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.create')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: LINE_ID,
              organizationId: ORG,
              tenantId: TENANT,
              asnId: ASN_ID,
              catalogVariantId: '77777777-7777-4777-8777-777777777777',
              expectedQty: '10',
              receivedQty: '0',
              lotNumber: null,
              serialNumbers: null,
              qcStatus: 'pending',
              targetStagingLocationId: null,
              rejectionReason: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(line.deletedAt).toBeInstanceOf(Date)
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deleted',
        entity: line,
        identifiers: { id: LINE_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
  })

  it('refuses undo when current line has receivedQty > 0', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '3',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.create')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              after: {
                id: LINE_ID,
                organizationId: ORG,
                tenantId: TENANT,
                asnId: ASN_ID,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                expectedQty: '10',
                receivedQty: '0',
                lotNumber: null,
                serialNumbers: null,
                qcStatus: 'pending',
                targetStagingLocationId: null,
                rejectionReason: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('re-checks activity under locks before soft-delete (concurrent receive race)', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          // Concurrent receive posts qty after unlocked read, before locked check.
          line.receivedQty = '2'
          return line
        }
        return line
      }
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.create')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              after: {
                id: LINE_ID,
                organizationId: ORG,
                tenantId: TENANT,
                asnId: ASN_ID,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                expectedQty: '10',
                receivedQty: '0',
                lotNumber: null,
                serialNumbers: null,
                qcStatus: 'pending',
                targetStagingLocationId: null,
                rejectionReason: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.receiving-lines.update undo', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  function draftAsn(overrides: Record<string, unknown> = {}) {
    return {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
      ...overrides,
    }
  }

  it('undo restores prior line snapshot under ASN+line locks and emits updated side effects', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '88888888-8888-4888-8888-888888888888',
      expectedQty: '99',
      receivedQty: '0',
      lotNumber: 'LOT-NEW',
      serialNumbers: ['S1'],
      qcStatus: 'pending',
      targetStagingLocationId: '66666666-6666-4666-8666-666666666666',
      rejectionReason: null,
      metadata: { a: 1 },
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }

    let asnLocked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          expect(asnLocked).toBe(true)
          expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
          return line
        }
        return line
      }
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        asnLocked = true
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: LINE_ID,
              organizationId: ORG,
              tenantId: TENANT,
              asnId: ASN_ID,
              catalogVariantId: '77777777-7777-4777-8777-777777777777',
              expectedQty: '10',
              receivedQty: '0',
              lotNumber: null,
              serialNumbers: null,
              qcStatus: 'pending',
              targetStagingLocationId: null,
              rejectionReason: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(line.catalogVariantId).toBe('77777777-7777-4777-8777-777777777777')
    expect(line.expectedQty).toBe('10')
    expect(line.receivedQty).toBe('0')
    expect(line.lotNumber).toBeNull()
    expect(line.qcStatus).toBe('pending')
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        entity: line,
        identifiers: { id: LINE_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
  })

  it('refuses undo when current line has receivedQty > 0', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '88888888-8888-4888-8888-888888888888',
      expectedQty: '10',
      receivedQty: '5',
      lotNumber: 'LOT-NEW',
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: LINE_ID,
                organizationId: ORG,
                tenantId: TENANT,
                asnId: ASN_ID,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                expectedQty: '10',
                receivedQty: '0',
                lotNumber: null,
                serialNumbers: null,
                qcStatus: 'pending',
                targetStagingLocationId: null,
                rejectionReason: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.receivedQty).toBe('5')
    expect(line.catalogVariantId).toBe('88888888-8888-4888-8888-888888888888')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses undo when current line QC is not pending', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '88888888-8888-4888-8888-888888888888',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'passed',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: LINE_ID,
                organizationId: ORG,
                tenantId: TENANT,
                asnId: ASN_ID,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                expectedQty: '10',
                receivedQty: '0',
                lotNumber: null,
                serialNumbers: null,
                qcStatus: 'pending',
                targetStagingLocationId: null,
                rejectionReason: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.qcStatus).toBe('passed')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('re-checks activity under locks before restore (concurrent receive race)', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = draftAsn()
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '88888888-8888-4888-8888-888888888888',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: 'LOT-NEW',
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          // Concurrent receive commits after unlocked read, before locked restore.
          line.receivedQty = '4'
          line.qcStatus = 'passed'
          return line
        }
        return line
      }
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.update')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: LINE_ID,
                organizationId: ORG,
                tenantId: TENANT,
                asnId: ASN_ID,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                expectedQty: '10',
                receivedQty: '0',
                lotNumber: null,
                serialNumbers: null,
                qcStatus: 'pending',
                targetStagingLocationId: null,
                rejectionReason: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.expectedQty).toBe('10')
    expect(line.receivedQty).toBe('4')
    expect(line.qcStatus).toBe('passed')
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.receiving-lines.delete undo', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  it('undo restores soft-deleted line under ASN+line locks and emits updated side effects', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: new Date('2026-08-22T12:00:00.000Z') as Date | null,
    }

    let asnLocked = false
    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === ReceivingLine) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          expect(asnLocked).toBe(true)
          expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
          return line
        }
        return line
      }
      if (entity === Asn) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        asnLocked = true
        return asn
      }
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.delete')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: LINE_ID,
              organizationId: ORG,
              tenantId: TENANT,
              asnId: ASN_ID,
              catalogVariantId: '77777777-7777-4777-8777-777777777777',
              expectedQty: '10',
              receivedQty: '0',
              lotNumber: null,
              serialNumbers: null,
              qcStatus: 'pending',
              targetStagingLocationId: null,
              rejectionReason: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(line.deletedAt).toBeNull()
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated',
        entity: line,
        identifiers: { id: LINE_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
  })

  it('refuses undo when parent ASN is received', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'received',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: new Date('2026-08-22T12:00:00.000Z') as Date | null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return line
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.receiving-lines.delete')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: LINE_ID,
                organizationId: ORG,
                tenantId: TENANT,
                asnId: ASN_ID,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                expectedQty: '10',
                receivedQty: '0',
                lotNumber: null,
                serialNumbers: null,
                qcStatus: 'pending',
                targetStagingLocationId: null,
                rejectionReason: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(line.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.asns.create undo', () => {
  beforeAll(async () => {
    await import('../asn')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    emitCrudSideEffectsMock.mockClear()
  })

  it('undo soft-deletes receiving lines created with the ASN', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'draft',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    const line = {
      id: LINE_ID,
      tenantId: TENANT,
      organizationId: ORG,
      asn: ASN_ID,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      expectedQty: '10',
      receivedQty: '0',
      lotNumber: null,
      serialNumbers: null,
      qcStatus: 'pending',
      targetStagingLocationId: null,
      rejectionReason: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === Asn) return asn
      return null
    })
    findWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === ReceivingLine) return [line]
      return []
    })

    const handler = commandRegistry.get('wms.asns.create')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: ASN_ID,
              organizationId: ORG,
              tenantId: TENANT,
              warehouseId: WH_ID,
              vendorId: null,
              status: 'draft',
              expectedAt: '2026-08-20T00:00:00.000Z',
              referenceNumber: null,
              notes: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
            lineIds: [LINE_ID],
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(asn.deletedAt).toBeInstanceOf(Date)
    expect(line.deletedAt).toBeInstanceOf(Date)
    expect(em.transactional).toHaveBeenCalled()
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      Asn,
      { id: ASN_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(findWithDecryption).toHaveBeenCalledWith(
      em,
      ReceivingLine,
      { id: { $in: [LINE_ID] }, asn: ASN_ID, deletedAt: null },
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(em.flush).toHaveBeenCalled()
    expect(emitCrudSideEffectsMock).toHaveBeenCalledTimes(2)
    expect(emitCrudSideEffectsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'deleted',
        entity: asn,
        identifiers: { id: ASN_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
    expect(emitCrudSideEffectsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'deleted',
        entity: line,
        identifiers: { id: LINE_ID, organizationId: ORG, tenantId: TENANT },
      }),
    )
  })

  it('refuses undo when ASN is already received', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WH_ID },
      vendorId: null,
      status: 'received',
      expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      referenceNumber: null,
      notes: null,
      metadata: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      deletedAt: null as Date | null,
    }
    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === Asn) return asn
      return null
    })

    const handler = commandRegistry.get('wms.asns.create')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              after: {
                id: ASN_ID,
                organizationId: ORG,
                tenantId: TENANT,
                warehouseId: WH_ID,
                vendorId: null,
                status: 'draft',
                expectedAt: '2026-08-20T00:00:00.000Z',
                referenceNumber: null,
                notes: null,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
              lineIds: [LINE_ID],
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_receipt_state' },
    })
    expect(asn.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('undo falls back to active ASN lines when lineIds are missing', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const asn = {
      id: ASN_ID,
      tenantId: TENANT,
      organizationId: ORG,
      status: 'draft',
      deletedAt: null as Date | null,
    }
    const line = {
      id: LINE_ID,
      receivedQty: '0',
      qcStatus: 'pending',
      deletedAt: null as Date | null,
    }

    findOneWithDecryption.mockResolvedValue(asn)
    findWithDecryption.mockResolvedValue([line])

    const handler = commandRegistry.get('wms.asns.create')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: ASN_ID,
              organizationId: ORG,
              tenantId: TENANT,
              warehouseId: WH_ID,
              vendorId: null,
              status: 'draft',
              expectedAt: '2026-08-20T00:00:00.000Z',
              referenceNumber: null,
              notes: null,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(asn.deletedAt).toBeInstanceOf(Date)
    expect(line.deletedAt).toBeInstanceOf(Date)
    expect(findWithDecryption).toHaveBeenCalledWith(
      em,
      ReceivingLine,
      { asn: ASN_ID, deletedAt: null },
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
  })

  it('buildLog captures lineIds for undo symmetry with delete', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const handler = commandRegistry.get('wms.asns.create')
    const log = await handler!.buildLog!({
      input: {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WH_ID,
        expectedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
      result: { asnId: ASN_ID, lineIds: [LINE_ID] },
      ctx: ctx as never,
      snapshots: {
        after: {
          id: ASN_ID,
          organizationId: ORG,
          tenantId: TENANT,
          warehouseId: WH_ID,
          vendorId: null,
          status: 'draft',
          expectedAt: '2026-08-20T00:00:00.000Z',
          referenceNumber: null,
          notes: null,
          metadata: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    } as never)

    expect(log.payload).toEqual({
      undo: {
        after: expect.objectContaining({ id: ASN_ID }),
        lineIds: [LINE_ID],
      },
    })
  })
})
