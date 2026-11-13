const mockFind = jest.fn()
const mockDispose = jest.fn(async () => {})
const mockContainer = jest.fn(async () => ({ resolve: () => ({}), dispose: mockDispose }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => mockContainer() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => mockFind(...args) }))
import { databaseDeclarations } from '../database'
import { Organization, Tenant } from '../data/entities'
const identity = { context: { kind: 'tenant' as const, tenantId: 'tenant', source: 'portal' as const }, organization: { id: 'org', slug: 'live-slug' } }
beforeEach(() => { jest.clearAllMocks(); mockFind.mockResolvedValue({ id: 'live' }) })
it('requires a live persisted tenant and organization binding including the declared slug', async () => {
  expect(await databaseDeclarations.bindingValidators![0](identity)).toBe(true)
  expect(mockFind).toHaveBeenNthCalledWith(1, expect.anything(), Tenant, { id: 'tenant', isActive: true, deletedAt: null })
  expect(mockFind).toHaveBeenNthCalledWith(2, expect.anything(), Organization, { id: 'org', tenant: 'tenant', slug: 'live-slug', isActive: true, deletedAt: null })
  expect(mockDispose).toHaveBeenCalledTimes(1)
})
it('refuses inactive tenants and foreign or inactive organizations', async () => {
  mockFind.mockResolvedValueOnce(null)
  expect(await databaseDeclarations.bindingValidators![0](identity)).toBe(false)
  expect(mockDispose).toHaveBeenCalledTimes(1)
  expect(mockFind).toHaveBeenCalledTimes(1)
  mockFind.mockResolvedValueOnce({ id: 'live' }).mockResolvedValueOnce(null)
  expect(await databaseDeclarations.bindingValidators![0](identity)).toBe(false)
  expect(mockDispose).toHaveBeenCalledTimes(2)
})
it('propagates a database outage rather than approving an unverified binding', async () => {
  mockFind.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(databaseDeclarations.bindingValidators![0](identity)).rejects.toThrow('database unavailable')
  expect(mockDispose).toHaveBeenCalledTimes(1)
})
