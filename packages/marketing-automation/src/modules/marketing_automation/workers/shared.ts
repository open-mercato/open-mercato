import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { DispatchDeps } from '../lib/dispatcher.js'
import { enqueueResume } from '../lib/queue.js'

export const logger = createLogger('marketing_automation')

export type ResolverContainer = { resolve: <T = unknown>(name: string) => T }
export type HandlerContext = JobContext & ResolverContainer & { container?: ResolverContainer }

export type JobScope = { tenantId: string; organizationId: string }

export function readScope(payload: { scope?: { tenantId?: unknown; organizationId?: unknown } }): JobScope | null {
  const tenantId = typeof payload.scope?.tenantId === 'string' ? payload.scope.tenantId.trim() : ''
  const organizationId = typeof payload.scope?.organizationId === 'string' ? payload.scope.organizationId.trim() : ''
  if (!tenantId || !organizationId) return null
  return { tenantId, organizationId }
}

export function buildDispatchDeps(ctx: HandlerContext, scope: JobScope): DispatchDeps {
  const container = (ctx.container ?? { resolve: ctx.resolve }) as unknown as AwilixContainer
  return {
    em: ctx.resolve<EntityManager>('em'),
    container,
    logger,
    now: new Date(),
    /**
     * Read again at every per-subject boundary rather than frozen here.
     *
     * A sweep tick executes up to `MAX_ROWS_PER_TICK` candidates inline, so a single `Date` taken
     * when the job started is older than the claim lease long before the tick ends.
     */
    clock: () => new Date(),
    scope,
    // The delayed job is the fast path; the due-run scan is the safety net. Injected so the
    // engine never imports the queue and stays unit-testable.
    enqueueResume: (runId, delayMs) => enqueueResume(runId, scope, delayMs),
  }
}
