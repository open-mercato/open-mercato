/** @jest-environment node */
import type { InterceptorContext, InterceptorRequest, InterceptorResponse } from '@open-mercato/shared/lib/crud/api-interceptor'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => `${key}|${fallback ?? ''}` }),
}))
jest.mock('../commands/product-use', () => {
  const { CrudHttpError: HttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
  return {
    assertProductUseChangeAllowed: jest.fn(async () => undefined),
    loadProductUseRecord: jest.fn(async () => null),
    toProductUseState: jest.fn(() => null),
    PRODUCT_USE_RESOURCE_KIND: 'property_management.product_use',
    productUseForbiddenError: jest.fn(async () => new HttpError(403, { error: 'forbidden', code: 'product_use_forbidden' })),
  }
})
jest.mock('../lib/buildingAccess', () => ({ canManageAllBuildings: jest.fn(async () => true) }))
jest.mock('../lib/productUse', () => ({ loadProductOrganizations: jest.fn(async () => new Map()) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: 'org-1', filterIds: ['org-1'], allowedIds: ['org-1'], tenantId: 'tenant-1' })),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({ getAllMutationGuardInstances: jest.fn(() => []) }))

import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { interceptors, productUseGuardHeaders, PRODUCT_USE_SYNC_DEADLINE_MS, PRODUCT_USE_SYNC_INTERCEPTOR_TIMEOUT_MS } from '../api/interceptors'
import { assertProductUseChangeAllowed, loadProductUseRecord, productUseForbiddenError } from '../commands/product-use'
import { canManageAllBuildings } from '../lib/buildingAccess'
import { loadProductOrganizations } from '../lib/productUse'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { encodeProductUseIntent, PRODUCT_USE_INTENT_HEADER } from '../lib/productUseIntent'

const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const interceptor = interceptors[0]
const execute = jest.fn()

function contextOf(): InterceptorContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    em: { fork: () => ({}) } as unknown as InterceptorContext['em'],
    container: { resolve: () => ({ execute }) } as unknown as InterceptorContext['container'],
    metadata: { productUseIntent: { sourceEntityId: 'catalog:catalog_product', use: 'bookable', billingUnit: 'hour' } },
  }
}

const request: InterceptorRequest = { method: 'POST', url: '/api/catalog/products', body: {}, headers: {} }
const response: InterceptorResponse = { statusCode: 201, body: { id: PRODUCT_ID }, headers: {} }

beforeEach(() => {
  execute.mockReset()
  reportError.mockReset()
  jest.mocked(loadProductOrganizations).mockReset().mockResolvedValue(new Map())
  jest.mocked(resolveOrganizationScopeForRequest).mockClear()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('catalog product-use interceptor after hook', () => {
  it('keeps the deadline inside the interceptor timeout', () => {
    expect(interceptor.timeoutMs).toBe(PRODUCT_USE_SYNC_INTERCEPTOR_TIMEOUT_MS)
    expect(PRODUCT_USE_SYNC_DEADLINE_MS).toBeLessThan(PRODUCT_USE_SYNC_INTERCEPTOR_TIMEOUT_MS)
  })

  it('sets the product use and leaves the response alone on success', async () => {
    execute.mockResolvedValue({ result: {} })
    await expect(interceptor.after!(request, response, contextOf())).resolves.toEqual({})
    expect(execute).toHaveBeenCalledWith(
      'property_management.product_use.set',
      expect.objectContaining({ input: expect.objectContaining({ catalogProductId: PRODUCT_ID, use: 'bookable', billingUnit: 'hour' }) }),
    )
    expect(reportError).not.toHaveBeenCalled()
  })

  it('dispatches the product use as the signed-in caller, never as a system actor', async () => {
    execute.mockResolvedValue({ result: {} })
    await interceptor.after!(request, response, contextOf())
    const [, options] = execute.mock.calls[0] as [string, { ctx: { auth: { sub: string; tenantId: string } | null; systemActor?: boolean } }]
    expect(options.ctx.auth).toMatchObject({ sub: 'user-1', tenantId: 'tenant-1' })
    expect(options.ctx.systemActor).toBeUndefined()
  })

  it('turns a usage race into a warning on the saved product instead of an error response', async () => {
    execute.mockRejectedValue(new CrudHttpError(409, { error: 'property_management.errors.productUseStrands' }))
    const result = await interceptor.after!(request, response, contextOf())
    expect(result).toEqual({
      merge: {
        _property_management: {
          productUseError: { status: 409, error: 'property_management.errors.productUseStrands|property_management.errors.productUseStrands' },
        },
      },
    })
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('reports an unexpected failure with a generic message', async () => {
    execute.mockRejectedValue(new Error('[internal] connection reset'))
    const result = await interceptor.after!(request, response, contextOf())
    expect(result.merge?._property_management).toEqual({
      productUseError: { status: 500, error: expect.stringContaining('property_management.errors.productUseSyncFailed') },
    })
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('answers before the interceptor timeout when the command is slow and reports its late failure', async () => {
    jest.useFakeTimers()
    let rejectLate: (err: Error) => void = () => undefined
    execute.mockImplementation(() => new Promise((_resolve, reject) => { rejectLate = reject }))
    const pending = interceptor.after!(request, response, contextOf())
    await jest.advanceTimersByTimeAsync(PRODUCT_USE_SYNC_DEADLINE_MS)
    const result = await pending
    expect(result.merge?._property_management).toEqual({
      productUseError: { status: 504, error: expect.stringContaining('property_management.errors.productUseSyncPending') },
    })
    expect(reportError).not.toHaveBeenCalled()
    rejectLate(new Error('[internal] late failure'))
    await jest.advanceTimersByTimeAsync(0)
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('sets the use in the saved product\'s own organization when it is a child of the selected one', async () => {
    jest.mocked(loadProductOrganizations).mockResolvedValue(new Map([[PRODUCT_ID, 'org-child']]))
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValueOnce({ selectedId: 'org-1', filterIds: ['org-1', 'org-child'], allowedIds: ['org-1', 'org-child'], tenantId: 'tenant-1' })
    execute.mockResolvedValue({ result: {} })
    await expect(interceptor.after!(request, response, contextOf())).resolves.toEqual({})
    expect(execute).toHaveBeenCalledWith(
      'property_management.product_use.set',
      expect.objectContaining({
        input: expect.objectContaining({ organizationId: 'org-child', catalogProductId: PRODUCT_ID }),
        ctx: expect.objectContaining({ selectedOrganizationId: 'org-child', organizationIds: ['org-child'] }),
      }),
    )
  })

  it('refuses to set the use of a product outside the caller\'s organizations', async () => {
    jest.mocked(loadProductOrganizations).mockResolvedValue(new Map([[PRODUCT_ID, 'org-elsewhere']]))
    const result = await interceptor.after!(request, response, contextOf())
    expect(result).toEqual({ merge: { _property_management: { productUseError: { status: 403, error: 'forbidden' } } } })
    expect(execute).not.toHaveBeenCalled()
  })

  it('does nothing for a failed catalog write', async () => {
    await expect(interceptor.after!(request, { ...response, statusCode: 409 }, contextOf())).resolves.toEqual({})
    expect(execute).not.toHaveBeenCalled()
  })

  it('turns a failed product scope lookup into a warning on the saved product', async () => {
    jest.mocked(loadProductOrganizations).mockRejectedValue(new Error('[internal] connection reset'))
    const result = await interceptor.after!(request, response, contextOf())
    expect(result.merge?._property_management).toEqual({
      productUseError: { status: 500, error: expect.stringContaining('property_management.errors.productUseSyncFailed') },
    })
    expect(execute).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('turns a failure while describing a refused product use into a warning on the saved product', async () => {
    jest.mocked(loadProductOrganizations).mockResolvedValue(new Map([[PRODUCT_ID, 'org-elsewhere']]))
    jest.mocked(productUseForbiddenError).mockRejectedValueOnce(new Error('[internal] translations unavailable'))
    const result = await interceptor.after!(request, response, contextOf())
    expect(result.merge?._property_management).toEqual({
      productUseError: { status: 500, error: expect.stringContaining('property_management.errors.productUseSyncFailed') },
    })
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('counts the product scope lookup against the deadline', async () => {
    jest.useFakeTimers()
    const lookupMs = PRODUCT_USE_SYNC_DEADLINE_MS / 2
    jest.mocked(loadProductOrganizations).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(new Map()), lookupMs)),
    )
    execute.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ result: {} }), PRODUCT_USE_SYNC_DEADLINE_MS)))
    let settled = false
    const pending = interceptor.after!(request, response, contextOf()).then((result) => {
      settled = true
      return result
    })
    await jest.advanceTimersByTimeAsync(PRODUCT_USE_SYNC_DEADLINE_MS)
    expect(settled).toBe(true)
    const result = await pending
    expect(result.merge?._property_management).toEqual({
      productUseError: { status: 504, error: expect.stringContaining('property_management.errors.productUseSyncPending') },
    })
    await jest.advanceTimersByTimeAsync(PRODUCT_USE_SYNC_DEADLINE_MS)
  })
})

describe('catalog product-use interceptor before hook', () => {
  const RECORD_ID = '55555555-5555-4555-8555-555555555555'
  const intent = { sourceEntityId: 'catalog:catalog_product', use: 'bookable' as const, billingUnit: 'hour' as const }
  const putRequest: InterceptorRequest = {
    method: 'PUT',
    url: '/api/catalog/products',
    body: { id: PRODUCT_ID },
    headers: { [PRODUCT_USE_INTENT_HEADER]: encodeProductUseIntent(intent) },
  }

  function bareContext(): InterceptorContext {
    return {
      userId: 'user-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      em: { fork: () => ({}) } as unknown as InterceptorContext['em'],
      container: {
        hasRegistration: () => false,
        resolve: () => ({ execute }),
      } as unknown as InterceptorContext['container'],
      userFeatures: ['property_management.*'],
    }
  }

  function guardOf(overrides: Partial<MutationGuard> = {}): MutationGuard {
    return {
      id: 'test.product-use-guard',
      targetEntity: 'property_management.product_use',
      operations: ['create', 'update', 'delete'],
      validate: jest.fn(async () => ({ ok: true })),
      ...overrides,
    }
  }

  beforeEach(() => {
    jest.mocked(canManageAllBuildings).mockReset().mockResolvedValue(true)
    jest.mocked(getAllMutationGuardInstances).mockReset().mockReturnValue([])
    jest.mocked(assertProductUseChangeAllowed).mockClear()
    jest.mocked(loadProductUseRecord).mockReset().mockResolvedValue(null)
  })

  it('skips the pre-check and reports a 403 on the saved product when the caller does not manage every building', async () => {
    jest.mocked(canManageAllBuildings).mockResolvedValue(false)
    const context = bareContext()
    const before = await interceptor.before!(putRequest, context)
    expect(before).toEqual({ ok: true, metadata: { productUseIntent: intent, productUseDenied: true } })
    expect(assertProductUseChangeAllowed).not.toHaveBeenCalled()
    const after = await interceptor.after!(putRequest, { statusCode: 200, body: { ok: true }, headers: {} }, { ...context, metadata: before.metadata })
    expect(after).toEqual({ merge: { _property_management: { productUseError: { status: 403, error: 'forbidden' } } } })
    expect(execute).not.toHaveBeenCalled()
  })

  it('runs the registered mutation guards for the product use and blocks the save when one refuses', async () => {
    jest.mocked(loadProductUseRecord).mockResolvedValue({ id: RECORD_ID } as never)
    const guard = guardOf({ validate: jest.fn(async () => ({ ok: false, status: 423, message: 'locked' })) })
    jest.mocked(getAllMutationGuardInstances).mockReturnValue([guard])
    const before = await interceptor.before!(putRequest, bareContext())
    expect(before).toEqual({ ok: false, statusCode: 423, message: 'locked' })
    expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'property_management.product_use',
      resourceId: RECORD_ID,
      operation: 'update',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
    }))
  })

  it('checks and guards the product use in the edited product\'s own organization', async () => {
    jest.mocked(loadProductOrganizations).mockResolvedValue(new Map([[PRODUCT_ID, 'org-child']]))
    jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValueOnce({ selectedId: 'org-1', filterIds: ['org-1', 'org-child'], allowedIds: ['org-1', 'org-child'], tenantId: 'tenant-1' })
    const guard = guardOf()
    jest.mocked(getAllMutationGuardInstances).mockReturnValue([guard])
    const before = await interceptor.before!(putRequest, bareContext())
    expect(before.ok).toBe(true)
    const childScope = { tenantId: 'tenant-1', organizationId: 'org-child' }
    expect(canManageAllBuildings).toHaveBeenCalledWith(expect.objectContaining(childScope))
    expect(loadProductUseRecord).toHaveBeenCalledWith(expect.anything(), childScope, PRODUCT_ID)
    expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-child' }))
  })

  it('runs the guard after-success callbacks once the product use is saved', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    const guard = guardOf({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'lock-1' } })), afterSuccess })
    jest.mocked(getAllMutationGuardInstances).mockReturnValue([guard])
    execute.mockResolvedValue({ result: {} })
    const context = bareContext()
    const before = await interceptor.before!(putRequest, context)
    expect(before.ok).toBe(true)
    expect(guard.validate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: null, operation: 'create' }))
    await expect(interceptor.after!(putRequest, { statusCode: 200, body: { ok: true }, headers: {} }, { ...context, metadata: before.metadata })).resolves.toEqual({})
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'property_management.product_use',
      resourceId: PRODUCT_ID,
      operation: 'create',
      metadata: { token: 'lock-1' },
    }))
  })

  it('runs the guard after-success callbacks when the product use is saved after the deadline', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    const guard = guardOf({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'lock-2' } })), afterSuccess })
    jest.mocked(getAllMutationGuardInstances).mockReturnValue([guard])
    let resolveLate: (value: unknown) => void = () => undefined
    execute.mockImplementation(() => new Promise((resolve) => { resolveLate = resolve }))
    const context = bareContext()
    const before = await interceptor.before!(putRequest, context)
    jest.useFakeTimers()
    const pending = interceptor.after!(putRequest, { statusCode: 200, body: { ok: true }, headers: {} }, { ...context, metadata: before.metadata })
    await jest.advanceTimersByTimeAsync(PRODUCT_USE_SYNC_DEADLINE_MS)
    const result = await pending
    expect(result.merge?._property_management).toEqual({
      productUseError: { status: 504, error: expect.stringContaining('property_management.errors.productUseSyncPending') },
    })
    expect(afterSuccess).not.toHaveBeenCalled()
    resolveLate({ result: {} })
    await jest.advanceTimersByTimeAsync(0)
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: 'property_management.product_use', metadata: { token: 'lock-2' } }))
    expect(reportError).not.toHaveBeenCalled()
  })

  it('skips the guard after-success callbacks when the late product use write fails', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    const guard = guardOf({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: null })), afterSuccess })
    jest.mocked(getAllMutationGuardInstances).mockReturnValue([guard])
    let rejectLate: (err: Error) => void = () => undefined
    execute.mockImplementation(() => new Promise((_resolve, reject) => { rejectLate = reject }))
    const context = bareContext()
    const before = await interceptor.before!(putRequest, context)
    jest.useFakeTimers()
    const pending = interceptor.after!(putRequest, { statusCode: 200, body: { ok: true }, headers: {} }, { ...context, metadata: before.metadata })
    await jest.advanceTimersByTimeAsync(PRODUCT_USE_SYNC_DEADLINE_MS)
    await pending
    rejectLate(new Error('[internal] late failure'))
    await jest.advanceTimersByTimeAsync(0)
    expect(afterSuccess).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('updates an existing product use even when the catalog form sends its own optimistic-lock version', async () => {
    jest.mocked(loadProductUseRecord).mockResolvedValue({ id: RECORD_ID } as never)
    const lockService = createOptimisticLockGuardService({
      getEm: () => ({}) as never,
      envValue: 'all',
      readers: { 'property_management.product_use': async () => '2026-11-10T08:00:00.000Z' },
    })
    const validate = jest.fn((input: Parameters<MutationGuard['validate']>[0]) =>
      lockService.validateMutation({ ...input, resourceId: input.resourceId ?? '' }).then((result) =>
        result.ok ? { ok: true as const } : { ok: false as const, status: result.status, body: result.body },
      ),
    )
    jest.mocked(getAllMutationGuardInstances).mockReturnValue([guardOf({ validate })])
    const lockedRequest: InterceptorRequest = {
      ...putRequest,
      headers: {
        ...putRequest.headers,
        [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-11-01T12:00:00.000Z',
        'x-om-record-lock-kind': 'catalog.catalog_product',
        'x-om-record-lock-resource-id': PRODUCT_ID,
        'x-om-record-lock-token': 'catalog-token',
      },
    }
    const before = await interceptor.before!(lockedRequest, bareContext())
    expect(before.ok).toBe(true)
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: RECORD_ID, operation: 'update' }))
    const sent = validate.mock.calls[0][0].requestHeaders
    expect(sent.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBeNull()
    expect(sent.get('x-om-record-lock-token')).toBeNull()
    expect(sent.get(PRODUCT_USE_INTENT_HEADER)).toBe(putRequest.headers[PRODUCT_USE_INTENT_HEADER])
  })

  it('still refuses a stale version when the lock header reaches the guard directly', async () => {
    const lockService = createOptimisticLockGuardService({
      getEm: () => ({}) as never,
      envValue: 'all',
      readers: { 'property_management.product_use': async () => '2026-11-10T08:00:00.000Z' },
    })
    const headers = new Headers({ [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-11-01T12:00:00.000Z' })
    const direct = await lockService.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      resourceKind: 'property_management.product_use',
      resourceId: RECORD_ID,
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: headers,
    })
    expect(direct.ok).toBe(false)
    const stripped = productUseGuardHeaders({ ...putRequest, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-11-01T12:00:00.000Z' } })
    const viaInterceptorHeaders = await lockService.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      resourceKind: 'property_management.product_use',
      resourceId: RECORD_ID,
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: stripped,
    })
    expect(viaInterceptorHeaders.ok).toBe(true)
  })
})
