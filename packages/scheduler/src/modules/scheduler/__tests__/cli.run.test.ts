export {}

const enqueue = jest.fn()
const close = jest.fn()
const createQueue = jest.fn(() => ({ enqueue, close }))

jest.mock('@open-mercato/queue', () => ({ createQueue }), { virtual: true })

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(() => 'redis://localhost:6379'),
}))

const findOne = jest.fn()
const resolve = jest.fn((name: string) => {
  if (name === 'em') return { findOne }
  throw new Error(`Could not resolve '${name}'`)
})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve })),
}))

jest.mock('../data/entities.js', () => ({ ScheduledJob: class ScheduledJob {} }))
jest.mock('../lib/safeQueueTargets', () => ({ auditSchedulerModuleQueueRows: jest.fn(() => []) }))

const SCHEDULE_ID = '11111111-1111-4111-8111-111111111111'

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    name: 'Nightly report',
    scheduleType: 'cron',
    scheduleValue: '0 2 * * *',
    scopeType: 'tenant',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    targetType: 'queue',
    targetQueue: 'reports',
    targetCommand: null,
    ...overrides,
  }
}

function loadRunCommand() {
  let commands: Array<{ command: string; run(rest: string[]): Promise<void> }> = []
  jest.isolateModules(() => {
    commands = require('../cli').default
  })
  const run = commands.find((cmd) => cmd.command === 'run')
  if (!run) throw new Error('run command not registered')
  return run
}

describe('mercato scheduler run', () => {
  const previousStrategy = process.env.QUEUE_STRATEGY
  const previousExitCode = process.exitCode
  let stdout: jest.SpyInstance
  let stderr: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    enqueue.mockResolvedValue('queue-job-1')
    close.mockResolvedValue(undefined)
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdout.mockRestore()
    stderr.mockRestore()
    process.exitCode = previousExitCode
    if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = previousStrategy
  })

  it('enqueues a manual execution with the full payload under the async strategy', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    findOne.mockResolvedValue(makeSchedule())

    await loadRunCommand().run([SCHEDULE_ID])

    expect(resolve).not.toHaveBeenCalledWith('queueService')
    expect(createQueue).toHaveBeenCalledWith('scheduler-execution', 'async', {
      connection: { url: 'redis://localhost:6379' },
    })
    expect(enqueue).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      scopeType: 'tenant',
      triggerType: 'manual',
      triggeredByUserId: null,
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('refuses without touching a queue when the strategy is not async', async () => {
    delete process.env.QUEUE_STRATEGY
    findOne.mockResolvedValue(makeSchedule())

    await expect(loadRunCommand().run([SCHEDULE_ID])).rejects.toThrow(
      'Manual trigger requires QUEUE_STRATEGY=async',
    )
    expect(createQueue).not.toHaveBeenCalled()
  })

  it('reports an unknown schedule without enqueueing', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    findOne.mockResolvedValue(null)

    await loadRunCommand().run([SCHEDULE_ID])

    expect(stderr).toHaveBeenCalledWith(`Schedule not found: ${SCHEDULE_ID}\n`)
    expect(createQueue).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('prints usage and exits non-zero when the schedule id is missing', async () => {
    await loadRunCommand().run([])

    expect(stderr).toHaveBeenCalledWith('Usage: mercato scheduler run <schedule-id>\n')
    expect(findOne).not.toHaveBeenCalled()
    expect(createQueue).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('closes the queue and fails when the enqueue fails', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    findOne.mockResolvedValue(makeSchedule())
    enqueue.mockRejectedValue(new Error('redis down'))

    await expect(loadRunCommand().run([SCHEDULE_ID])).rejects.toThrow('Failed to trigger job: redis down')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
