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
import { SalesOrder } from '../../data/entities'

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
  const ctxWith = (headerValue: string | null) => ({ request: makeRequest(headerValue) } as never)

  it('throws the structured 409 when the header version is stale', () => {
    let caught: unknown
    try {
      enforceSalesDocumentOptimisticLock(
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

  it('passes when the header version matches the document', () => {
    expect(() =>
      enforceSalesDocumentOptimisticLock(
        ctxWith(CURRENT),
        { id: ORDER_ID, updatedAt: new Date(CURRENT) },
        SALES_RESOURCE_KIND_ORDER,
      ),
    ).not.toThrow()
  })

  it('is a no-op when the client sends no header (strictly additive)', () => {
    expect(() =>
      enforceSalesDocumentOptimisticLock(
        ctxWith(null),
        { id: ORDER_ID, updatedAt: new Date(CURRENT) },
        SALES_RESOURCE_KIND_ORDER,
      ),
    ).not.toThrow()
  })

  it('is a no-op when the document is missing', () => {
    expect(() =>
      enforceSalesDocumentOptimisticLock(ctxWith(STALE), null, SALES_RESOURCE_KIND_ORDER),
    ).not.toThrow()
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
