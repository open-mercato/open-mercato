import type { JobContext, JobHandler } from '@open-mercato/queue'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'

export type WorkerJobContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type WorkerJobContainerFactory = () => Promise<WorkerJobContainer>

type ClearableEntityManager = {
  clear?: () => void
}

/**
 * Builds a queue job handler that isolates every job in its own request
 * container, instead of sharing a single process-wide `EntityManager` fork
 * across all concurrent jobs.
 *
 * Under the async (BullMQ) strategy jobs run with real concurrency, so a
 * shared EM would interleave unit-of-work flushes between unrelated jobs and
 * never release its identity map. Creating one container per job removes both
 * the cross-job flush race and the unbounded identity-map growth, while
 * keeping the `ctx.resolve` contract and DI keys unchanged. See issue #2970.
 */
export function createPerJobWorkerHandler(
  workers: ModuleWorker[],
  createContainer: WorkerJobContainerFactory,
): JobHandler {
  return async (job, ctx: JobContext) => {
    const container = await createContainer()
    try {
      for (const worker of workers) {
        await worker.handler(job, { ...ctx, resolve: container.resolve.bind(container) })
      }
    } finally {
      try {
        const em = container.resolve('em') as ClearableEntityManager | null
        em?.clear?.()
      } catch {
        // Best-effort: clearing the identity map is a memory optimization and
        // must never mask a job's own outcome.
      }
    }
  }
}
