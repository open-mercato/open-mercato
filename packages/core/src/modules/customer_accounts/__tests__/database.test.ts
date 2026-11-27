import { AsyncLocalStorage } from 'node:async_hooks'
import { registerDatabaseRuntimeAdapter, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
const storage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
const mockAuth = jest.fn()
const mockFind = jest.fn()
const mockDispose = jest.fn(async () => {
  await Promise.resolve()
  expect(storage.getStore()?.active).toBe(true)
  expect(storage.getStore()?.context.kind).toBe('identity')
})
jest.mock('../lib/customerAuthServer', () => ({ resolveCustomerAuthFromCookiesDetailed: () => mockAuth() }))
jest.mock('../lib/customerAuth', () => ({ resolveCustomerAuthFromRequestDetailed: () => mockAuth() }))
jest.mock('../lib/platformDomains', () => ({ platformDomains: () => ['localhost'] }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: () => ({}), dispose: mockDispose }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFind(...args) }))
import { databaseDeclarations } from '../database'
beforeAll(() => {
  registerDatabaseRuntimeAdapter({
    id: 'portal-domain-lifecycle', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready: async () => {}, dispose: () => {} }),
    run: (context, callback) => {
      const scope = { context, active: true }
      return storage.run(scope, () => {
        const result = callback()
        void Promise.resolve(result).then(() => { scope.active = false }, () => { scope.active = false })
        return result
      })
    },
  })
})
const provider = databaseDeclarations.requestProviders![0]
const input = { pathname: '/company/portal/support', headers: new Headers({ host: 'localhost' }), requireAuth: true, requireCustomerAuth: true }
beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue({ status: 'authenticated', auth: { tenantId: 'tenant', orgId: 'org' } }); mockFind.mockResolvedValue({ id: 'mapping' }) })
it('selects customer identity even when a staff cookie is also present', async () => {
  expect(provider.matches(input)).toBe(true)
  expect(await provider.resolve(input)).toEqual({ context: { kind: 'tenant', source: 'portal', tenantId: 'tenant' }, organization: { id: 'org', slug: 'company' } })
  expect(mockFind).not.toHaveBeenCalled()
})
it('requires a live matching domain for a non-platform hostname', async () => {
  const custom = { ...input, headers: new Headers({ host: 'customer.example.test' }) }
  mockFind.mockResolvedValueOnce(null)
  expect(await provider.resolve(custom)).toBeNull()
  expect(mockFind).toHaveBeenCalledWith(expect.anything(), expect.anything(), { hostname: 'customer.example.test', status: 'active', tenantId: 'tenant', organizationId: 'org' })
})
it('does not turn identity outages into an anonymous success', async () => {
  mockAuth.mockResolvedValueOnce({ status: 'error', auth: null })
  await expect(provider.resolve(input)).rejects.toThrow('unavailable')
})

it.each(['found', 'missing', 'failure'])('disposes the custom-domain container after %s lookup', async (outcome) => {
  if (outcome === 'missing') mockFind.mockResolvedValueOnce(null)
  if (outcome === 'failure') mockFind.mockRejectedValueOnce(new Error('lookup failed'))
  const operation = provider.resolve({ ...input, headers: new Headers({ host: 'customer.example.test' }) })
  if (outcome === 'failure') await expect(operation).rejects.toThrow('lookup failed')
  else await operation
  expect(mockDispose).toHaveBeenCalledTimes(1)
})
