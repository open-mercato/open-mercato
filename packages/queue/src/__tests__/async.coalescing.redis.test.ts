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
 */
const redisUrl = process.env.QUEUE_TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Queue - async strategy coalescing (real BullMQ)', () => {
  const HANDLER_MS = 300
  const SETTLE_MS = 2500

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
   * Reports one payload per run while a burst of enqueues lands on a single key, the first of them
   * arriving after the consumer has already started work.
   */
  async function runBurst(coalesced: boolean, viaQueueResolver = false): Promise<number[]> {
    const consumer = createQueue<{ score: number }>(queueName, 'async', { concurrency: 1 })
    const producer = createQueue<{ score: number }>(queueName, 'async', {
      ...(viaQueueResolver ? { coalesceBy: () => 'stage-standings:42' } : {}),
    })
    const runs: number[] = []

    try {
      await consumer.process(async (job) => {
        runs.push(job.payload.score)
        await new Promise((resolve) => { setTimeout(resolve, HANDLER_MS) })
      })

      for (let score = 1; score <= 10; score++) {
        await producer.enqueue(
          { score },
          coalesced && !viaQueueResolver ? { coalesce: { key: 'stage-standings:42' } } : undefined,
        )
        await new Promise((resolve) => { setTimeout(resolve, 30) })
      }

      await new Promise((resolve) => { setTimeout(resolve, SETTLE_MS) })
      return runs
    } finally {
      await consumer.close()
      await producer.clear()
      await producer.close()
    }
  }

  // The guarantee the feature exists for: the run that is already in flight read its input before
  // scores 2..10 arrived, so exactly one more run has to happen, and it has to see score 10.
  it('collapses a burst into one run and then one more carrying the last payload', async () => {
    expect(await runBurst(true)).toEqual([1, 10])
  }, 30_000)

  // Same guarantee when the key comes from the queue rather than the call site — the path that
  // exists so no call site can forget it.
  it('collapses the same burst when the key comes from a queue-level coalesceBy', async () => {
    expect(await runBurst(true, true)).toEqual([1, 10])
  }, 30_000)

  // The same burst uncoalesced, which is what the feature is measured against: ten triggers, ten
  // runs, nine of them computing state that was obsolete before it was written.
  it('runs every enqueue when no coalesce key is supplied', async () => {
    expect(await runBurst(false)).toHaveLength(10)
  }, 30_000)
})
