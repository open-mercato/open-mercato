import { AsyncLocalStorage } from 'node:async_hooks'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerDatabaseRuntimeAdapter, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { hasPersistedWorkspace, runOnboardingIdentity, runOnboardingTenant, withOnboardingTimeout } from '../modules/onboarding/lib/tenant-continuation'
import { OnboardingRequest } from '../modules/onboarding/data/entities'

const validateBinding = jest.fn()
const storage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
const containers: unknown[] = []

jest.mock('@open-mercato/shared/lib/db/declarations', () => ({
  validateDeclaredDatabaseBinding: (...args: unknown[]) => validateBinding(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => {
    const scope = storage.getStore()
    if (!scope?.active) throw new Error('inactive container scope')
    const container = { scope, resolve: () => ({ scope }) }
    containers.push(container)
    return container
  },
}))

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
    id: 'onboarding-test', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready: async () => {}, dispose: () => {} }),
    run, runFresh: run,
  })
})

beforeEach(() => { jest.clearAllMocks(); containers.length = 0 })

it('requires a live persisted tenant and its matching organization', async () => {
  const request = Object.assign(new OnboardingRequest(), { tenantId: 'tenant-a', organizationId: 'org-a' })
  validateBinding.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await hasPersistedWorkspace({} as EntityManager, request)).toBe(false)
  expect(validateBinding).toHaveBeenCalledWith({
    context: { kind: 'tenant', tenantId: 'tenant-a', source: 'public-token', operation: 'onboarding-binding' },
    organization: { id: 'org-a' },
  }, { requireValidator: true })
  expect(await hasPersistedWorkspace({} as EntityManager, request)).toBe(true)
  request.deletedAt = new Date()
  expect(await hasPersistedWorkspace({} as EntityManager, request)).toBe(false)
  expect(validateBinding).toHaveBeenCalledTimes(2)
})

it('constructs each continuation container under its own live tenant invocation', async () => {
  await runOnboardingIdentity(async () => {
    await runOnboardingTenant('tenant-a', async () => {
      expect(storage.getStore()?.context).toMatchObject({ kind: 'tenant', tenantId: 'tenant-a' })
      expect(storage.getStore()?.active).toBe(true)
    })
    expect(storage.getStore()?.context.kind).toBe('identity')
    await runOnboardingTenant('tenant-a', async () => {})
  })
  expect(containers).toHaveLength(2)
  expect(containers[0]).not.toBe(containers[1])
})

it('revokes timed-out seed authority before its delayed continuation resumes', async () => {
  jest.useFakeTimers()
  let resume: () => void = () => {}
  let lateAuthority: boolean | undefined
  const delayed = new Promise<void>((resolve) => { resume = resolve })
  const result = runOnboardingTenant('tenant-a', async () => withOnboardingTimeout('seedExamples', 15_000, async () => {
    await delayed
    lateAuthority = storage.getStore()?.active
  }))
  const rejected = expect(result).rejects.toThrow('timed out')
  await jest.advanceTimersByTimeAsync(15_000)
  await rejected
  resume()
  await Promise.resolve()
  expect(lateAuthority).toBe(false)
  expect(jest.getTimerCount()).toBe(0)
  jest.useRealTimers()
})
