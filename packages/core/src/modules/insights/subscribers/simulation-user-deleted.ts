import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { deleteSimulationRunsOfUser, eraseSimulationDecider } from '../lib/simulation/store'

const logger = createLogger('insights').child({ component: 'simulation-user-deleted' })

export const metadata = {
  event: 'auth.user.deleted',
  persistent: true,
  id: 'insights:simulation-user-deleted',
}

type UserDeletedPayload = {
  id?: unknown
  userId?: unknown
  tenantId?: unknown
}

type SubscriberContext = {
  resolve: <TService = unknown>(name: string) => TService
}

/**
 * GDPR (S18): deletes every simulation run the user requested in the tenant (their progress jobs
 * are cancelled when the run was still active) and rewrites the user's decisions to one fresh
 * random `erased:<uuid>` token. Idempotent; requires the tenant (never an unscoped erasure).
 */
export default async function handler(payload: UserDeletedPayload, ctx: SubscriberContext): Promise<void> {
  const userId = isUuid(payload?.id) ? payload.id : isUuid(payload?.userId) ? payload.userId : null
  const tenantId = isUuid(payload?.tenantId) ? payload.tenantId : null
  if (!userId || !tenantId) return
  const em = ctx.resolve<EntityManager>('em')
  const normalizedTenantId = tenantId.toLowerCase()
  const normalizedUserId = userId.toLowerCase()
  const runs = await deleteSimulationRunsOfUser(em, normalizedTenantId, normalizedUserId)
  const decisions = await eraseSimulationDecider(em, normalizedTenantId, normalizedUserId)
  let progress: ProgressService | null = null
  try {
    progress = ctx.resolve<ProgressService>('progressService')
  } catch {
    progress = null
  }
  for (const job of runs.progressJobIds) {
    if (!progress) break
    try {
      await progress.markCancelled(job.progressJobId, { tenantId: normalizedTenantId, organizationId: job.organizationId, userId: null })
    } catch (error) {
      logger.warn('[internal] Could not cancel the progress job of an erased simulation run', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_erase_progress_failed' })
    }
  }
  if (runs.deleted > 0 || decisions > 0) logger.info('Erased the simulations of a deleted user', { tenantId: normalizedTenantId, runs: runs.deleted, decisions })
}
