import { AsyncLocalStorage } from 'node:async_hooks'
import { runWithDatabaseRequest } from '@open-mercato/shared/lib/db/request'
import { currentTenantBoundaryScope } from '../scope'

const mockRender = new AsyncLocalStorage<Map<() => unknown, unknown>>()
const mockAfter = jest.fn()
const mockHeaders = jest.fn()
const mockStaff = jest.fn()
const mockCustomer = jest.fn()
const mockCustomerCookies = jest.fn()
const mockFind = jest.fn()
const mockContainer = jest.fn()

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: (callback: () => unknown) => () => {
    const memo = mockRender.getStore()
    if (!memo) return callback()
    if (!memo.has(callback)) memo.set(callback, callback())
    return memo.get(callback)
  },
}))
jest.mock('next/server', () => ({ after: (callback: () => void) => mockAfter(callback) }))
jest.mock('next/headers', () => ({ headers: () => mockHeaders() }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ resolveAuthFromCookiesDetailed: () => mockStaff() }))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({ resolveCustomerAuthFromRequestDetailed: (request: Request) => mockCustomer(request) }))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer', () => ({ resolveCustomerAuthFromCookiesDetailed: () => mockCustomerCookies() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => mockContainer() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...arguments_: unknown[]) => mockFind(...arguments_) }))
jest.mock('@open-mercato/core/modules/directory/data/entities', () => ({ Organization: class Organization {} }))
jest.mock('@open-mercato/core/modules/customer_accounts/data/entities', () => ({ DomainMapping: class DomainMapping {} }))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/platformDomains', () => ({ platformDomains: () => ['localhost'] }))

import { createTenantRequestResolver, registerTenantBoundaryRequestResolver, tenantRequestAudience } from '../requests'

const tenantA = '22222222-2222-4222-8222-222222222222'
const tenantB = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  jest.clearAllMocks()
  mockAfter.mockImplementation(() => undefined)
  mockHeaders.mockResolvedValue(new Headers({ 'x-next-url': '/backend/customers', host: 'localhost' }))
  mockStaff.mockResolvedValue({ auth: { tenantId: tenantA }, status: 'authenticated' })
  mockCustomer.mockResolvedValue({ auth: { tenantId: tenantB, orgId: 'portal-org' }, status: 'authenticated' })
  mockCustomerCookies.mockResolvedValue({ auth: { tenantId: tenantB, orgId: 'portal-org' }, status: 'authenticated' })
  mockFind.mockResolvedValue({ id: 'portal-org' })
  mockContainer.mockResolvedValue({ resolve: () => ({}) })
})

it('does not inspect ambient headers or authenticate outside an actual render or HTTP boundary', async () => {
  expect(await createTenantRequestResolver()()).toEqual({ status: 'absent' })
  expect(mockHeaders).not.toHaveBeenCalled()
  expect(mockStaff).not.toHaveBeenCalled()
})

it('caches one canonical staff identity and invocation across deferred component queries', async () => {
  const resolve = createTenantRequestResolver()
  await mockRender.run(new Map(), async () => {
    const [first, second] = await Promise.all([resolve(), resolve()])
    expect(first).toBe(second)
    if (first.status !== 'resolved') throw new Error('[internal] Expected resolved render')
    expect(first.context).toMatchObject({ kind: 'tenant', tenantId: tenantA, source: 'page' })
    await new Promise<void>((done) => setImmediate(done))
    expect(await resolve()).toBe(first)
    expect(first.invocation.isActive()).toBe(true)
    expect(mockStaff).toHaveBeenCalledTimes(1)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    const complete = mockAfter.mock.calls[0][0] as () => void
    complete()
    expect(first.invocation.isActive()).toBe(false)
  })
})

it('uses customer identity on portal pages even when a staff session also exists', async () => {
  mockHeaders.mockResolvedValue(new Headers({ 'x-next-url': '/company/portal/support', host: 'localhost', cookie: 'auth_token=staff; customer_auth_token=customer' }))
  mockFind.mockImplementation(async () => {
    expect(currentTenantBoundaryScope()?.context).toMatchObject({ kind: 'identity', tenantId: tenantB })
    return { id: 'portal-org' }
  })
  const resolved = await mockRender.run(new Map(), createTenantRequestResolver())
  expect(resolved.status === 'resolved' && resolved.context.tenantId).toBe(tenantB)
  expect(mockStaff).not.toHaveBeenCalled()
  expect(mockCustomerCookies).toHaveBeenCalledTimes(1)
})

it('keeps overlapping public HTTP requests separate and ignores a forged page pathname', async () => {
  const resolve = createTenantRequestResolver()
  const requests = [new Request('http://localhost/api/customer_accounts/signup', { headers: { 'x-next-url': '/backend/customers' } }), new Request('http://localhost/api/staff/portal/support-tickets')]
  const [publicResult, portalResult] = await Promise.all(requests.map((request) => runWithDatabaseRequest(request, async () => {
    const first = await resolve()
    await new Promise<void>((done) => setImmediate(done))
    expect(await resolve()).toBe(first)
    return first
  })))
  expect(publicResult.status === 'resolved' && publicResult.context).toMatchObject({ kind: 'identity', tenantId: null })
  expect(portalResult.status === 'resolved' && portalResult.context.tenantId).toBe(tenantB)
  if (publicResult.status === 'resolved' && portalResult.status === 'resolved') expect(publicResult.invocation.token).not.toBe(portalResult.invocation.token)
  expect(mockStaff).not.toHaveBeenCalled()
  expect(mockHeaders).not.toHaveBeenCalled()
})

it('revokes an HTTP invocation on cancellation and refuses cancellation during canonical resolution', async () => {
  const controller = new AbortController()
  const request = new Request('http://localhost/api/staff/portal/support-tickets', { signal: controller.signal })
  const result = await runWithDatabaseRequest(request, createTenantRequestResolver())
  if (result.status !== 'resolved') throw new Error('[internal] Expected resolved request')
  controller.abort()
  expect(result.invocation.isActive()).toBe(false)
  expect((await runWithDatabaseRequest(request, createTenantRequestResolver())).status).toBe('unavailable')
})

it('fails closed when the public response-completion hook or canonical identity is unavailable', async () => {
  const request = new Request('http://localhost/api/staff/portal/support-tickets')
  mockAfter.mockImplementationOnce(() => { throw new Error('[internal] No response lifecycle') })
  expect((await runWithDatabaseRequest(request, createTenantRequestResolver())).status).toBe('unavailable')
  expect(mockCustomer).not.toHaveBeenCalled()
  mockCustomer.mockResolvedValueOnce({ auth: null, status: 'error' })
  expect((await runWithDatabaseRequest(request, createTenantRequestResolver())).status).toBe('unavailable')
  mockStaff.mockResolvedValueOnce({ auth: null, status: 'error' })
  expect((await mockRender.run(new Map(), createTenantRequestResolver())).status).toBe('unavailable')
})

it('never promotes a foreign organization or inactive custom-domain mapping to a portal tenant', async () => {
  mockHeaders.mockResolvedValue(new Headers({ 'x-next-url': '/other/portal', host: 'localhost' }))
  mockFind.mockResolvedValueOnce(null)
  const foreign = await mockRender.run(new Map(), createTenantRequestResolver())
  expect(foreign.status === 'resolved' && foreign.context.tenantId).toBeNull()
  mockHeaders.mockResolvedValue(new Headers({ 'x-next-url': '/company/portal', host: 'customer.example.test' }))
  mockFind.mockResolvedValueOnce({ id: 'portal-org' }).mockResolvedValueOnce(null)
  const inactiveDomain = await mockRender.run(new Map(), createTenantRequestResolver())
  expect(inactiveDomain.status === 'resolved' && inactiveDomain.context.tenantId).toBeNull()
  expect(mockFind).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ status: 'active', tenantId: tenantB, organizationId: 'portal-org' }))
})

it('classifies public capability routes separately from staff and customer audiences', () => {
  expect(tenantRequestAudience('/api/customer_accounts/invitations/accept')).toBe('public')
  expect(tenantRequestAudience('/api/sales/quotes/public/capability')).toBe('public')
  expect(tenantRequestAudience('/api/warranty_claims/portal/claims')).toBe('customer')
  expect(tenantRequestAudience('/api/ecommerce/storefront/context')).toBe('customer')
})

it('keeps a real RSC cache resolver available when an API bundle registered its non-render cache first', async () => {
  const react = jest.requireMock('react') as typeof import('react')
  const { resolveDatabaseExecutionContext } = await import('@open-mercato/shared/lib/db/runtime')
  const globals = globalThis as Record<symbol, unknown>
  const runtimeKey = Symbol.for('@open-mercato/shared.databaseRuntime.v1')
  const rendererKey = Symbol.for('@open-mercato/enterprise.tenantBoundaryRequestRenderers.v1')
  delete globals[runtimeKey]
  delete globals[rendererKey]
  try {
    const apiCache = jest.spyOn(react, 'cache').mockImplementation((callback) => callback)
    registerTenantBoundaryRequestResolver()
    apiCache.mockRestore()
    registerTenantBoundaryRequestResolver()
    registerTenantBoundaryRequestResolver()
    await mockRender.run(new Map(), async () => {
      const first = await resolveDatabaseExecutionContext()
      const second = await resolveDatabaseExecutionContext()
      expect(first.status).toBe('resolved')
      if (first.status !== 'resolved' || second.status !== 'resolved') throw new Error('[internal] Expected RSC identity')
      expect(first.invocation.token).toBe(second.invocation.token)
      expect(first.context.tenantId).toBe(tenantA)
      expect(mockStaff).toHaveBeenCalledTimes(1)
    })
  } finally {
    jest.restoreAllMocks()
    delete globals[runtimeKey]
    delete globals[rendererKey]
  }
})
