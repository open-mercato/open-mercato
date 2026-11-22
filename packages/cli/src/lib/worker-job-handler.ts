import type { JobContext, JobHandler } from '@open-mercato/queue'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import {
  inferModuleIdFromResourceId,
  withModuleResourceUsage,
} from '@open-mercato/shared/lib/modules/resource-usage'
import { bindRequestScopeContainer, runInOwnedRequestScope, runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'

export type WorkerJobContainer = {
  resolve: <T = unknown>(name: string) => T
  /**
   * #8268 review Major 1 (re-review): optional — the factory's real container,
   * when it has one, so a worker that needs `.register()` (several command
   * phases override the trusted `auth` scope for nested resolution, e.g. before
   * resolving `promotionsService`) can use the SAME container a module's
   * `register(container)` call closed over, rather than a `{ resolve }`-only
   * shim whose overrides are invisible to an already-constructed dependent
   * service holding its own reference to the original container.
   */
  register?: (registrations: Record<string, unknown>) => void
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
  return (job, ctx: JobContext) => runInOwnedRequestScope(async (): Promise<void> => {
    const container = await createContainer()
    bindRequestScopeContainer(container)
    try {
      for (const worker of workers) {
        await withModuleResourceUsage(
          {
            moduleId: worker.moduleId ?? inferModuleIdFromResourceId(worker.id),
            surface: 'worker',
            operation: worker.id,
            resourceId: worker.id,
          },
          () => runWithRequestScopeContainer(container, () => worker.handler(job, {
            ...ctx,
            resolve: container.resolve.bind(container),
            // See `WorkerJobContainer.register`'s own doc — present only when the
            // factory handed back a real container, never a `{ resolve }`-only one.
            container: typeof container.register === 'function' ? container : undefined,
          })),
        )
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
  })
}
