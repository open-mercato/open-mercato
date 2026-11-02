import { getRedisUrlOrThrow, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'next-run-sync' })

export const BULLMQ_NEXT_RUN_READ_TIMEOUT_MS = 2000

export type BullmqNextRun = {
  nextRunAt: Date
  pattern?: string
  every?: number
  timezone?: string
}

interface BullJobSchedulerState {
  next?: number | null
  pattern?: string | null
  every?: number | null
  tz?: string | null
}

interface BullNextRunQueue {
  getJobScheduler?(id: string): Promise<BullJobSchedulerState | undefined>
  on(event: 'error', listener: (error: Error) => void): unknown
  close(): Promise<void>
  disconnect(): Promise<void>
}

function toBullmqNextRun(state: BullJobSchedulerState | undefined): BullmqNextRun | null {
  if (!state || typeof state.next !== 'number' || !Number.isFinite(state.next)) return null
  return {
    nextRunAt: new Date(state.next),
    ...(typeof state.pattern === 'string' ? { pattern: state.pattern } : {}),
    ...(typeof state.every === 'number' ? { every: state.every } : {}),
    ...(typeof state.tz === 'string' ? { timezone: state.tz } : {}),
  }
}

async function readAndClose(queue: BullNextRunQueue, scheduleId: string): Promise<BullmqNextRun | null> {
  try {
    if (typeof queue.getJobScheduler !== 'function') return null
    return toBullmqNextRun(await queue.getJobScheduler(`schedule-${scheduleId}`))
  } finally {
    await queue.close().catch((error: unknown) => {
      logger.debug('Failed to close the BullMQ queue after reading the job scheduler', { scheduleId, err: error })
    })
  }
}

/**
 * Reads the instant BullMQ will fire a schedule next, straight from its Job Scheduler.
 *
 * BullMQ moves a scheduler to its following slot before it hands the current
 * slot's job to the processor, so from inside a running execution this is the
 * upcoming fire, not the one being executed.
 *
 * The queue handle is opened and closed per call on purpose. Workers build a
 * fresh DI container for every job and never dispose it, so the DI-registered
 * `BullMQSchedulerService` — which caches its queue on the instance — would
 * leave one Redis connection behind per execution.
 *
 * Open, read and close share one deadline: during a Redis outage commands queue
 * up instead of failing, and a caller awaiting this from a `finally` must not
 * hold its worker slot open. Past the deadline the handle is torn down both
 * ways, because each covers a state the other waits on: `close()` drops a
 * connection that never became ready, `disconnect()` drops one that is ready
 * but not answering. The timeout error carries the last connection error
 * BullMQ emitted as its `cause`; the listener also keeps BullMQ from printing
 * those errors to the console itself. A close that fails after a completed read
 * is only logged, so it can neither discard the value nor replace the read's
 * own error. Returns `null` when the installed BullMQ has no
 * `getJobScheduler`, when the scheduler does not exist, or when it has no next
 * slot.
 */
export async function readBullmqNextRun(
  scheduleId: string,
  timeoutMs: number = BULLMQ_NEXT_RUN_READ_TIMEOUT_MS,
): Promise<BullmqNextRun | null> {
  const { Queue } = await import('bullmq')
  const queue = new Queue('scheduler-execution', {
    connection: parseRedisUrl(getRedisUrlOrThrow('QUEUE')),
  }) as unknown as BullNextRunQueue
  let lastConnectionError: Error | undefined
  queue.on('error', (error) => {
    lastConnectionError = error
  })

  let timer: NodeJS.Timeout | undefined
  let timedOut = false
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error(
        `[internal] Timed out after ${timeoutMs}ms reading the BullMQ job scheduler`,
        lastConnectionError ? { cause: lastConnectionError } : undefined,
      ))
    }, timeoutMs)
  })
  const read = readAndClose(queue, scheduleId)

  try {
    return await Promise.race([read, deadline])
  } catch (error) {
    if (timedOut) {
      queue.close().catch(() => undefined)
      queue.disconnect().catch(() => undefined)
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}
