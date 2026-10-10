import type { EntityManager } from '@mikro-orm/postgresql'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { XRAY_FANOUT_KIND, type XrayBackfillJobPayload, type XrayIngestJobPayload, type XrayRollupJobPayload } from './queue'
import type { ProjectionScope } from './types'

export type XrayIngestPayload =
  | { kind: 'fanout' }
  | { kind: 'organization'; scope: ProjectionScope; legacySchedule: boolean }

export class XrayScopeMismatchError extends Error {
  constructor() {
    super('[internal] The Process X-Ray organization does not belong to the given tenant')
    this.name = 'XrayScopeMismatchError'
  }
}

function readScopePair(source: { tenantId?: unknown; organizationId?: unknown } | null | undefined): ProjectionScope | null {
  if (!source || typeof source !== 'object') return null
  const { tenantId, organizationId } = source
  if (!isUuid(tenantId) || !isUuid(organizationId)) return null
  return { tenantId: tenantId.toLowerCase(), organizationId: organizationId.toLowerCase() }
}

/**
 * Scope of an organization ingest job. The scheduler spreads the configured `targetPayload` and
 * adds `tenantId` / `organizationId` at the top level, so both shapes are read; the nested pair
 * wins, and the tenant and organization always come from the same place (a tenant from one shape
 * is never paired with an organization from the other). A missing or malformed scope is refused
 * rather than widened.
 */
export function readIngestScope(payload: XrayIngestJobPayload | null | undefined): ProjectionScope | null {
  if (!payload || typeof payload !== 'object') return null
  return readScopePair(payload.scope) ?? readScopePair(payload)
}

/**
 * An ingest queue job: the system tick (fan-out) or one organization. An organization job the
 * scheduler dispatched (`_jobOrigin: 'scheduler'`) comes from a per-organization schedule of the
 * previous design (`legacySchedule`), which the worker migrates to the system tick.
 */
export function readIngestPayload(payload: unknown): XrayIngestPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as XrayIngestJobPayload
  if (candidate.kind === XRAY_FANOUT_KIND) return { kind: 'fanout' }
  if (candidate.kind !== undefined) return null
  const scope = readIngestScope(candidate)
  if (!scope) return null
  return { kind: 'organization', scope, legacySchedule: candidate._jobOrigin === 'scheduler' }
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

/** A rollup queue job (`{ scope: { tenantId, organizationId } }`); anything else is refused. */
export function readRollupPayload(payload: unknown): XrayRollupJobPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const scope = readScopePair((payload as Partial<XrayRollupJobPayload>).scope)
  return scope ? { scope } : null
}

/** Whether the directory organization exists in that tenant (one scoped lookup). */
export async function isOrganizationInTenant(em: EntityManager, scope: ProjectionScope): Promise<boolean> {
  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: scope.organizationId, tenant: scope.tenantId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return organization !== null && organization !== undefined
}

/** Refuses — before any write — a tenant/organization pair whose organization belongs to another tenant. */
export async function assertXrayScope(em: EntityManager, scope: ProjectionScope): Promise<void> {
  if (!(await isOrganizationInTenant(em, scope))) throw new XrayScopeMismatchError()
}

function organizationTenantId(organization: Organization): string | null {
  const tenant = organization.tenant as unknown
  if (typeof tenant === 'string') return tenant.toLowerCase()
  if (tenant && typeof tenant === 'object' && typeof (tenant as { id?: unknown }).id === 'string') {
    return ((tenant as { id: string }).id).toLowerCase()
  }
  return null
}

/** The tenant of each existing organization of a page (one query); missing organizations are absent. */
export async function resolveOrganizationTenants(em: EntityManager, organizationIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(organizationIds))
  const tenants = new Map<string, string>()
  if (ids.length === 0) return tenants
  const organizations = await findWithDecryption(em, Organization, { id: { $in: ids } }, undefined, { tenantId: null, organizationId: null })
  for (const organization of organizations) {
    const tenantId = organizationTenantId(organization)
    if (tenantId) tenants.set(String(organization.id).toLowerCase(), tenantId)
  }
  return tenants
}
