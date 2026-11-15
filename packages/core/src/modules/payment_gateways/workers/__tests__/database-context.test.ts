import { databaseDeclarations, runPaymentMaintenanceTenant } from '../../database'
import { validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: jest.fn(() => true),
  runWithFreshDatabaseExecutionContext: jest.fn((_context, callback) => callback()),
}))
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/db/declarations'),
  validateDeclaredDatabaseBinding: jest.fn(async () => true),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))

const tenantId = '12345678-1234-4234-8234-123456789012'
const organizationId = '12345678-1234-4234-8234-123456789013'
const fallback = { resolve: jest.fn() }
const scopedEm = { resolve: jest.fn() }
const dispose = jest.fn(async () => undefined)

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(true)
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(true)
  jest.mocked(createRequestContainer).mockResolvedValue({ ...scopedEm, dispose } as never)
})

it.each([
  ['payment-gateways-status-poller', 'payment-gateways:status-poller'],
])('classifies only the exact owner worker for %s', async (queue, id) => {
  const provider = databaseDeclarations.jobProviders![0]
  const input = { queue, workerIds: [id], payload: { maintenance: false } }
  expect(provider.matches(input)).toBe(true)
  await expect(provider.resolve(input)).resolves.toMatchObject({ kind: 'maintenance' })
  expect(provider.matches({ ...input, workerIds: [id, 'extension'] })).toBe(false)
  expect(provider.matches({ ...input, workerIds: ['extension'], payload: { maintenance: true } })).toBe(false)
  expect(provider.matches({ ...input, queue: 'extension' })).toBe(false)
})

it('validates persisted scope before constructing the restricted container and disposes it on failure', async () => {
  const failure = new Error('tenant failure')
  const callback = jest.fn(async (container: { resolve: <T = unknown>(name: string) => T }) => { expect(container.resolve).toBe(scopedEm.resolve); throw failure })
  await expect(runPaymentMaintenanceTenant({ tenantId, organizationId }, fallback, callback)).rejects.toBe(failure)
  expect(validateDeclaredDatabaseBinding).toHaveBeenCalledWith({ context: expect.objectContaining({ tenantId, kind: 'tenant' }), organization: { id: organizationId } }, { requireValidator: true })
  expect(jest.mocked(validateDeclaredDatabaseBinding).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(createRequestContainer).mock.invocationCallOrder[0])
  expect(jest.mocked(runWithFreshDatabaseExecutionContext).mock.calls.map(([context]) => context.kind)).toEqual(['identity', 'tenant'])
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('rejects missing persisted bindings and malformed tenant IDs before tenant work', async () => {
  const callback = jest.fn()
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(false)
  await expect(runPaymentMaintenanceTenant({ tenantId }, fallback, callback)).rejects.toThrow('persisted active workspace')
  await expect(runPaymentMaintenanceTenant({ tenantId: 'payload-flag' }, fallback, callback)).rejects.toThrow('tenant UUID')
  expect(createRequestContainer).not.toHaveBeenCalled()
  expect(callback).not.toHaveBeenCalled()
})

it('retains the legacy disabled path without binding or container work', async () => {
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(false)
  await runPaymentMaintenanceTenant({ tenantId: 'legacy' }, fallback, async (em) => { expect(em).toBe(fallback) })
  expect(validateDeclaredDatabaseBinding).not.toHaveBeenCalled()
  expect(createRequestContainer).not.toHaveBeenCalled()
})
