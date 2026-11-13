const mockAuth = jest.fn()
const mockFind = jest.fn()
jest.mock('../lib/customerAuthServer', () => ({ resolveCustomerAuthFromCookiesDetailed: () => mockAuth() }))
jest.mock('../lib/customerAuth', () => ({ resolveCustomerAuthFromRequestDetailed: () => mockAuth() }))
jest.mock('../lib/platformDomains', () => ({ platformDomains: () => ['localhost'] }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: () => ({}) }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFind(...args) }))
import { databaseDeclarations } from '../database'
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
