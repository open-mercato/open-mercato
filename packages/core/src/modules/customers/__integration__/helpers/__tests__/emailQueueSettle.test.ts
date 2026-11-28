import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getQueuePendingProbe } from '@open-mercato/queue'
import { createLocalQueue } from '@open-mercato/queue/strategies/local'
import { waitForEmailQueuesToSettle } from '../emailQueueSettle'

jest.mock('@open-mercato/queue', () => ({
  getQueuePendingProbe: jest.fn(jest.requireActual('@open-mercato/queue/pending-probe').getQueuePendingProbe),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

const probeMock = jest.mocked(getQueuePendingProbe)
const realProbe = jest.requireActual<typeof import('@open-mercato/queue/pending-probe')>(
  '@open-mercato/queue/pending-probe',
).getQueuePendingProbe

describe('CRM refused-reply email queue barrier', () => {
  let appRoot: string
  const originalQueueBaseDir = process.env.QUEUE_BASE_DIR
  const originalQueueStrategy = process.env.QUEUE_STRATEGY
  const originalAppRoot = process.env.OM_TEST_APP_ROOT

  beforeEach(async () => {
    appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-email-barrier-'))
    process.env.OM_TEST_APP_ROOT = appRoot
    delete process.env.QUEUE_BASE_DIR
    process.env.QUEUE_STRATEGY = 'local'
    probeMock.mockReset().mockImplementation(realProbe)
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries({
      QUEUE_BASE_DIR: originalQueueBaseDir,
      QUEUE_STRATEGY: originalQueueStrategy,
      OM_TEST_APP_ROOT: originalAppRoot,
    })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await fs.rm(appRoot, { recursive: true, force: true })
  })

  it.each(['events', 'communication-channels-outbound'])(
    'waits through a real active %s handler so a late forbidden write fails footprint equality',
    async (queueName) => {
      const baseDir = path.join(appRoot, '.mercato/queue')
      const queue = createLocalQueue(queueName, { baseDir })
      const footprint = { messages: 0, channelLinks: 0, conversations: 0, threadMappings: 0, interactions: 0 }
      const before = { ...footprint }
      let finishHandler = () => {}
      const handlerGate = new Promise<void>((resolve) => { finishHandler = resolve })
      let markStarted = () => {}
      const handlerStarted = new Promise<void>((resolve) => { markStarted = resolve })
      let markPending = () => {}
      const pendingObserved = new Promise<void>((resolve) => { markPending = resolve })
      probeMock.mockImplementation(async (...args) => {
        const probe = await realProbe(...args)
        if (probe.ready > 0) markPending()
        return probe
      })
      await queue.enqueue({ forbiddenReply: true })
      const processing = queue.process(async () => {
        markStarted()
        await handlerGate
        footprint.interactions += 1
      })
      await handlerStarted
      let settled = false
      const observation = waitForEmailQueuesToSettle(appRoot, { pollIntervalMs: 5 })
        .then(() => {
          settled = true
          return { ...footprint }
        })
      try {
        await Promise.race([
          pendingObserved,
          observation.then(() => { throw new Error('[internal] Barrier returned before observing the active handler') }),
        ])
        expect(settled).toBe(false)
        expect(footprint).toEqual(before)
        finishHandler()
        await processing
        const after = await observation
        expect(() => expect(after).toEqual(before)).toThrow()
        expect(after.interactions).toBe(1)
        expect(probeMock).toHaveBeenCalledWith(queueName, undefined, { baseDir })
      } finally {
        finishHandler()
        await processing
        await queue.close()
      }
    },
  )

  it.each(['custom-queue', 'absolute'])(
    'honors a %s app queue location when the test runs from another working directory',
    async (location) => {
      const baseDir = path.join(appRoot, 'custom-queue')
      process.env.QUEUE_BASE_DIR = location === 'absolute' ? baseDir : 'custom-queue'
      await fs.mkdir(baseDir)

      await waitForEmailQueuesToSettle(appRoot, { pollIntervalMs: 1 })

      expect(probeMock).toHaveBeenCalledWith('events', undefined, { baseDir })
      expect(probeMock).toHaveBeenCalledWith('communication-channels-outbound', undefined, { baseDir })
      expect(path.resolve(process.cwd(), 'custom-queue')).not.toBe(baseDir)
    },
  )

  it('fails closed when the app queue directory is unavailable', async () => {
    await expect(waitForEmailQueuesToSettle(appRoot)).rejects.toThrow(/ENOENT/)
  })

  it('fails closed on an unreadable queue snapshot', async () => {
    const queueDir = path.join(appRoot, '.mercato/queue/events')
    await fs.mkdir(queueDir, { recursive: true })
    await fs.writeFile(path.join(queueDir, 'queue.json'), '{invalid')

    await expect(waitForEmailQueuesToSettle(appRoot)).rejects.toThrow(/Cannot inspect events/)
  })

  it('fails closed when an async queue probe is unavailable', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    probeMock.mockResolvedValue({
      queueName: 'events', strategy: 'async', ready: 0, delayedFuture: 0, active: 0,
      error: true, errorMessage: 'Redis unavailable',
    })

    await expect(waitForEmailQueuesToSettle(appRoot)).rejects.toThrow(/Redis unavailable/)
  })

  it('waits for async active jobs and probes again after they finish', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    const idle = { queueName: 'events', strategy: 'async' as const, ready: 0, delayedFuture: 0, active: 0, error: false }
    probeMock.mockResolvedValueOnce({ ...idle, active: 1 }).mockResolvedValue(idle)

    await waitForEmailQueuesToSettle(appRoot, { pollIntervalMs: 1 })

    expect(probeMock).toHaveBeenCalledTimes(9)
  })

  it('times out instead of accepting delayed jobs as settled', async () => {
    await fs.mkdir(path.join(appRoot, '.mercato/queue'), { recursive: true })
    probeMock.mockResolvedValue({
      queueName: 'events', strategy: 'local', ready: 0, delayedFuture: 1, active: 0, error: false,
    })

    await expect(waitForEmailQueuesToSettle(appRoot, { timeoutMs: 0 })).rejects.toThrow(/Timed out/)
  })
})
