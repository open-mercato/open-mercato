import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { ScheduledJob } from '../../data/entities'
import executeScheduleWorker from '../execute-schedule.worker'

const mockCommandExecute = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  CommandBus: jest.fn().mockImplementation(() => ({
    execute: mockCommandExecute,
  })),
}))

jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(),
}), { virtual: true })

jest.mock('../../events', () => ({
  emitSchedulerEvent: jest.fn(async () => undefined),
}))

const scheduleId = '11111111-1111-4111-8111-111111111111'

function buildCommandSchedule(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const schedule = new ScheduledJob()
  schedule.id = scheduleId
  schedule.name = 'Scoped command'
  schedule.scopeType = 'organization'
  schedule.tenantId = 'tenant-a'
  schedule.organizationId = 'org-a'
  schedule.isEnabled = true
  schedule.targetType = 'command'
  schedule.targetCommand = 'scheduler.test.assert-tenant-scope'
  schedule.targetPayload = { checkedTenantId: 'tenant-b' }
  schedule.scheduleType = 'cron'
  schedule.scheduleValue = '* * * * *'
  schedule.timezone = 'UTC'
  schedule.sourceType = 'user'
  schedule.createdAt = new Date('2026-01-01T00:00:00.000Z')
  schedule.updatedAt = new Date('2026-01-01T00:00:00.000Z')
  Object.assign(schedule, overrides)
  return schedule
}

function buildWorkerContext(schedule: ScheduledJob) {
  const em = {
    findOne: jest.fn(async () => schedule),
    flush: jest.fn(async () => undefined),
  }
  const rbacService = {
    tenantHasFeature: jest.fn(async () => true),
  }
  return {
    context: {
      jobId: 'worker-job-1',
      attemptNumber: 1,
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbacService
        throw new Error(`Unexpected dependency: ${name}`)
      }),
    },
    em,
    rbacService,
  }
}

describe('executeScheduleWorker command scope', () => {
  afterEach(() => {
    mockCommandExecute.mockReset()
  })

  it('runs scheduled commands with schedule-bound tenant auth so command guards enforce tenant scope (#3899)', async () => {
    mockCommandExecute.mockImplementation(async (_commandId, { input, ctx }) => {
      ensureTenantScope(ctx, String((input as { checkedTenantId: string }).checkedTenantId))
      return { result: { ok: true }, logEntry: null }
    })

    const schedule = buildCommandSchedule()
    const { context, em } = buildWorkerContext(schedule)

    await expect(
      executeScheduleWorker(
        {
          id: 'queued-job-1',
          queue: 'scheduler-execution',
          payload: {
            scheduleId,
            tenantId: 'tenant-a',
            organizationId: 'org-a',
            scopeType: 'organization',
          },
          attempts: 0,
          createdAt: Date.now(),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CrudHttpError)

    expect(em.flush).not.toHaveBeenCalled()
  })
})
