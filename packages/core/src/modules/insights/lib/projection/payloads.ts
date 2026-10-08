import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type { XrayBackfillJobPayload, XrayIngestJobPayload } from './queue'
import type { ProjectionScope } from './types'

/**
 * Scope of an ingest tick. The scheduler spreads the configured `targetPayload` and adds
 * `tenantId` / `organizationId` at the top level, so both shapes are read (nested wins). A
 * missing or malformed scope is refused rather than widened.
 */
export function readIngestScope(payload: XrayIngestJobPayload | null | undefined): ProjectionScope | null {
  const tenantId = payload?.scope?.tenantId ?? payload?.tenantId
  const organizationId = payload?.scope?.organizationId ?? payload?.organizationId
  if (!isUuid(tenantId) || !isUuid(organizationId)) return null
  return { tenantId: tenantId.toLowerCase(), organizationId: organizationId.toLowerCase() }
}

export function readBackfillPayload(payload: unknown): XrayBackfillJobPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Partial<XrayBackfillJobPayload>
  const scope = candidate.scope
  if (!scope || !isUuid(scope.tenantId) || !isUuid(scope.organizationId)) return null
  if (!isUuid(candidate.scanId) || !isUuid(candidate.chainId)) return null
  const progressJobId = isUuid(candidate.progressJobId) ? candidate.progressJobId : null
  const userId = isUuid(scope.userId) ? scope.userId : null
  return {
    scope: { tenantId: scope.tenantId.toLowerCase(), organizationId: scope.organizationId.toLowerCase(), userId },
    scanId: candidate.scanId,
    chainId: candidate.chainId,
    progressJobId,
  }
}
