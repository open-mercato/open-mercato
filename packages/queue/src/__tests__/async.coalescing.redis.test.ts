import crypto from 'node:crypto'

import { createQueue } from '../factory'

/**
 * The async strategy translates `coalesce` into BullMQ deduplication, and the rest of the suite
 * proves that translation with a mocked BullMQ: the right options reach `queue.add`. What it cannot
 * prove is the half the guarantee actually rests on — that BullMQ *coalesces* the burst and then
 * runs the job once more with the last payload. `bullmq-deduplication-option.test.ts` guards the
 * option's name and the shape of its Lua, but a semantic change behind an unchanged name would slip
 * past it.
 *
 * This suite closes that gap against a real server. It is opt-in because nothing else in the repo
 * requires one — `bullmq` is an optional peer dependency and the Playwright lane runs
 * `QUEUE_STRATEGY=local` — so it skips unless a throwaway Redis is pointed at explicitly:
 *
 *   docker run -d --rm --name om-queue-test-redis -p 6579:6379 redis:7-alpine
 *   QUEUE_TEST_REDIS_URL=redis://127.0.0.1:6579/0 yarn workspace @open-mercato/queue test:redis
 *
 * Point it at a disposable instance: the suite obliterates the queues it creates.
 *
 * CI supplies the URL on the `test` job, so this runs there as part of the ordinary queue suite.
 *
 * **Everything here waits on a barrier, never on a duration.** The first handler blocks on a promise
 * the test resolves, so "the burst lands while a job is running" is a fact the test establishes
 * rather than a race it hopes to win, and the assertions wait for an observed count rather than for
 * a settle timeout. Wall-clock margins would make this flaky, and the `test` job it runs on gates
 * every PR in the repository — a timing race here would be charged to the monorepo test run and read
 * as an unrelated failure.
 */
const redisUrl = process.env.QUEUE_TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

/** Fails loudly rather than hanging until Jest's own timeout, which reports no useful state. */
async function waitUntil(
  condition: () => boolean,
  describeExpected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`[internal] Timed out after ${timeoutMs}ms waiting for ${describeExpected}`)
    }
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
}

function createGate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void
  const wait = new Promise<void>((resolve) => { open = resolve })
  return { wait, open }
}

describeWithRedis('Queue - async strategy coalescing (real BullMQ)', () => {
  const BURST_SIZE = 10

  let queueName: string
  let previousRedisUrl: string | undefined

  beforeAll(() => {
    // Jest workers run test files one after another in a single process, so an unrestored
    // env var here becomes a sibling suite's surprise.
    previousRedisUrl = process.env.REDIS_URL
    process.env.REDIS_URL = redisUrl
  })

  afterAll(() => {
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previousRedisUrl
  })

  beforeEach(() => {
    // Unique per test so a leftover job from a previous run cannot bleed into this one.
    queueName = `queue-coalesce-test-${crypto.randomUUID()}`
  })

  /**
   * Reports one payload per run while a burst of enqueues lands on a single key, every one of them
   * arriving after the consumer has demonstrably started work on the first.
   *
   * The first handler parks on a gate the caller opens only once the whole burst has been accepted
   * by Redis, so "these enqueues arrived mid-run" is established, not timed. `expectedRuns` is what
   * the caller waits for before the gate closes the test out.
   */
  async function runBurst({
    coalesced,
    viaQueueResolver = false,
    expectedRuns,
  }: {
    coalesced: boolean
    viaQueueResolver?: boolean
    expectedRuns: number
  }): Promise<number[]> {
    const consumer = createQueue<{ revision: number }>(queueName, 'async', { concurrency: 1 })
    const producer = createQueue<{ revision: number }>(queueName, 'async', {
      ...(viaQueueResolver ? { coalesceBy: () => 'order-totals:42' } : {}),
    })
    const runs: number[] = []
    const firstRunMayFinish = createGate()

    try {
      await consumer.process(async (job) => {
        runs.push(job.payload.revision)
        if (runs.length === 1) await firstRunMayFinish.wait
      })

      const enqueueOptions = coalesced && !viaQueueResolver
        ? { coalesce: { key: 'order-totals:42' } }
        : undefined

      await producer.enqueue({ revision: 1 }, enqueueOptions)
      // Nothing below may run before the consumer is inside the handler: the entire point is that
      // revisions 2..10 arrive while a job for the key is *active*, which is the only state
      // `keepLastIfActive` behaves differently in.
      await waitUntil(() => runs.length >= 1, 'the first job to enter its handler')

      for (let revision = 2; revision <= BURST_SIZE; revision++) {
        await producer.enqueue({ revision }, enqueueOptions)
      }

      firstRunMayFinish.open()
      await waitUntil(
        () => runs.length >= expectedRuns,
        `${expectedRuns} run(s); saw ${JSON.stringify(runs)}`,
      )
      // A run beyond the expected count would arrive after this point, so give the worker a moment
      // to produce one and fail the assertion rather than pass on a snapshot taken too early.
      await new Promise((resolve) => { setTimeout(resolve, 500) })
      return runs
    } finally {
      firstRunMayFinish.open()
      await consumer.close()
      await producer.clear()
      await producer.close()
    }
  }

  // The guarantee the feature exists for: the run that is already in flight read its input before
  // revisions 2..10 arrived, so exactly one more run has to happen, and it has to see revision 10.
  it('collapses a burst into one run and then one more carrying the last payload', async () => {
    expect(await runBurst({ coalesced: true, expectedRuns: 2 })).toEqual([1, 10])
  }, 60_000)

  // Same guarantee when the key comes from the queue rather than the call site — the path that
  // exists so no call site can forget it.
  it('collapses the same burst when the key comes from a queue-level coalesceBy', async () => {
    expect(await runBurst({ coalesced: true, viaQueueResolver: true, expectedRuns: 2 })).toEqual([1, 10])
  }, 60_000)

  // The same burst uncoalesced, which is what the feature is measured against: ten triggers, ten
  // runs, nine of them computing state that was obsolete before it was written.
  it('runs every enqueue when no coalesce key is supplied', async () => {
    expect(await runBurst({ coalesced: false, expectedRuns: BURST_SIZE })).toHaveLength(BURST_SIZE)
  }, 60_000)
})
