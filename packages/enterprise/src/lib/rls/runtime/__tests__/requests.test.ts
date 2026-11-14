import { AsyncLocalStorage } from 'node:async_hooks'
import { runWithDatabaseRequest } from '@open-mercato/shared/lib/db/request'


const mockRender = new AsyncLocalStorage<Map<() => unknown, unknown>>()
const mockAfter = jest.fn()
const mockHeaders = jest.fn()
const mockIdentity = jest.fn()

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
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({ resolveDeclaredDatabaseRequestContext: (input: unknown) => mockIdentity(input) }))

import { createTenantRequestResolver, registerTenantBoundaryRequestResolver } from '../requests'

const tenantA = '22222222-2222-4222-8222-222222222222'
const tenantB = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  jest.clearAllMocks()
  mockAfter.mockImplementation(() => undefined)
  mockHeaders.mockResolvedValue(new Headers({ 'x-next-url': '/backend/customers', host: 'localhost' }))
  mockIdentity.mockResolvedValue({ kind: 'tenant', tenantId: tenantA, source: 'page' })
})

it('does not inspect ambient headers or authenticate outside an actual render or HTTP boundary', async () => {
  expect(await createTenantRequestResolver()()).toEqual({ status: 'absent' })
  expect(mockHeaders).not.toHaveBeenCalled()
  expect(mockIdentity).not.toHaveBeenCalled()
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
    expect(mockIdentity).toHaveBeenCalledTimes(1)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    const complete = mockAfter.mock.calls[0][0] as () => void
    complete()
    expect(first.invocation.isActive()).toBe(false)
  })
})

it('passes the actual HTTP pathname to declared providers and ignores a forged page pathname', async () => {
  const resolve = createTenantRequestResolver()
  const request = new Request('http://localhost/api/public/capability', { headers: { 'x-next-url': '/backend/customers' } })
  await runWithDatabaseRequest(request, resolve)
  expect(mockIdentity).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/api/public/capability', requireAuth: false, requireCustomerAuth: false }))
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

it('fails closed when lifecycle or a module-owned identity resolver is unavailable', async () => {
  const request = new Request('http://localhost/api/public/capability')
  mockAfter.mockImplementationOnce(() => { throw new Error('[internal] No response lifecycle') })
  expect((await runWithDatabaseRequest(request, createTenantRequestResolver())).status).toBe('unavailable')
  expect(mockIdentity).not.toHaveBeenCalled()
  mockIdentity.mockRejectedValueOnce(new Error('[internal] Identity unavailable'))
  expect((await mockRender.run(new Map(), createTenantRequestResolver())).status).toBe('unavailable')
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
      expect(mockIdentity).toHaveBeenCalledTimes(1)
    })
  } finally {
    jest.restoreAllMocks()
    delete globals[runtimeKey]
    delete globals[rendererKey]
  }
})
