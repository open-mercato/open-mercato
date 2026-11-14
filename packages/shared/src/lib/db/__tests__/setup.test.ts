import type { EntityManager } from '@mikro-orm/postgresql'
import { runDatabaseTenantSetup } from '../setup'
import { validateDeclaredDatabaseBinding } from '../declarations'
import { createRequestContainer } from '../../di/container'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '../runtime'

jest.mock('../declarations', () => ({ validateDeclaredDatabaseBinding: jest.fn(async () => true) }))
jest.mock('../../di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('../runtime', () => ({
  isDatabaseRuntimeEnabled: jest.fn(() => true),
  runWithFreshDatabaseExecutionContext: jest.fn((_context, callback) => callback()),
}))
const fallback = { em: {} as EntityManager, tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const enabled = jest.mocked(isDatabaseRuntimeEnabled)
const binding = jest.mocked(validateDeclaredDatabaseBinding)
const boundary = jest.mocked(runWithFreshDatabaseExecutionContext)
const createContainer = jest.mocked(createRequestContainer)
beforeEach(() => { jest.clearAllMocks(); enabled.mockReturnValue(true); binding.mockResolvedValue(true) })

it('preserves the original setup context when disabled', async () => {
  enabled.mockReturnValue(false)
  const callback = jest.fn(async () => 'legacy')
  await expect(runDatabaseTenantSetup(fallback, callback)).resolves.toBe('legacy')
  expect(callback).toHaveBeenCalledWith(fallback)
  expect(createContainer).not.toHaveBeenCalled()
})
it('validates a persisted workspace and supplies a fresh tenant entity manager', async () => {
  const scopedEm = {} as EntityManager
  const dispose = jest.fn(async () => undefined)
  const container = { resolve: jest.fn(() => scopedEm), dispose }
  createContainer.mockResolvedValue(container as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  const callback = jest.fn(async (context) => { expect(context.em).toBe(scopedEm); expect(context.container).toBe(container); return 'complete' })
  await expect(runDatabaseTenantSetup(fallback, callback)).resolves.toBe('complete')
  expect(binding).toHaveBeenCalledWith(expect.objectContaining({ organization: { id: fallback.organizationId } }), { requireValidator: true })
  expect(boundary.mock.calls.map(([context]) => context.kind)).toEqual(['identity', 'tenant'])
  expect(dispose).toHaveBeenCalledTimes(1)
})
it('rejects inactive workspaces before hooks and disposes containers after hook failure', async () => {
  const callback = jest.fn(async () => { throw new Error('hook failed') })
  binding.mockResolvedValue(false)
  await expect(runDatabaseTenantSetup(fallback, callback)).rejects.toThrow('persisted active workspace')
  expect(createContainer).not.toHaveBeenCalled()
  expect(callback).not.toHaveBeenCalled()
  binding.mockResolvedValue(true)
  const dispose = jest.fn(async () => undefined)
  createContainer.mockResolvedValue({ resolve: () => ({}), dispose } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  await expect(runDatabaseTenantSetup(fallback, callback)).rejects.toThrow('hook failed')
  expect(dispose).toHaveBeenCalledTimes(1)
})
