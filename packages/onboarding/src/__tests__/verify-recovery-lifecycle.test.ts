import { AsyncLocalStorage } from 'node:async_hooks'
import { registerDatabaseRuntimeAdapter, runWithDatabaseExecutionContext, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const originalOnboardingEnabled = process.env.SELF_SERVICE_ONBOARDING_ENABLED
const scopeStorage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
const mockMarkCompleted = jest.fn(async () => undefined)
const mockAfter = jest.fn()
const mockDisposals: { kind: string; active: boolean }[] = []
const mockRequest = {
  id: 'request', tokenHash: 'hash', status: 'processing',
  tenantId: 'tenant', organizationId: 'organization', userId: 'user',
  expiresAt: new Date(Date.now() + 60_000), processingStartedAt: new Date(), deletedAt: null,
}
const mockFindById = jest.fn(async () => ({ ...mockRequest }))
const mockValidate = jest.fn(async (..._args: unknown[]) => runWithDatabaseExecutionContext({ kind: 'identity', tenantId: null, source: 'identity' }, async () => true))

jest.mock('@open-mercato/shared/lib/db/declarations', () => ({ validateDeclaredDatabaseBinding: (...args: unknown[]) => mockValidate(...args) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({
  resolve: () => ({}),
  dispose: async () => {
    await Promise.resolve()
    const scope = scopeStorage.getStore()!
    mockDisposals.push({ kind: scope.context.kind, active: scope.active })
  },
}) }))
jest.mock('next/server', () => ({
  after: (...args: unknown[]) => mockAfter(...args),
  NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) },
}))
jest.mock('../modules/onboarding/lib/service', () => ({ OnboardingService: jest.fn().mockImplementation(() => ({
  findByToken: async () => ({ ...mockRequest }), findById: () => mockFindById(), markCompleted: mockMarkCompleted,
})) }))
jest.mock('../modules/onboarding/lib/verify-base-url', () => ({ resolveVerifyRedirectBaseUrl: () => ({ ok: true, baseUrl: 'https://app.example.test' }) }))
jest.mock('../modules/onboarding/lib/verify-redirects', () => ({
  redirectToPreparing: () => new Response(null, { status: 302 }),
  redirectWithStatus: () => new Response(null, { status: 303 }),
}))
jest.mock('../modules/onboarding/lib/ready-email', () => ({ sendWorkspaceReadyEmail: jest.fn() }))
jest.mock('../modules/onboarding/lib/deferred-provisioning', () => ({
  resolveProvisioningIds: (request: typeof mockRequest) => ({ tenantId: request.tenantId, organizationId: request.organizationId, userId: request.userId }),
  runDeferredProvisioning: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({ setupInitialTenant: jest.fn() }))
jest.mock('../modules/onboarding/lib/consentClientIp', () => ({ resolveConsentClientIp: jest.fn() }))
import { GET } from '../modules/onboarding/api/get/onboarding/verify'

beforeAll(() => {
  const runFresh = <Result,>(context: DatabaseExecutionContext, callback: () => Result): Result => {
    const scope = { context, active: true }
    return scopeStorage.run(scope, () => {
      const result = callback()
      void Promise.resolve(result).then(() => { scope.active = false }, () => { scope.active = false })
      return result
    })
  }
  registerDatabaseRuntimeAdapter({
    id: 'recovery-lifecycle', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready: async () => {}, dispose: () => {} }),
    runFresh,
    run: (context, callback) => {
      if (scopeStorage.getStore()?.context.kind === 'tenant' && context.kind === 'identity') throw new Error('nested identity forbidden')
      return runFresh(context, callback)
    },
  })
})
beforeEach(() => {
  jest.clearAllMocks()
  mockDisposals.length = 0
  process.env.SELF_SERVICE_ONBOARDING_ENABLED = 'true'
})
afterAll(() => {
  if (originalOnboardingEnabled === undefined) delete process.env.SELF_SERVICE_ONBOARDING_ENABLED
  else process.env.SELF_SERVICE_ONBOARDING_ENABLED = originalOnboardingEnabled
})

it('recovers processing work with canonical validation before tenant entry and live cleanup', async () => {
  const response = await GET(new Request('https://app.example.test/api/onboarding/onboarding/verify?token=' + 'a'.repeat(64)))
  expect(response.status).toBe(302)
  expect(mockValidate).toHaveBeenCalledTimes(2)
  expect(mockMarkCompleted).toHaveBeenCalledTimes(1)
  expect(mockAfter).toHaveBeenCalledTimes(1)
  expect(mockDisposals).toEqual([{ kind: 'identity', active: true }, { kind: 'tenant', active: true }])
})
it('rejects a changed tenant binding without completing the request', async () => {
  mockFindById.mockResolvedValueOnce({ ...mockRequest, organizationId: 'other' })
  await GET(new Request('https://app.example.test/api/onboarding/onboarding/verify?token=' + 'a'.repeat(64)))
  expect(mockMarkCompleted).not.toHaveBeenCalled()
  expect(mockAfter).not.toHaveBeenCalled()
  expect(mockDisposals).toEqual([{ kind: 'identity', active: true }, { kind: 'tenant', active: true }])
})
it('cleans up the tenant invocation when recovery fails', async () => {
  mockMarkCompleted.mockRejectedValueOnce(new Error('write failed'))
  await expect(GET(new Request('https://app.example.test/api/onboarding/onboarding/verify?token=' + 'a'.repeat(64)))).rejects.toThrow('write failed')
  expect(mockDisposals).toEqual([{ kind: 'identity', active: true }, { kind: 'tenant', active: true }])
})

it('stops recovery when canonical binding validation fails before tenant entry', async () => {
  mockValidate.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  await GET(new Request('https://app.example.test/api/onboarding/onboarding/verify?token=' + 'a'.repeat(64)))
  expect(mockMarkCompleted).not.toHaveBeenCalled()
  expect(mockAfter).not.toHaveBeenCalled()
  expect(mockDisposals).toEqual([{ kind: 'identity', active: true }])
})
