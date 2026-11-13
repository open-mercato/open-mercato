import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import type { ScheduledJob } from '../../data/entities'

const scopes = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean; token: symbol }>()
const invocations: NonNullable<ReturnType<typeof scopes.getStore>>[] = []
const findOne = jest.fn()
const clear = jest.fn()
const em = { findOne, clear }
const fork = jest.fn(() => em)
const ownerResolve = jest.fn()
const getModules = jest.fn(() => [{ id: 'owner', workers: [{ id: 'owner:global', queue: 'global' }] }])

jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  isDatabaseRuntimeEnabled: () => true,
  runWithFreshDatabaseExecutionContext: (context: DatabaseExecutionContext, callback: () => Promise<unknown>) => {
    const invocation = { context, active: true, token: Symbol() }
    invocations.push(invocation)
    return scopes.run(invocation, async () => {
      try { return await callback() } finally { invocation.active = false }
    })
  },
}))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({ getOrm: async () => {
  expect(scopes.getStore()?.context.kind).toBe('maintenance')
  expect(scopes.getStore()?.active).toBe(true)
  return { em: { fork } }
} }))
jest.mock('@open-mercato/shared/lib/db/declarations', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/db/declarations'),
  resolveOwnedDatabaseJobContext: (...arguments_: unknown[]) => ownerResolve(...arguments_),
}))
jest.mock('@open-mercato/shared/lib/modules/registry', () => ({ getModules: () => getModules() }))
jest.mock('../../data/entities', () => ({ ScheduledJob: class {} }))
jest.mock('../safeQueueTargets', () => ({
  canDispatchScheduleQueueTarget: () => true,
  sanitizeSchedulerTargetPayload: () => ({ scope: { tenantId: null, organizationId: null } }),
}))

import { assertScheduleEnvelope, resolvePersistedScheduleDatabaseContext, resolveScheduleDatabaseContext, withSchedulerMaintenance } from '../databaseContext'
import { database } from '../../database'

const tenantId = '11111111-1111-4111-8111-111111111111'
const scheduleId = '22222222-2222-4222-8222-222222222222'
const schedule = (overrides: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: scheduleId, scopeType: 'tenant', tenantId, organizationId: null,
  targetPayload: { tenantId: 'untrusted' }, ...overrides,
}) as ScheduledJob
const envelope = { scheduleId, scopeType: 'tenant', tenantId, organizationId: null }

beforeEach(() => { jest.clearAllMocks(); invocations.length = 0; findOne.mockResolvedValue(schedule()) })

test('discovery uses fresh maintenance ORM and clears it before resolving the runtime tenant', async () => {
  const first = await resolvePersistedScheduleDatabaseContext(envelope)
  const second = await resolvePersistedScheduleDatabaseContext(envelope)
  expect(first).toEqual({ kind: 'tenant', tenantId, source: 'scheduler', operation: `schedule:${scheduleId}` })
  expect(second).toEqual(first)
  expect(invocations).toHaveLength(2)
  expect(invocations[0].token).not.toBe(invocations[1].token)
  expect(invocations.every((invocation) => !invocation.active)).toBe(true)
  expect(clear).toHaveBeenCalledTimes(2)
  expect(ownerResolve).not.toHaveBeenCalled()
})

test('maintenance cleanup runs on discovery failure', async () => {
  await expect(withSchedulerMaintenance('failure', async () => { throw new Error('offline') })).rejects.toThrow('offline')
  expect(clear).toHaveBeenCalledTimes(1)
  expect(invocations[0].active).toBe(false)
})

test.each([
  { ...envelope, tenantId: '33333333-3333-4333-8333-333333333333' },
  { ...envelope, scopeType: 'system' },
  { ...envelope, organizationId: tenantId },
  { ...envelope, scheduleId: 'not-a-uuid' },
])('rejects forged or malformed envelope before execution: %j', async (payload) => {
  await expect(resolvePersistedScheduleDatabaseContext(payload)).rejects.toThrow()
  expect(ownerResolve).not.toHaveBeenCalled()
})

test('missing persisted schedules reject instead of trusting queue tenant fields', async () => {
  findOne.mockResolvedValue(null)
  await expect(resolvePersistedScheduleDatabaseContext(envelope)).rejects.toThrow('missing schedule')
})

test.each([
  { scopeType: 'tenant', tenantId: null },
  { scopeType: 'tenant', tenantId: 'bad' },
  { scopeType: 'tenant', organizationId: tenantId },
  { scopeType: 'organization', organizationId: null },
  { scopeType: 'system', tenantId },
])('rejects inconsistent persisted scope: %j', async (overrides) => {
  await expect(resolveScheduleDatabaseContext(schedule(overrides as Partial<ScheduledJob>))).rejects.toThrow()
})

test('global rows require owner classification and cannot derive tenant from target payload', async () => {
  const global = schedule({ scopeType: 'system', tenantId: null, sourceType: 'module', sourceModule: 'owner', targetType: 'queue', targetQueue: 'global' })
  ownerResolve.mockResolvedValue({ kind: 'maintenance', tenantId: null, source: 'maintenance', operation: 'owner.global' })
  await expect(resolveScheduleDatabaseContext(global)).resolves.toMatchObject({ kind: 'maintenance', tenantId: null })
  expect(ownerResolve).toHaveBeenCalledWith('owner', {
    queue: 'global', workerIds: ['owner:global'], payload: { scope: { tenantId: null, organizationId: null } },
  })
  ownerResolve.mockResolvedValue({ kind: 'tenant', tenantId, source: 'worker' })
  await expect(resolveScheduleDatabaseContext(global)).rejects.toThrow('explicitly classify')
  await expect(resolveScheduleDatabaseContext({ ...global, sourceType: 'user' })).rejects.toThrow('module ownership')
  await expect(resolveScheduleDatabaseContext({ ...global, targetType: 'command' })).rejects.toThrow('explicit database classification')
})

test('scheduler owner declaration intercepts execution jobs and resolves persisted identity before container creation', async () => {
  const provider = database.jobProviders![0]
  expect(provider.matches({ queue: 'scheduler-execution', workerIds: [], payload: envelope })).toBe(true)
  expect(provider.matches({ queue: 'other', workerIds: [], payload: envelope })).toBe(false)
  await expect(provider.resolve({ queue: 'scheduler-execution', workerIds: [], payload: envelope })).resolves.toMatchObject({ kind: 'tenant', tenantId })
  expect(invocations[0].active).toBe(false)
  expect(() => assertScheduleEnvelope(schedule(), envelope)).not.toThrow()
})

import { createPerJobWorkerHandler } from '../../../../../../cli/src/lib/worker-job-handler'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import type { JobContext, QueuedJob } from '@open-mercato/queue'


test('actual queue dispatcher resolves scheduler ownership before fresh per-attempt containers and cleanup', async () => {
  registerDatabaseModuleDeclarations([{ moduleId: 'scheduler', declarations: database }])
  const executionScopes: NonNullable<ReturnType<typeof scopes.getStore>>[] = []
  const cleanupScopes: NonNullable<ReturnType<typeof scopes.getStore>>[] = []
  const createContainer = jest.fn(async () => {
    const scope = scopes.getStore()!
    expect(scope.context).toMatchObject({ kind: 'tenant', tenantId })
    expect(scope.active).toBe(true)
    expect(invocations.filter((invocation) => invocation.context.kind === 'maintenance').every((invocation) => !invocation.active)).toBe(true)
    executionScopes.push(scope)
    return { resolve: <Result,>() => ({ clear: () => { expect(scopes.getStore()?.active).toBe(true); cleanupScopes.push(scope) } }) as Result }
  })
  let fail = true
  const handler = createPerJobWorkerHandler([{
    id: 'scheduler:execute-schedule', queue: 'scheduler-execution', moduleId: 'scheduler',
    handler: async () => { if (fail) throw new Error('retry') },
  }], createContainer)
  const job = { id: 'execution', payload: envelope, createdAt: new Date() } as QueuedJob
  const context = { queueName: 'scheduler-execution', jobId: 'execution', attemptNumber: 1 } as JobContext
  await expect(handler(job, context)).rejects.toThrow('retry')
  fail = false
  await handler(job, { ...context, attemptNumber: 2 })
  expect(createContainer).toHaveBeenCalledTimes(2)
  expect(executionScopes[0].token).not.toBe(executionScopes[1].token)
  expect(cleanupScopes).toEqual(executionScopes)
  expect(invocations.every((invocation) => !invocation.active)).toBe(true)
  await expect(handler({ ...job, payload: { ...envelope, tenantId: scheduleId } }, context)).rejects.toThrow('persisted scope')
  expect(createContainer).toHaveBeenCalledTimes(2)
})
