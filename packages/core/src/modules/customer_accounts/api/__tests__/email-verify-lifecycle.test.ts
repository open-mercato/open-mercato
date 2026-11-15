import { AsyncLocalStorage } from 'node:async_hooks'
import { registerDatabaseRuntimeAdapter, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const storage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
const mockVerifyToken = jest.fn()
const mockUpdate = jest.fn()
const mockDisposals: { active: boolean; tenantId: string | null }[] = []
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => {
  const scope = storage.getStore()
  return {
    resolve: (name: string) => name === 'customerTokenService' ? { verifyEmailToken: mockVerifyToken } : { nativeUpdate: mockUpdate },
    dispose: async () => {
      await Promise.resolve()
      expect(storage.getStore()).toBe(scope)
      mockDisposals.push({ active: scope!.active, tenantId: scope!.context.tenantId })
    },
  }
} }))
jest.mock('../../events', () => ({ emitCustomerAccountsEvent: jest.fn(async () => undefined) }))
import { POST } from '../email/verify'

beforeAll(() => {
  registerDatabaseRuntimeAdapter({
    id: 'email-lifecycle', version: '1', configurationKey: 'test',
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
beforeEach(() => {
  jest.clearAllMocks()
  mockDisposals.length = 0
  mockVerifyToken.mockResolvedValue({ userId: 'user', tenantId: 'tenant' })
  mockUpdate.mockResolvedValue(1)
})
it.each(['success', 'failure'])('disposes the owned token continuation on %s while live', async (outcome) => {
  if (outcome === 'failure') mockUpdate.mockRejectedValueOnce(new Error('write failed'))
  const response = POST(new Request('https://app.example.test/api/customer_accounts/email/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(64) }),
  }))
  if (outcome === 'failure') await expect(response).rejects.toThrow('write failed')
  else expect((await response).status).toBe(200)
  expect(mockDisposals).toEqual([{ active: true, tenantId: 'tenant' }])
})
it('does not allocate a tenant container for an invalid token', async () => {
  mockVerifyToken.mockResolvedValueOnce(null)
  const response = await POST(new Request('https://app.example.test/api/customer_accounts/email/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(64) }),
  }))
  expect(response.status).toBe(400)
  expect(mockDisposals).toEqual([])
})
