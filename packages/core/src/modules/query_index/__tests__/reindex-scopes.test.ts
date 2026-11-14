import { runQueryIndexTenantContinuation } from '../lib/reindex-scopes'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'
import { runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({ ...jest.requireActual('@open-mercato/shared/lib/db/declarations'), validateDeclaredDatabaseBinding: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({ runWithFreshDatabaseExecutionContext: jest.fn((_context, callback) => callback()) }))
const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(true)
})
it('validates each persisted binding before its fresh container and disposes both', async () => {
  const first = { resolve: jest.fn(), dispose: jest.fn() }
  const second = { resolve: jest.fn(), dispose: jest.fn() }
  jest.mocked(createRequestContainer)
    .mockResolvedValueOnce(first as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
    .mockResolvedValueOnce(second as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  const callback = jest.fn(async (container: unknown, tenant: string) => ({ container, tenant }))
  await expect(runQueryIndexTenantContinuation(tenantId, null, callback)).resolves.toEqual({ container: first, tenant: tenantId })
  await expect(runQueryIndexTenantContinuation(otherTenantId, null, callback)).resolves.toEqual({ container: second, tenant: otherTenantId })
  expect(first.dispose).toHaveBeenCalledTimes(1)
  expect(second.dispose).toHaveBeenCalledTimes(1)
  expect(validateDeclaredDatabaseBinding).toHaveBeenCalledWith({ context: expect.objectContaining({ tenantId }) }, { requireValidator: true })
  expect(jest.mocked(validateDeclaredDatabaseBinding).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(createRequestContainer).mock.invocationCallOrder[0])
  expect(jest.mocked(runWithFreshDatabaseExecutionContext).mock.calls.map(([context]) => context.kind)).toEqual(['identity', 'tenant', 'identity', 'tenant'])
})
it('disposes the scoped container when tenant work fails', async () => {
  const container = { resolve: jest.fn(), dispose: jest.fn() }
  jest.mocked(createRequestContainer).mockResolvedValue(container as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  await expect(runQueryIndexTenantContinuation(tenantId, null, async () => { throw new Error('failed') })).rejects.toThrow('failed')
  expect(container.dispose).toHaveBeenCalledTimes(1)
})
it('rejects inactive persisted binding before creating a container', async () => {
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(false)
  await expect(runQueryIndexTenantContinuation(tenantId, null, jest.fn())).rejects.toThrow('persisted active')
  expect(createRequestContainer).not.toHaveBeenCalled()
})
it('rejects invalid tenant UUID before binding validation', async () => {
  await expect(runQueryIndexTenantContinuation('invalid', null, jest.fn())).rejects.toThrow('UUID')
  expect(validateDeclaredDatabaseBinding).not.toHaveBeenCalled()
  expect(createRequestContainer).not.toHaveBeenCalled()
})
