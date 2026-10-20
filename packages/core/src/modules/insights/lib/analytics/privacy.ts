import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AnalyticsIndividualsDeniedError, type IndividualsDeniedReason } from './errors'
import type { AnalyticsViewer, ResolvedWindowView, ScopeSettings } from './types'

const logger = createLogger('insights').child({ component: 'xray-privacy' })

export const XRAY_INDIVIDUALS_RESOURCE_KIND = 'insights.xray.individuals'

export const XRAY_INDIVIDUALS_ACCESS_TYPE = 'read'

/** One `access_logs` row (the shape `AccessLogService.log` accepts). */
export type XrayAccessLogEntry = {
  tenantId: string
  organizationId: string
  actorUserId: string
  resourceKind: string
  resourceId: string
  accessType: string
  fields: string[]
  context: Record<string, unknown>
}

/** The audit module's `accessLogService`, resolved softly; `log` resolves to the row or null. */
export type AccessLogWriter = {
  log: (entry: XrayAccessLogEntry) => Promise<unknown>
}

export function isAccessLogWriter(value: unknown): value is AccessLogWriter {
  return Boolean(value) && typeof value === 'object' && typeof (value as { log?: unknown }).log === 'function'
}

export type IndividualsGateDecision =
  | { allowed: true }
  | { allowed: false; reason: IndividualsDeniedReason }

/**
 * The per-person gate (X8): the viewer holds `insights.xray.view_individuals` (resolved by the
 * caller through RBAC, wildcard-aware), is a known user, and every organization in scope has
 * `individualsEnabled` on. k-anonymity is applied to the result cells afterwards.
 */
export function checkIndividualsGate(viewer: AnalyticsViewer, settings: ScopeSettings): IndividualsGateDecision {
  if (!viewer.canViewIndividuals) return { allowed: false, reason: 'feature_missing' }
  if (!viewer.userId) return { allowed: false, reason: 'viewer_unknown' }
  if (settings.organizationIds.length === 0) return { allowed: false, reason: 'no_organization' }
  if (!settings.individualsEnabled) return { allowed: false, reason: 'setting_disabled' }
  return { allowed: true }
}

export function assertIndividualsAllowed(viewer: AnalyticsViewer, settings: ScopeSettings): void {
  const decision = checkIndividualsGate(viewer, settings)
  if (!decision.allowed) throw new AnalyticsIndividualsDeniedError(decision.reason)
}

/**
 * Writes one `access_logs` row per organization for a per-person read, before any per-person
 * data is returned. Fails closed: no writer, a writer that throws or one that reports no row
 * written denies the read (`AnalyticsIndividualsDeniedError`).
 */
export async function recordIndividualsAccess(
  writer: AccessLogWriter | null,
  input: {
    tenantId: string
    organizationIds: readonly string[]
    viewer: AnalyticsViewer
    processKey: string
    purpose: string
    window: ResolvedWindowView
  },
): Promise<void> {
  if (!writer) throw new AnalyticsIndividualsDeniedError('access_log_unavailable')
  const actorUserId = input.viewer.userId
  if (!actorUserId) throw new AnalyticsIndividualsDeniedError('viewer_unknown')
  if (input.organizationIds.length === 0) throw new AnalyticsIndividualsDeniedError('no_organization')
  for (const organizationId of input.organizationIds) {
    let written: unknown
    try {
      written = await writer.log({
        tenantId: input.tenantId,
        organizationId,
        actorUserId,
        resourceKind: XRAY_INDIVIDUALS_RESOURCE_KIND,
        resourceId: input.processKey,
        accessType: XRAY_INDIVIDUALS_ACCESS_TYPE,
        fields: ['actor_pseudonym'],
        context: { purpose: input.purpose, window: input.window },
      })
    } catch (error) {
      logger.error('[internal] Could not write the X-Ray per-person access log', { tenantId: input.tenantId, organizationId, err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_access_log_failed' })
      throw new AnalyticsIndividualsDeniedError('access_log_failed')
    }
    if (written === null || written === undefined || written === false) {
      logger.error('[internal] The X-Ray per-person access log reported no row written', { tenantId: input.tenantId, organizationId })
      throw new AnalyticsIndividualsDeniedError('access_log_failed')
    }
  }
}
