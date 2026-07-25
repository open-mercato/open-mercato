/** @jest-environment node */

/**
 * Edit + delete commands for sales returns (issue #3035).
 *
 * Both new commands are undoable and guard the return's own `updated_at`
 * version through `enforceSalesDocumentOptimisticLock(..., SALES_RESOURCE_KIND_RETURN)`,
 * throwing the structured 409 before any mutation when the client's expected
 * version is stale. Editing only touches the return header (reason / notes /
 * returnedAt); deleting reverses the returned quantities + credit adjustments.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { SalesOrder, SalesReturn } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(
    async (em: { findOne: (...args: unknown[]) => Promise<unknown> }, entityClass: unknown, where: unknown) =>
      em.findOne(entityClass, where),
  ),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const RETURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const CURRENT = '2026-06-15T08:42:20.999Z'
const STALE = '2026-06-15T08:42:18.123Z'

function makeRequest(headerValue: string | null): Request {
  const headers = new Headers()
  if (headerValue != null) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, headerValue)
  return new Request('https://example.test/api/sales/returns', { method: 'PUT', headers })
}

function makeReturn(updatedAt: string) {
  return {
    id: RETURN_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    deletedAt: null,
    updatedAt: new Date(updatedAt),
    order: { id: ORDER_ID },
    reason: 'old reason',
    notes: 'old notes',
    returnedAt: new Date(CURRENT),
  }
}

function makeOrder() {
  return { id: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID, deletedAt: null, updatedAt: new Date(CURRENT) }
}

function makeCtx(em: unknown, request: Request, calc: { calculateDocumentTotals: jest.Mock }) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue(calc),
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

function baseInput(extra: Record<string, unknown> = {}) {
  return { id: RETURN_ID, orderId: ORDER_ID, organizationId: ORG_ID, tenantId: TENANT_ID, ...extra }
}

describe('sales.returns.update / delete', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  it('update rejects a stale return version with a 409 before mutating', async () => {
    const returnEntity = makeReturn(CURRENT)
    const calc = { calculateDocumentTotals: jest.fn() }
    const em: any = {
      findOne: jest.fn(async (entityClass: unknown) => (entityClass === SalesReturn ? returnEntity : null)),
      find: jest.fn(async () => []),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
      fork: function () { return this },
      transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    }
    const ctx = makeCtx(em, makeRequest(STALE), calc)
    const handler = commandRegistry.get('sales.returns.update')
    expect(handler).toBeTruthy()

    let caught: unknown
    try {
      await handler!.execute(baseInput({ reason: 'new reason' }), ctx as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict' })
    // The lock fires before mutation: no scalar change persisted.
    expect(em.flush).not.toHaveBeenCalled()
    expect(returnEntity.reason).toBe('old reason')
  })

  it('update applies reason / notes when the version matches', async () => {
    const returnEntity = makeReturn(CURRENT)
    const calc = { calculateDocumentTotals: jest.fn() }
    const em: any = {
      findOne: jest.fn(async (entityClass: unknown) => (entityClass === SalesReturn ? returnEntity : null)),
      find: jest.fn(async () => []),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
      fork: function () { return this },
      transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    }
    const ctx = makeCtx(em, makeRequest(CURRENT), calc)
    const handler = commandRegistry.get('sales.returns.update')

    const result = await handler!.execute(baseInput({ reason: 'new reason', notes: '' }), ctx as never)
    expect(result).toMatchObject({ returnId: RETURN_ID })
    expect(returnEntity.reason).toBe('new reason')
    // Empty string clears the field.
    expect(returnEntity.notes).toBeNull()
    expect(em.flush).toHaveBeenCalled()
  })

  it('update throws 404 when the return is missing', async () => {
    const calc = { calculateDocumentTotals: jest.fn() }
    const em: any = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
      fork: function () { return this },
      transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    }
    const ctx = makeCtx(em, makeRequest(CURRENT), calc)
    const handler = commandRegistry.get('sales.returns.update')

    let caught: unknown
    try {
      await handler!.execute(baseInput({ reason: 'x' }), ctx as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(404)
  })

  it('delete rejects a stale return version with a 409 before reversing effects', async () => {
    const returnEntity = makeReturn(CURRENT)
    const order = makeOrder()
    const calc = { calculateDocumentTotals: jest.fn() }
    const em: any = {
      findOne: jest.fn(async (entityClass: unknown) => {
        if (entityClass === SalesReturn) return returnEntity
        if (entityClass === SalesOrder) return order
        return null
      }),
      find: jest.fn(async () => []),
      persist: jest.fn(),
      remove: jest.fn(),
      flush: jest.fn(async () => {}),
      fork: function () { return this },
      transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    }
    const ctx = makeCtx(em, makeRequest(STALE), calc)
    const handler = commandRegistry.get('sales.returns.delete')
    expect(handler).toBeTruthy()

    let caught: unknown
    try {
      await handler!.execute(baseInput(), ctx as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ code: 'optimistic_lock_conflict' })
    // Proves the lock fires before the reversal: totals were never recomputed.
    expect(calc.calculateDocumentTotals).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
  })
})
