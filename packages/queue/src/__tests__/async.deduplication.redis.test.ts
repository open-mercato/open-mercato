import crypto from 'node:crypto'

import { createQueue } from '../factory'

/**
 * The async strategy's deduplication support is a pass-through, so the rest of the suite proves it
 * with a mocked BullMQ: the options reach `queue.add` untouched. What that cannot prove is the half
 * the guarantee actually rests on — that BullMQ *coalesces* the burst and then runs the job once
 * more with the last payload. `bullmq-deduplication-option.test.ts` guards the option's name and the
 * shape of its Lua, but a semantic change behind an unchanged name would slip past it.
 *
 * This suite closes that gap against a real server. It is opt-in because nothing else in the repo
 * requires one — `bullmq` is an optional peer dependency and the Playwright lane runs
 * `QUEUE_STRATEGY=local` — so it skips unless a throwaway Redis is pointed at explicitly:
 *
 *   docker run -d --rm --name om-queue-test-redis -p 6579:6379 redis:7-alpine
 *   QUEUE_TEST_REDIS_URL=redis://127.0.0.1:6579/0 yarn workspace @open-mercato/queue test redis
 *
 * Point it at a disposable instance: the suite obliterates the queues it creates.
 */
const redisUrl = process.env.QUEUE_TEST_REDIS_URL
const describeWithRedis = redisUrl ? describe : describe.skip

describeWithRedis('Queue - async strategy deduplication (real BullMQ)', () => {
  const HANDLER_MS = 300
  const SETTLE_MS = 2500

  let queueName: string

  beforeAll(() => {
    process.env.REDIS_URL = redisUrl
  })

  beforeEach(() => {
    // Unique per test so a leftover job from a previous run cannot bleed into this one.
    queueName = `queue-dedupe-test-${crypto.randomUUID()}`
  })

  /**
   * Reports one payload per run while a burst of enqueues lands on a single key, the first of them
   * arriving after the consumer has already started work.
   */
  async function runBurst(keepLastIfActive: boolean): Promise<number[]> {
    const consumer = createQueue<{ score: number }>(queueName, 'async', { concurrency: 1 })
    const producer = createQueue<{ score: number }>(queueName, 'async')
    const runs: number[] = []

    try {
      await consumer.process(async (job) => {
        runs.push(job.payload.score)
        await new Promise((resolve) => { setTimeout(resolve, HANDLER_MS) })
      })

      for (let score = 1; score <= 10; score++) {
        await producer.enqueue({ score }, {
          deduplication: { id: 'stage-standings:42', ...(keepLastIfActive ? { keepLastIfActive } : {}) },
        })
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
  it('coalesces a burst into one run and then one more carrying the last payload', async () => {
    expect(await runBurst(true)).toEqual([1, 10])
  }, 30_000)

  // The same burst without `keepLastIfActive`, which is why recompute jobs must not omit it: every
  // score after the first is dropped and nothing re-runs, so the result reflects score 1 forever.
  it('drops everything that arrives mid-run when keepLastIfActive is omitted', async () => {
    expect(await runBurst(false)).toEqual([1])
  }, 30_000)
})
