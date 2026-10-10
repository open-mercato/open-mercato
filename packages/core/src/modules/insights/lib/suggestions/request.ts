import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getProcessRegistry, type ProcessRegistrySnapshot } from '../process/registry'
import { isXrayCursorComplete } from '../projection/completeness'
import { isXrayIngestEnabled } from '../projection/killSwitch'
import { assertXrayScope } from '../projection/payloads'
import { XRAY_FANOUT_MAX_BACKLOG, enqueueXraySuggestionMining, readXraySuggestionsBacklog } from '../projection/queue'
import { createServiceResolver, createXrayDatabase, createXrayStore, type XrayContainer } from '../projection/runtime'
import { loadXraySettings } from '../projection/settings'
import type { ProjectionScope } from '../projection/types'
import { claimSuggestionRequest, clearSuggestionRequest } from './passes'

const logger = createLogger('insights').child({ component: 'xray-suggestion-request' })

/**
 * Outcome of an on-demand mining request: `enqueued` (a forced job was enqueued), `pending` (an
 * earlier request's job is still waiting or running, so none was added) or why nothing was enqueued.
 */
export type XraySuggestionMiningRequestResult = {
  status: 'enqueued' | 'pending' | 'no_processes' | 'disabled' | 'projection_incomplete' | 'busy'
}

/**
 * Requests an on-demand (forced) automation suggestion mining pass of an organization. Refuses an
 * organization of another tenant, then answers without enqueueing when no process is declared, the
 * organization's settings or the tenant kill switch disable X-Ray (`disabled`), its projection is
 * incomplete (`projection_incomplete`, the same `isXrayCursorComplete` check as the job) or the
 * mining queue holds `XRAY_FANOUT_MAX_BACKLOG` waiting jobs (`busy`). Otherwise claims the
 * organization's request marker atomically and enqueues one forced job; while that request is
 * pending (until its job clears it, at most `XRAY_SUGGESTION_REQUEST_TTL_MS`) further requests
 * enqueue nothing (`pending`). A failed enqueue releases the claim and is rethrown.
 */
export async function requestXraySuggestionMining(
  container: XrayContainer,
  scope: ProjectionScope,
  options: { registry?: ProcessRegistrySnapshot } = {},
): Promise<XraySuggestionMiningRequestResult> {
  const registry = options.registry ?? getProcessRegistry()
  const em = (container.resolve('em') as EntityManager).fork()
  await assertXrayScope(em, scope)
  if (!registry.ready || registry.processes.length === 0) return { status: 'no_processes' }
  const settings = await loadXraySettings(em, scope)
  if (!settings.enabled || !(await isXrayIngestEnabled(createServiceResolver(container), scope.tenantId))) return { status: 'disabled' }
  const cursor = await createXrayStore(em).readCursor(scope)
  if (!isXrayCursorComplete(cursor)) return { status: 'projection_incomplete' }
  const backlog = await readXraySuggestionsBacklog()
  if (backlog !== null && backlog >= XRAY_FANOUT_MAX_BACKLOG) return { status: 'busy' }
  const db = createXrayDatabase(em)
  const requestedAt = await claimSuggestionRequest(db, scope)
  if (requestedAt === null) return { status: 'pending' }
  try {
    await enqueueXraySuggestionMining(scope, { force: true })
  } catch (error) {
    try {
      await clearSuggestionRequest(db, scope, requestedAt)
    } catch (releaseError) {
      logger.warn('[internal] Could not release the on-demand X-Ray suggestion mining request after a failed enqueue', {
        organizationId: scope.organizationId,
        err: releaseError,
      })
      getTelemetryRuntime()?.reportError(releaseError, { module: 'insights', code: 'insights.xray_suggestion_request_clear_failed' })
    }
    throw error
  }
  return { status: 'enqueued' }
}
