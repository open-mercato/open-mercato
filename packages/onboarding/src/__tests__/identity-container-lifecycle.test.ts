import { AsyncLocalStorage } from 'node:async_hooks'
import { registerDatabaseRuntimeAdapter, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import { sendWorkspaceReadyEmail } from '../modules/onboarding/lib/ready-email'
import { runDeferredProvisioning } from '../modules/onboarding/lib/deferred-provisioning'

type Scope = { context: DatabaseExecutionContext; active: boolean }
const storage = new AsyncLocalStorage<Scope>()
const containers: Array<{ scope: Scope; dispose: jest.Mock }> = []
const findRequest = jest.fn()
const validateBinding = jest.fn()
const claimPreparation = jest.fn()
const sendEmail = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => {
    const scope = storage.getStore()!
    expect(scope.active).toBe(true)
    const container = {
      scope,
      resolve: () => ({}),
      dispose: jest.fn(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(storage.getStore()).toBe(scope)
        expect(scope.active).toBe(true)
        if (scope.context.kind === 'identity') {
          for (const child of containers.filter((entry) => entry.scope.context.kind === 'tenant')) {
            expect(child.dispose).toHaveBeenCalledTimes(1)
            expect(child.scope.active).toBe(false)
          }
        }
      }),
    }
    containers.push(container)
    return container
  },
}))
jest.mock('@open-mercato/onboarding/modules/onboarding/lib/service', () => ({
  OnboardingService: jest.fn(() => ({
    findById: () => findRequest(),
    claimPreparation: () => claimPreparation(),
    markReadyEmailSent: jest.fn(),
  })),
}))
jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: () => sendEmail() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ loadDictionary: async () => ({}) }))
jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({ createFallbackTranslator: () => (_key: string, fallback: string) => fallback }))
jest.mock('@open-mercato/onboarding/modules/onboarding/emails/WorkspaceReadyEmail', () => ({ __esModule: true, default: () => null }))
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({ getModules: () => [] }))

beforeAll(() => {
  const run = <Result,>(context: DatabaseExecutionContext, callback: () => Result): Result => {
    const scope = { context, active: true }
    return storage.run(scope, () => {
      const result = callback()
      void Promise.resolve(result).then(() => { scope.active = false }, () => { scope.active = false })
      return result
    })
  }
  registerDatabaseRuntimeAdapter({
    id: 'onboarding-identity-lifecycle', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready: async () => {}, dispose: () => {} }),
    run, runFresh: run,
  })
  registerDatabaseModuleDeclarations([{ moduleId: 'onboarding', declarations: { bindingValidators: [async () => {
    expect(storage.getStore()?.context.kind).toBe('identity')
    return validateBinding()
  }] } }])
})

const originalAppUrl = process.env.APP_URL
afterAll(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL
  else process.env.APP_URL = originalAppUrl
})

const args = { requestId: 'request', tenantId: 'tenant-a', organizationId: 'org-a' }
beforeEach(() => {
  jest.clearAllMocks()
  containers.length = 0
  validateBinding.mockResolvedValue(true)
  claimPreparation.mockResolvedValue(false)
  sendEmail.mockResolvedValue(undefined)
  process.env.APP_URL = 'https://example.test'
})

it.each([sendWorkspaceReadyEmail, runDeferredProvisioning])('awaits identity disposal on every exit from %p', async (run) => {
  for (const outcome of ['missing', 'lookup-failure', 'invalid-binding', 'binding-failure', 'tenant-failure', 'success']) {
    containers.length = 0
    const request = {
      id: args.requestId, tenantId: args.tenantId, organizationId: args.organizationId,
      userId: 'user', status: 'completed', tokenHash: 'hash', email: 'owner@example.test',
      preparationCompletedAt: run === sendWorkspaceReadyEmail ? new Date() : null,
    }
    findRequest.mockReset().mockResolvedValue(request)
    validateBinding.mockReset().mockResolvedValue(true)
    claimPreparation.mockReset().mockResolvedValue(false)
    if (outcome === 'missing') findRequest.mockResolvedValue(null)
    if (outcome === 'lookup-failure') findRequest.mockRejectedValue(new Error('lookup failed'))
    if (outcome === 'invalid-binding') validateBinding.mockResolvedValue(false)
    if (outcome === 'binding-failure') validateBinding.mockRejectedValue(new Error('binding failed'))
    if (outcome === 'tenant-failure') {
      if (run === sendWorkspaceReadyEmail) findRequest.mockResolvedValueOnce(request).mockRejectedValue(new Error('tenant failed'))
      else claimPreparation.mockRejectedValue(new Error('tenant failed'))
    }
    const operation = run(args)
    if (outcome.endsWith('failure')) await expect(operation).rejects.toThrow('failed')
    else await operation
    expect(containers[0].scope.context.kind).toBe('identity')
    expect(containers).toHaveLength(outcome === 'tenant-failure' || outcome === 'success' ? 2 : 1)
    for (const container of containers) {
      expect(container.dispose).toHaveBeenCalledTimes(1)
      expect(container.scope.active).toBe(false)
    }
  }
})
