/**
 * Queue Status Dashboard (#3105) — async-strategy introspection against a stateful in-memory
 * BullMQ stand-in, so jobs come from the REAL `enqueue()` path and are completed/failed through
 * the REAL worker listeners (type stamping, payload scrubbing, state resolution, ordering).
 */
import { createQueue } from '../factory'
import { COMPLETED_RETENTION_COUNT } from '../strategies/async'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'

type FakeJobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

type FakeJob = {
  id: string
  name: string
  data: { id: string; payload: unknown; createdAt: string; metadata?: Record<string, unknown> }
  opts: { removeOnComplete?: boolean | { count: number }; delay?: number }
  state: FakeJobState
  timestamp: number
  processedOn?: number
  finishedOn?: number
  failedReason?: string
  attemptsMade: number
  seq: number
}

const fake = {
  jobs: [] as FakeJob[],
  clock: 1_700_000_000_000,
  seq: 0,
  getJobsCalls: [] as Array<{ types: string[]; start?: number; end?: number; asc?: boolean }>,
  processor: null as null | ((job: { id?: string; data: unknown; attemptsMade: number }) => Promise<void>),
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
  addOpts: [] as unknown[],
}

function tick(): number {
  fake.clock += 10
  return fake.clock
}

function toBullJob(job: FakeJob) {
  return {
    get id() { return job.id },
    get name() { return job.name },
    get data() { return job.data },
    get timestamp() { return job.timestamp },
    get processedOn() { return job.processedOn },
    get finishedOn() { return job.finishedOn },
    get failedReason() { return job.failedReason },
    get attemptsMade() { return job.attemptsMade },
    remove: async () => { fake.jobs = fake.jobs.filter((candidate) => candidate !== job) },
    updateData: async (data: FakeJob['data']) => { job.data = data },
    getState: async () => job.state,
  }
}

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
}))

jest.mock('bullmq', () => {
  class MockQueue {
    async add(name: string, data: FakeJob['data'], opts: FakeJob['opts'] = {}) {
      fake.addOpts.push(opts)
      const id = String(++fake.seq)
      fake.jobs.push({
        id,
        name,
        data,
        opts,
        state: opts.delay ? 'delayed' : 'waiting',
        timestamp: tick(),
        attemptsMade: 0,
        seq: fake.seq,
      })
      return { id }
    }
    async close() {}
    async obliterate() {}
    async getJobCounts() { return {} }
    async getJob(id: string) {
      const job = fake.jobs.find((candidate) => candidate.id === id)
      return job ? toBullJob(job) : undefined
    }
    /**
     * Mirrors the BullMQ ordering contract the dashboard depends on: per state the DEFAULT order is
     * newest-first, `asc` flips it to oldest-first, states are concatenated in the requested order,
     * and `end = -1` means "everything".
     */
    async getJobs(types: string[], start = 0, end = -1, asc = false) {
      fake.getJobsCalls.push({ types, start, end, asc })
      const out: ReturnType<typeof toBullJob>[] = []
      for (const type of types) {
        const inState = fake.jobs
          .filter((job) => job.state === type)
          .sort((a, b) => {
            const key = (job: FakeJob) => (type === 'failed' || type === 'completed' ? (job.finishedOn ?? 0) : job.seq)
            return asc ? key(a) - key(b) : key(b) - key(a)
          })
        const sliced = end === -1 ? inState.slice(start) : inState.slice(start, end + 1)
        out.push(...sliced.map(toBullJob))
      }
      return out
    }
  }

  class MockWorker {
    constructor(_name: string, processor: NonNullable<typeof fake.processor>) {
      fake.processor = processor
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      fake.listeners.set(event, [...(fake.listeners.get(event) ?? []), handler])
    }
    async close() {}
  }

  return { Queue: MockQueue, Worker: MockWorker }
})

function emit(event: string, ...args: unknown[]) {
  for (const handler of fake.listeners.get(event) ?? []) handler(...args)
}

/** Runs the oldest waiting job through the real processor + listeners, like a BullMQ worker would. */
async function runNext(outcome: 'complete' | { fail: string } = 'complete'): Promise<FakeJob> {
  const job = fake.jobs.filter((candidate) => candidate.state === 'waiting').sort((a, b) => a.seq - b.seq)[0]
  if (!job) throw new Error('no waiting job to run')
  job.state = 'active'
  job.processedOn = tick()
  job.attemptsMade += 0
  try {
    if (outcome !== 'complete') throw new Error(outcome.fail)
    await fake.processor!({ id: job.id, data: job.data, attemptsMade: job.attemptsMade })
    job.state = 'completed'
    job.finishedOn = tick()
    const retention = job.opts.removeOnComplete
    if (retention === true) {
      fake.jobs = fake.jobs.filter((candidate) => candidate !== job)
    } else if (retention && typeof retention === 'object') {
      const completed = fake.jobs
        .filter((candidate) => candidate.state === 'completed')
        .sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0))
      for (const evicted of completed.slice(retention.count)) {
        fake.jobs = fake.jobs.filter((candidate) => candidate !== evicted)
      }
    }
    emit('completed', toBullJob(job))
  } catch (error) {
    job.state = 'failed'
    job.finishedOn = tick()
    job.failedReason = (error as Error).message
    job.attemptsMade += 1
    emit('failed', toBullJob(job), error)
  }
  // Let the fire-and-forget payload scrub settle.
  await new Promise((resolve) => setImmediate(resolve))
  return job
}

type Payload = { tenantId?: string; organizationId?: string | null; jobType?: string; secret?: string; note?: string }

describe('Queue - async strategy - introspection against enqueue/complete/fail flow (#3105)', () => {
  const getRedisUrlOrThrowMock = getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>

  beforeEach(() => {
    fake.jobs = []
    fake.clock = 1_700_000_000_000
    fake.seq = 0
    fake.getJobsCalls = []
    fake.processor = null
    fake.listeners = new Map()
    fake.addOpts = []
    getRedisUrlOrThrowMock.mockReturnValue('redis://localhost:6379')
    jest.spyOn(Date, 'now').mockImplementation(() => fake.clock)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('stamps the payload-free job type at enqueue and keeps bounded completed retention', async () => {
    const queue = createQueue<Payload>('q', 'async')

    await queue.enqueue({ tenantId: 't1', jobType: 'batch-index', secret: 's' })
    await queue.enqueue({ tenantId: 't1' }, { jobType: 'explicit' })
    await queue.enqueue({ tenantId: 't1' })

    expect(fake.jobs.map((job) => job.data.metadata?.jobType)).toEqual(['batch-index', 'explicit', undefined])
    // The BullMQ job name stays the job id — it must never be what the dashboard reads as a type.
    expect(fake.jobs.every((job) => job.name === job.data.id)).toBe(true)
    expect(fake.addOpts[0]).toMatchObject({ removeOnComplete: { count: COMPLETED_RETENTION_COUNT }, removeOnFail: 1000 })
  })

  it('applies the type filter to failed, in-flight and recent reads for jobs created by enqueue()', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ tenantId: 't1', jobType: 'index' })
    await queue.enqueue({ tenantId: 't1', jobType: 'purge' })
    await queue.enqueue({ tenantId: 't1', jobType: 'purge' })
    await runNext({ fail: 'boom' }) // index fails
    await runNext({ fail: 'boom' }) // purge fails

    const waiting = await queue.getInFlightJobsSummary!({ state: 'waiting', type: 'purge', limit: 10 })
    const failedAll = await queue.getFailedJobsSummary!(10)
    const failedPurge = await queue.getFailedJobsSummary!(10, 0, { type: 'purge' })
    const recent = await queue.getRecentJobs!({ type: 'index', limit: 10 })

    expect(waiting.map((job) => job.type)).toEqual(['purge'])
    expect(failedAll.map((job) => job.type).sort()).toEqual(['index', 'purge'])
    expect(failedPurge.map((job) => job.type)).toEqual(['purge'])
    expect(recent.map((job) => [job.type, job.state])).toEqual([['index', 'failed']])
  })

  it('Tier 1 failed summary exposes only a safe error code, never the raw failure text', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ tenantId: 't1' })
    await queue.enqueue({ tenantId: 't1' })
    await runNext({ fail: 'insert failed for password=hunter2 on tenant acme-corp postgres://u:p@db/x' })
    await runNext({ fail: 'job stalled more than allowable limit' })

    const summary = await queue.getFailedJobsSummary!(10)

    expect(summary.map((job) => job.errorCode).sort()).toEqual(['queue.handler_error', 'queue.job_stalled'])
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('acme-corp')
    expect(serialized).not.toContain('postgres://')
    for (const job of summary) expect(job).not.toHaveProperty('failedReason')
  })

  it('records processing metrics for jobs that complete after a real enqueue (not removed on complete)', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ tenantId: 't1', secret: 'top-secret', note: 'customer data' })
    await queue.enqueue({ tenantId: 't1' })
    const first = await runNext()
    const second = await runNext()

    const stats = await queue.getProcessingStats!()

    expect(stats.sampleSize).toBe(2)
    expect(stats.lastCompletedAt).toBe(second.finishedOn)
    expect(stats.lastProcessingMs).toBe((second.finishedOn as number) - (second.processedOn as number))
    expect(stats.avgProcessingMs).toBeGreaterThan(0)
    expect(stats.p95ProcessingMs).toBeGreaterThan(0)
    expect(stats.avgWaitMs).toBeGreaterThan(0)
    expect(first.state).toBe('completed')
  })

  it('reduces a retained completed job payload to ownership + type', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ tenantId: 't1', organizationId: 'o1', jobType: 'index', secret: 'top-secret', note: 'customer data' })
    const job = await runNext()

    expect(job.data.payload).toEqual({ tenantId: 't1', organizationId: 'o1', jobType: 'index' })
    const [recent] = await queue.getRecentJobs!({ state: 'completed', limit: 5 })
    expect(JSON.stringify(recent)).not.toContain('top-secret')
    expect(recent.type).toBe('index')
  })

  it('keeps nested producer scope on a retained completed job so it stays tenant-attributable', async () => {
    const queue = createQueue<{ scope: { tenantId: string; organizationId: string | null }; raw: string }>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ scope: { tenantId: 't1', organizationId: null }, raw: 'message body' })
    const job = await runNext()

    expect(job.data.payload).toEqual({ scope: { tenantId: 't1', organizationId: null } })
  })

  it('returns the OLDEST queued jobs when the backlog exceeds the window', async () => {
    const queue = createQueue<Payload>('q', 'async')
    for (let index = 1; index <= 30; index++) await queue.enqueue({ tenantId: 't1', note: `n${index}` })

    const aged = await queue.getInFlightJobsSummary!({ state: 'waiting', limit: 20 })

    expect(aged.map((job) => job.id)).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)))
    expect(fake.getJobsCalls.at(-1)).toMatchObject({ types: ['waiting'], start: 0, end: 19, asc: true })
    expect(aged[0].ageMs).toBeGreaterThan(aged[19].ageMs as number)
  })

  describe('zero / negative windows never reach BullMQ (range 0..-1 means "everything")', () => {
    it.each([0, -1, -50])('returns an empty result for a window of %d on every method', async (window) => {
      const queue = createQueue<Payload>('q', 'async')
      await queue.enqueue({ tenantId: 't1' })

      await expect(queue.getFailedJobsSummary!(window)).resolves.toEqual([])
      await expect(queue.getInFlightJobsSummary!({ state: 'waiting', limit: window })).resolves.toEqual([])
      await expect(queue.getRecentJobs!({ limit: window })).resolves.toEqual([])
      await expect(queue.getProcessingStats!({ sampleSize: window })).resolves.toMatchObject({ sampleSize: 0 })

      expect(fake.getJobsCalls).toHaveLength(0)
    })

    it('validates offsets: negative / fractional / huge offsets are bounded', async () => {
      const queue = createQueue<Payload>('q', 'async')
      await queue.getFailedJobsSummary!(5, -10)
      await queue.getFailedJobsSummary!(5, Number.POSITIVE_INFINITY)
      await queue.getFailedJobsSummary!(5, 1e9)

      expect(fake.getJobsCalls.map((call) => call.start)).toEqual([0, 0, 1000])
      expect(fake.getJobsCalls.every((call) => (call.end ?? -1) >= 0)).toBe(true)
    })
  })

  it('merges states by recency before the global limit, preserving each job state', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    for (let index = 1; index <= 5; index++) await queue.enqueue({ tenantId: 't1', note: `w${index}` })
    await runNext({ fail: 'boom' }) // job 1 fails — newest activity
    await runNext({ fail: 'boom' }) // job 2 fails — newest activity

    const recent = await queue.getRecentJobs!({ limit: 3 })

    // Waiting jobs 3..5 are older than the failures' finishedOn; a state-concatenated slice would
    // have filled the whole window with waiting jobs and dropped the failures.
    expect(recent.map((job) => [job.id, job.state])).toEqual([
      ['2', 'failed'],
      ['1', 'failed'],
      ['5', 'waiting'],
    ])
  })

  it('resolves the actual state for a direct id and does not trust the caller state', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ tenantId: 't1' })
    await queue.enqueue({ tenantId: 't1' })
    await runNext({ fail: 'boom' })

    const [failed] = await queue.getRecentJobs!({ id: '1', limit: 1 })
    const [waiting] = await queue.getRecentJobs!({ id: '2', state: 'failed', limit: 1 })

    expect(failed.state).toBe('failed')
    expect(waiting.state).toBe('waiting')
  })

  it('keeps the raw failure text (truncated) only on the Tier 2 read', async () => {
    const queue = createQueue<Payload>('q', 'async')
    await queue.process(async () => {})
    await queue.enqueue({ tenantId: 't1' })
    await runNext({ fail: 'x'.repeat(900) })

    const [job] = await queue.getRecentJobs!({ state: 'failed', limit: 1 })

    expect(job.failedReason).toHaveLength(500)
  })
})
