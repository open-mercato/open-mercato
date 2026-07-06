/** @jest-environment node */

/**
 * Document-aggregate optimistic locking for sales sub-resource commands.
 *
 * Sub-resource command endpoints (order/quote lines + adjustments, returns,
 * quote conversion) dispatch through the Command pattern. They guard the
 * parent order/quote version (the consistency boundary) via
 * `enforceSalesDocumentOptimisticLock`, throwing the structured 409 when the
 * client's expected `updated_at` (extension header) no longer matches the
 * loaded document. Strictly additive: no header → no 409.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  enforceSalesDocumentOptimisticLock,
  SALES_RESOURCE_KIND_ORDER,
} from '../shared'
import { SalesOrder, SalesPayment, SalesShipment } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async (em: { findOne: (...args: unknown[]) => Promise<unknown> }, entityClass: unknown, where: unknown) =>
    em.findOne(entityClass, where),
  ),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const CURRENT = '2026-05-25T08:42:20.999Z'
const STALE = '2026-05-25T08:42:18.123Z'

function makeRequest(headerValue: string | null): Request {
  const headers = new Headers()
  if (headerValue != null) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, headerValue)
  return new Request('https://example.test/api/sales/order-lines', { method: 'DELETE', headers })
}

describe('enforceSalesDocumentOptimisticLock', () => {
  // The wrapper now routes through the async DI-aware seam, so the ctx needs a
  // container. With no `commandOptimisticLockGuardService` registered (OSS-only),
  // the seam degrades to the OSS floor — exactly the legacy behavior.
  const ctxWith = (headerValue: string | null) => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    return { container, request: makeRequest(headerValue) } as never
  }

  it('throws the structured 409 when the header version is stale', async () => {
    let caught: unknown
    try {
      await enforceSalesDocumentOptimisticLock(
        ctxWith(STALE),
        { id: ORDER_ID, updatedAt: new Date(CURRENT) },
        SALES_RESOURCE_KIND_ORDER,
      )
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: CURRENT,
      expectedUpdatedAt: STALE,
    })
  })

  it('passes when the header version matches the document', async () => {
    await expect(
      enforceSalesDocumentOptimisticLock(
        ctxWith(CURRENT),
        { id: ORDER_ID, updatedAt: new Date(CURRENT) },
        SALES_RESOURCE_KIND_ORDER,
      ),
    ).resolves.toBeUndefined()
  })

  it('is a no-op when the client sends no header (strictly additive)', async () => {
    await expect(
      enforceSalesDocumentOptimisticLock(
        ctxWith(null),
        { id: ORDER_ID, updatedAt: new Date(CURRENT) },
        SALES_RESOURCE_KIND_ORDER,
      ),
    ).resolves.toBeUndefined()
  })

  it('is a no-op when the document is missing', async () => {
    await expect(
      enforceSalesDocumentOptimisticLock(ctxWith(STALE), null, SALES_RESOURCE_KIND_ORDER),
    ).resolves.toBeUndefined()
  })
})

function makeOrder(updatedAt: string) {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    updatedAt: new Date(updatedAt),
  }
}

function makeCtx(em: unknown, request: Request) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request,
  }
}

describe('sales.orders.lines.delete — document-aggregate optimistic lock', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  it('rejects a stale parent-order version with a 409 before mutating', async () => {
    const order = makeOrder(CURRENT)
    const em: any = {
      findOne: jest.fn(async (entityClass: unknown) => (entityClass === SalesOrder ? order : null)),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      flush: jest.fn(async () => {}),
      fork: function () { return this },
    }
    const ctx = makeCtx(em, makeRequest(STALE))
    const handler = commandRegistry.get('sales.orders.lines.delete')
    expect(handler).toBeTruthy()

    let caught: unknown
    try {
      await handler!.execute({ body: { id: LINE_ID, orderId: ORDER_ID } }, ctx as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict' })
    // Proves the check fires before mutation: the shipment-count guard query never ran.
    expect(em.count).not.toHaveBeenCalled()
  })
})

const PAYMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SHIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function makeOrderForChild(updatedAt: string) {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    updatedAt: new Date(updatedAt),
    grandTotalGrossAmount: '0',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
  }
}

describe('sales.payments.delete — parent-order aggregate optimistic lock (Gap A)', () => {
  beforeAll(async () => {
    // Re-register from the exported array (not a bare import) because payments.ts
    // is already module-cached transitively via documents.ts — its registration
    // side-effect won't re-run after the documents block cleared the registry.
    commandRegistry.clear?.()
    const { paymentCommands } = await import('../payments')
    paymentCommands.forEach((cmd) => commandRegistry.register(cmd))
  })

  it('rejects a stale parent-order version with a 409 before mutating', async () => {
    const order = makeOrderForChild(CURRENT)
    const payment = {
      id: PAYMENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      order,
    }
    const removed: unknown[] = []
    const em: any = {
      findOne: jest.fn(async (entityClass: unknown) =>
        entityClass === SalesPayment ? payment : entityClass === SalesOrder ? order : null,
      ),
      find: jest.fn(async () => []),
      flush: jest.fn(async () => {}),
      remove: jest.fn((entity: unknown) => removed.push(entity)),
      transactional: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(em)),
      fork: function () { return this },
    }
    const ctx = makeCtx(em, makeRequest(STALE))
    const handler = commandRegistry.get('sales.payments.delete')
    expect(handler).toBeTruthy()

    let caught: unknown
    try {
      await handler!.execute(
        { id: PAYMENT_ID, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
        ctx as never,
      )
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict' })
    // Proves the guard fires before mutating: nothing was removed and no tx ran.
    expect(removed).toHaveLength(0)
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('OSS-only when locking is disabled (OM_OPTIMISTIC_LOCK=off): a stale header does not 409', async () => {
    const previous = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    try {
      const order = makeOrderForChild(CURRENT)
      const payment = { id: PAYMENT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, order }
      const em: any = {
        findOne: jest.fn(async (entityClass: unknown) =>
          entityClass === SalesPayment ? payment : entityClass === SalesOrder ? order : null,
        ),
        find: jest.fn(async () => []),
        flush: jest.fn(async () => {}),
        remove: jest.fn(),
        transactional: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(em)),
        fork: function () { return this },
      }
      const ctx = makeCtx(em, makeRequest(STALE))
      const handler = commandRegistry.get('sales.payments.delete')
      // It proceeds past the guard (the guard is a no-op when disabled). The
      // transaction therefore runs — proving no 409 was raised by the lock.
      await handler!.execute(
        { id: PAYMENT_ID, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
        ctx as never,
      )
      expect(em.transactional).toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previous
    }
  })
})

describe('sales.shipments.delete — parent-order aggregate optimistic lock (Gap B)', () => {
  beforeAll(async () => {
    // Re-register from the exported array (not a bare import) — shipments.ts is
    // already module-cached transitively via documents.ts.
    commandRegistry.clear?.()
    const { shipmentCommands } = await import('../shipments')
    shipmentCommands.forEach((cmd) => commandRegistry.register(cmd))
  })

  it('rejects a stale parent-order version with a 409 before mutating', async () => {
    const order = makeOrderForChild(CURRENT)
    const shipment = {
      id: SHIPMENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      order,
    }
    const removed: unknown[] = []
    const em: any = {
      findOne: jest.fn(async (entityClass: unknown) =>
        entityClass === SalesShipment ? shipment : entityClass === SalesOrder ? order : null,
      ),
      find: jest.fn(async () => []),
      flush: jest.fn(async () => {}),
      remove: jest.fn((entity: unknown) => removed.push(entity)),
      transactional: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(em)),
      fork: function () { return this },
    }
    const ctx = makeCtx(em, makeRequest(STALE))
    const handler = commandRegistry.get('sales.shipments.delete')
    expect(handler).toBeTruthy()

    let caught: unknown
    try {
      await handler!.execute(
        { id: SHIPMENT_ID, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
        ctx as never,
      )
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict' })
    // Proves the guard fires before mutating: no shipment item or shipment removed.
    expect(removed).toHaveLength(0)
  })

  it('OSS-only when locking is disabled (OM_OPTIMISTIC_LOCK=off): a stale header does not 409', async () => {
    const previous = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    try {
      const order = makeOrderForChild(CURRENT)
      const shipment = { id: SHIPMENT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, order }
      const removed: unknown[] = []
      const em: any = {
        findOne: jest.fn(async (entityClass: unknown) =>
          entityClass === SalesShipment ? shipment : entityClass === SalesOrder ? order : null,
        ),
        find: jest.fn(async () => []),
        flush: jest.fn(async () => {}),
        remove: jest.fn((entity: unknown) => removed.push(entity)),
        transactional: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(em)),
        fork: function () { return this },
      }
      const ctx = makeCtx(em, makeRequest(STALE))
      const handler = commandRegistry.get('sales.shipments.delete')
      // The guard is a no-op when disabled, so the shipment is removed (no 409).
      await handler!.execute(
        { id: SHIPMENT_ID, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
        ctx as never,
      )
      expect(removed).toContain(shipment)
    } finally {
      if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previous
    }
  })
})
