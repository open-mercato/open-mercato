import { createSearchWorkerHandler } from '../modules/search/lib/worker-database'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveDeclaredDatabaseJobContext, validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({ resolveDeclaredDatabaseJobContext: jest.fn(), validateDeclaredDatabaseBinding: jest.fn() }))
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({ isDatabaseRuntimeEnabled: jest.fn(), runWithFreshDatabaseExecutionContext: jest.fn() }))

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const job = { id: 'fixture', payload: { tenantId }, createdAt: new Date().toISOString() }
const context = { jobId: job.id, queueName: 'vector-indexing', attemptNumber: 1 }

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(true)
  jest.mocked(resolveDeclaredDatabaseJobContext).mockResolvedValue({ kind: 'tenant', tenantId, source: 'worker', operation: context.queueName })
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(true)
  jest.mocked(runWithFreshDatabaseExecutionContext).mockImplementation(async (_scope, operation) => operation())
})

it('creates and disposes distinct containers for concurrent jobs and retries inside tenant scopes', async () => {
  const containers = Array.from({ length: 3 }, (_, index) => ({ resolve: jest.fn(() => index), dispose: jest.fn(async () => {}) }))
  for (const container of containers) jest.mocked(createRequestContainer).mockResolvedValueOnce(container as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  const handler = jest.fn(async (_job, _context, container) => { await Promise.resolve(); expect(container.resolve('em')).toEqual(expect.any(Number)) })
  const wrapped = createSearchWorkerHandler(handler)
  await Promise.all([wrapped(job, context), wrapped(job, { ...context, jobId: 'second' })])
  await wrapped(job, { ...context, attemptNumber: 2 })
  expect(handler).toHaveBeenCalledTimes(3)
  expect(validateDeclaredDatabaseBinding).toHaveBeenCalledTimes(3)
  expect(jest.mocked(runWithFreshDatabaseExecutionContext).mock.calls.map(([scope]) => scope.kind)).toEqual(['identity', 'identity', 'tenant', 'tenant', 'identity', 'tenant'])
  for (const container of containers) expect(container.dispose).toHaveBeenCalledTimes(1)
})

it('rejects invalid bindings and forged identities before container creation', async () => {
  const wrapped = createSearchWorkerHandler(jest.fn())
  jest.mocked(validateDeclaredDatabaseBinding).mockResolvedValue(false)
  await expect(wrapped(job, context)).rejects.toThrow('tenant binding')
  jest.mocked(resolveDeclaredDatabaseJobContext).mockRejectedValue(new Error('Conflicting database job tenant identities'))
  await expect(wrapped(job, context)).rejects.toThrow('Conflicting')
  expect(createRequestContainer).not.toHaveBeenCalled()
})

it('disposes a failed job before its invocation ends', async () => {
  const dispose = jest.fn(async () => {})
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve: jest.fn(), dispose } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  await expect(createSearchWorkerHandler(async () => { throw new Error('retry') })(job, context)).rejects.toThrow('retry')
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('retains disabled execution without identity or tenant hooks', async () => {
  jest.mocked(isDatabaseRuntimeEnabled).mockReturnValue(false)
  const dispose = jest.fn(async () => {})
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve: jest.fn(), dispose } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  await createSearchWorkerHandler(async () => {})(job, context)
  expect(resolveDeclaredDatabaseJobContext).not.toHaveBeenCalled()
  expect(runWithFreshDatabaseExecutionContext).not.toHaveBeenCalled()
  expect(dispose).toHaveBeenCalledTimes(1)
})
