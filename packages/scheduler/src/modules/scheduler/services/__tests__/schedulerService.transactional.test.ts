import type { EntityManager } from '@mikro-orm/core'
import { SchedulerService, type ScheduleRegistration } from '../schedulerService'
import type { BullMQSchedulerService } from '../bullmqSchedulerService'
import { ScheduledJobSubscriber } from '../../lib/scheduledJobSubscriber'
import { isScheduleSyncDeferred } from '../../lib/deferredScheduleSync'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const registration: ScheduleRegistration = {
  id: 'upgrade-schedule-1',
  name: 'Upgrade schedule',
  scopeType: 'tenant',
  tenantId: 'tenant-1',
  scheduleType: 'interval',
  scheduleValue: '30m',
  targetType: 'queue',
  targetQueue: 'cart.sweep',
  sourceType: 'module',
  sourceModule: 'cart',
}

function createEm() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
}

describe('SchedulerService transactional registration', () => {
  let defaultEm: ReturnType<typeof createEm>
  let bullmq: jest.Mocked<Pick<BullMQSchedulerService, 'register' | 'unregister'>>
  let service: SchedulerService

  beforeEach(() => {
    defaultEm = createEm()
    bullmq = { register: jest.fn().mockResolvedValue(undefined), unregister: jest.fn().mockResolvedValue(undefined) }
    service = new SchedulerService(() => defaultEm as unknown as EntityManager, bullmq as unknown as BullMQSchedulerService)
  })

  it('writes through the supplied manager without forking and defers BullMQ until commit', async () => {
    const txEm = createEm()
    const afterCommit: Array<() => Promise<void>> = []

    await service.register(registration, {
      em: txEm as unknown as EntityManager,
      afterCommit: (callback) => afterCommit.push(callback),
    })

    expect(defaultEm.fork).not.toHaveBeenCalled()
    expect(txEm.persist).toHaveBeenCalledTimes(1)
    expect(txEm.flush).toHaveBeenCalledTimes(1)
    expect(bullmq.register).not.toHaveBeenCalled()
    const schedule = txEm.persist.mock.calls[0][0] as object
    expect(isScheduleSyncDeferred(schedule)).toBe(true)

    expect(afterCommit).toHaveLength(1)
    await afterCommit[0]()
    expect(bullmq.register).toHaveBeenCalledWith(schedule)
    expect(isScheduleSyncDeferred(schedule)).toBe(false)
  })

  it('never activates the queue when the caller rolls back and drops its callbacks', async () => {
    const txEm = createEm()
    await service.register(registration, { em: txEm as unknown as EntityManager, afterCommit: () => undefined })
    expect(bullmq.register).not.toHaveBeenCalled()
    expect(bullmq.unregister).not.toHaveBeenCalled()
  })

  it('propagates a failed post-commit sync to the caller and clears the deferral', async () => {
    bullmq.register.mockRejectedValueOnce(new Error('redis down'))
    const txEm = createEm()
    const afterCommit: Array<() => Promise<void>> = []
    await service.register(registration, {
      em: txEm as unknown as EntityManager,
      afterCommit: (callback) => afterCommit.push(callback),
    })
    const schedule = txEm.persist.mock.calls[0][0] as object

    await expect(afterCommit[0]()).rejects.toThrow('redis down')
    expect(isScheduleSyncDeferred(schedule)).toBe(false)
  })

  it('treats the deferred sync as a no-op when BullMQ is not configured', async () => {
    const localService = new SchedulerService(() => defaultEm as unknown as EntityManager)
    const txEm = createEm()
    const afterCommit: Array<() => Promise<void>> = []
    await localService.register(registration, {
      em: txEm as unknown as EntityManager,
      afterCommit: (callback) => afterCommit.push(callback),
    })
    await expect(afterCommit[0]()).resolves.toBeUndefined()
  })

  it('refuses a caller transaction without afterCommit before writing anything', async () => {
    const txEm = createEm()
    await expect(service.register(registration, { em: txEm as unknown as EntityManager })).rejects.toThrow('requires afterCommit')
    expect(txEm.flush).not.toHaveBeenCalled()
    expect(bullmq.register).not.toHaveBeenCalled()
  })

  it('keeps the legacy fork-and-sync behavior when no options are passed', async () => {
    const forked = createEm()
    defaultEm.fork.mockReturnValue(forked)
    await service.register(registration)
    expect(defaultEm.fork).toHaveBeenCalledTimes(1)
    expect(forked.flush).toHaveBeenCalledTimes(1)
    expect(bullmq.register).toHaveBeenCalledTimes(1)
    expect(isScheduleSyncDeferred(forked.persist.mock.calls[0][0] as object)).toBe(false)
  })
})

describe('ScheduledJobSubscriber with deferred schedules', () => {
  const originalStrategy = process.env.QUEUE_STRATEGY

  afterAll(() => {
    if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalStrategy
  })

  it('does not sync a schedule flushed inside a caller-owned transaction', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    const subscriber = new ScheduledJobSubscriber()
    const bullmq = { register: jest.fn().mockResolvedValue(undefined), unregister: jest.fn().mockResolvedValue(undefined) }
    subscriber.setContainer({
      hasRegistration: () => true,
      resolve: () => bullmq,
    } as never)

    const { ScheduledJob } = await import('../../data/entities.js')
    const txEm = createEm()
    txEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) =>
      Object.assign(Object.create(ScheduledJob.prototype), data),
    )
    const service = new SchedulerService(() => createEm() as unknown as EntityManager)
    await service.register(registration, { em: txEm as unknown as EntityManager, afterCommit: () => undefined })
    const deferredEntity = txEm.persist.mock.calls[0][0] as object
    const regular = Object.assign(Object.create(ScheduledJob.prototype), { ...registration, id: 'regular', isEnabled: true })

    await subscriber.afterFlush({
      uow: {
        getChangeSets: () => [
          { entity: deferredEntity, type: 'create', payload: { name: 'x' } },
          { entity: regular, type: 'create', payload: { name: 'y' } },
        ],
      },
    } as never)

    expect(bullmq.register).toHaveBeenCalledTimes(1)
    expect(bullmq.register).toHaveBeenCalledWith(regular, { skipNextRunUpdate: true })
  })
})
