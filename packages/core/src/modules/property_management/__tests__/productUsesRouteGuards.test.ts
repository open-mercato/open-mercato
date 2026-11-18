/** @jest-environment node */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PRODUCT = '33333333-3333-4333-8333-333333333333'
const PRODUCT_USE = '44444444-4444-4444-8444-444444444444'

const state: { productUse: { id: string; catalogProductId: string } | null } = { productUse: null }
const commandBus = { execute: jest.fn(async () => ({ result: { catalogProductId: PRODUCT }, logEntry: null })) }
const em = { fork: () => em }

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, fn: () => Promise<unknown>) => fn(),
}), { virtual: true })
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key, translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => ({ em, commandBus } as Record<string, unknown>)[name],
  }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => {
  const auth = { sub: 'user-1', orgId: '22222222-2222-4222-8222-222222222222', tenantId: '11111111-1111-4111-8111-111111111111', roles: ['admin'] }
  return { getAuthFromCookies: async () => auth, getAuthFromRequest: async () => auth }
})
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: '22222222-2222-4222-8222-222222222222',
    filterIds: ['22222222-2222-4222-8222-222222222222'],
    allowedIds: ['22222222-2222-4222-8222-222222222222'],
    tenantId: '11111111-1111-4111-8111-111111111111',
  })),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: { catalogProductId?: string }) =>
    state.productUse && state.productUse.catalogProductId === where.catalogProductId ? state.productUse : null,
  ),
  findWithDecryption: jest.fn(async () => []),
}))

import { DELETE, PUT } from '../api/product-uses/route'

type GuardInput = { resourceId: string | null; operation: string }

function blockingGuard(validate: jest.Mock) {
  registerMutationGuards([{
    moduleId: 'test',
    guards: [{ id: 'test.block-product-use', targetEntity: '*', operations: ['update', 'delete'], validate }],
  }])
}

function request(method: 'PUT' | 'DELETE', body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/property_management/product-uses', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('product-uses PUT/DELETE mutation guards', () => {
  beforeEach(() => {
    state.productUse = { id: PRODUCT_USE, catalogProductId: PRODUCT }
    commandBus.execute.mockClear()
    registerMutationGuards([])
  })

  afterAll(() => registerMutationGuards([]))

  it('stops a PUT when a registered guard blocks it, keyed by the product use row', async () => {
    const validate = jest.fn(async (_input: GuardInput) => ({ ok: false, status: 423, message: 'Locked' }))
    blockingGuard(validate)
    const response = await PUT(request('PUT', { catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' }))
    expect(response.status).toBe(423)
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: PRODUCT_USE, operation: 'update' }))
  })

  it('stops a DELETE when a registered guard blocks it', async () => {
    const validate = jest.fn(async (_input: GuardInput) => ({ ok: false, status: 423, message: 'Locked' }))
    blockingGuard(validate)
    const response = await DELETE(request('DELETE', { catalogProductId: PRODUCT }))
    expect(response.status).toBe(423)
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: PRODUCT_USE, operation: 'delete' }))
  })

  it('keys the guard by the product when no use row exists yet, and runs the command when it passes', async () => {
    state.productUse = null
    const validate = jest.fn(async (_input: GuardInput) => ({ ok: true, shouldRunAfterSuccess: false }))
    blockingGuard(validate)
    const response = await PUT(request('PUT', { catalogProductId: PRODUCT, use: 'bookable', billingUnit: 'day' }))
    expect(response.status).toBe(200)
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ resourceId: PRODUCT, operation: 'update' }))
    expect(commandBus.execute).toHaveBeenCalledWith(
      'property_management.product_use.set',
      expect.objectContaining({ input: expect.objectContaining({ catalogProductId: PRODUCT, use: 'bookable', billingUnit: 'day', tenantId: TENANT, organizationId: ORG }) }),
    )
  })
})
