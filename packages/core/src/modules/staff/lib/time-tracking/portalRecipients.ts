import type { EntityManager } from '@mikro-orm/postgresql'
import { TableNotFoundException } from '@mikro-orm/core'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

const logger = createLogger('staff').child({ component: 'time-tracking/portal-recipients' })

/**
 * EP-50. The customer-user side of the portal contract, expressed as table and
 * column **names** rather than imports.
 *
 * Staff is slated for extraction into `@open-mercato/staff`, so it may not take a
 * static dependency on `customer_accounts`; `requires` in `index.ts` never gains it.
 * A Kysely query against the string
 * `'customer_users'` reads the mapping without an import edge, exactly the way
 * `warranty_claims/commands/claims.ts` does — and if the table is absent because
 * the module is not installed, the query throws "relation does not exist" and the
 * audience is empty, which every caller treats as "no portal audience".
 *
 * Each helper comes in two flavours. The `...Strict` variant returns `[]` only for
 * an expected empty audience (no rows, or the `customer_accounts` tables absent)
 * and rethrows any other query failure, so a caller that records "the portal was
 * told" can retry instead of recording a delivery that never happened. The lenient
 * variant keeps the historical swallow-and-return-`[]` contract and reports the
 * unexpected failure to telemetry. Both fail closed: neither ever returns an
 * unfiltered audience.
 *
 * `customer_users.customer_entity_id` is the FK into `customers:customer_entity`,
 * which is the same id `staff_time_reports.customer_id` holds (EP-44 declares that
 * link). That equality is the whole ownership model: a portal user reaches a
 * report when, and only when, their own `customer_entity_id` matches the report's
 * `customer_id` inside the same tenant and organization.
 */

type CustomerUsersDb = {
  customer_users: {
    id: string
    tenant_id: string | null
    organization_id: string | null
    customer_entity_id: string | null
    is_active: boolean
    deleted_at: Date | null
  }
}

export type PortalRecipientScope = {
  tenantId: string
  organizationId: string
  customerId: string
}

/** A broadcast fan-out, not a mailing list — a customer with more portal users than this gets a truncated audience rather than an unbounded query. */
export const MAX_PORTAL_RECIPIENTS = 100

const UNDEFINED_TABLE_SQLSTATE = '42P01'

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** The `customer_accounts` tables are not installed: an expected "no portal audience", not a failure. */
export function isPortalTableMissingError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    if (current instanceof TableNotFoundException) return true
    const candidate = current as { code?: unknown; cause?: unknown }
    if (candidate.code === UNDEFINED_TABLE_SQLSTATE) return true
    current = candidate.cause
  }
  return false
}

function reportSwallowedRecipientError(err: unknown, code: string): void {
  if (isPortalTableMissingError(err)) return
  getTelemetryRuntime()?.reportError(err, { module: 'staff', code })
}

export async function resolvePortalRecipientUserIdsStrict(
  em: EntityManager,
  scope: PortalRecipientScope,
): Promise<string[]> {
  if (!isNonEmpty(scope.tenantId) || !isNonEmpty(scope.organizationId) || !isNonEmpty(scope.customerId)) {
    return []
  }
  try {
    const db = em.getKysely<CustomerUsersDb>()
    const rows = await db
      .selectFrom('customer_users')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('customer_entity_id', '=', scope.customerId)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .limit(MAX_PORTAL_RECIPIENTS)
      .execute()
    return rows.map((row) => row.id).filter(isNonEmpty)
  } catch (err) {
    if (isPortalTableMissingError(err)) return []
    throw err
  }
}

export async function resolvePortalRecipientUserIds(
  em: EntityManager,
  scope: PortalRecipientScope,
): Promise<string[]> {
  try {
    return await resolvePortalRecipientUserIdsStrict(em, scope)
  } catch (err) {
    logger.warn('Could not resolve portal recipients for a time-tracking customer', {
      customerId: scope.customerId,
      err,
    })
    reportSwallowedRecipientError(err, 'staff.portal_recipients_resolve_failed')
    return []
  }
}

type CustomerAclDb = {
  customer_user_acls: {
    user_id: string
    tenant_id: string
    features_json: unknown
    is_portal_admin: boolean
  }
  customer_user_roles: {
    user_id: string
    role_id: string
    deleted_at: Date | null
  }
  customer_roles: {
    id: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
  customer_role_acls: {
    role_id: string
    tenant_id: string
    features_json: unknown
    is_portal_admin: boolean
  }
}

type PortalAclGrant = { features: string[]; isPortalAdmin: boolean }

function readFeatureList(value: unknown): string[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(parsed) ? parsed.filter(isNonEmpty) : []
}

function mergeGrant(grants: Map<string, PortalAclGrant>, userId: string, featuresJson: unknown, isPortalAdmin: boolean): void {
  const grant = grants.get(userId) ?? { features: [], isPortalAdmin: false }
  grant.isPortalAdmin = grant.isPortalAdmin || isPortalAdmin === true
  for (const feature of readFeatureList(featuresJson)) {
    if (!grant.features.includes(feature)) grant.features.push(feature)
  }
  grants.set(userId, grant)
}

/**
 * Narrows a portal audience to the customer users holding `requiredFeature`, resolved the
 * way `customer_accounts`' `CustomerRbacService.loadAcl` does: a per-user ACL row replaces
 * the user's role ACLs, a portal admin is unrestricted, and grants match wildcard-aware via
 * `authorizeFeatures`. Read by table name for the same decoupling reason as above. The
 * strict variant returns `[]` when the module is absent and rethrows any other failure;
 * neither variant ever returns an unfiltered audience.
 */
export async function filterPortalRecipientsByFeatureStrict(
  em: EntityManager,
  userIds: string[],
  scope: { tenantId: string; organizationId: string },
  requiredFeature: string,
): Promise<string[]> {
  const candidates = Array.from(new Set(userIds.filter(isNonEmpty)))
  if (candidates.length === 0 || !isNonEmpty(scope.tenantId) || !isNonEmpty(scope.organizationId)) return []
  try {
    const db = em.getKysely<CustomerAclDb>()
    const userAclRows = await db
      .selectFrom('customer_user_acls')
      .select(['user_id', 'features_json', 'is_portal_admin'])
      .where('tenant_id', '=', scope.tenantId)
      .where('user_id', 'in', candidates)
      .execute()
    const userGrants = new Map<string, PortalAclGrant>()
    for (const row of userAclRows) mergeGrant(userGrants, row.user_id, row.features_json, row.is_portal_admin)
    const roleCandidates = candidates.filter((userId) => !userGrants.has(userId))
    const roleGrants = new Map<string, PortalAclGrant>()
    if (roleCandidates.length > 0) {
      const roleAclRows = await db
        .selectFrom('customer_user_roles')
        .innerJoin('customer_roles', 'customer_roles.id', 'customer_user_roles.role_id')
        .innerJoin('customer_role_acls', 'customer_role_acls.role_id', 'customer_roles.id')
        .select([
          'customer_user_roles.user_id as user_id',
          'customer_role_acls.features_json as features_json',
          'customer_role_acls.is_portal_admin as is_portal_admin',
        ])
        .where('customer_user_roles.user_id', 'in', roleCandidates)
        .where('customer_user_roles.deleted_at', 'is', null)
        .where('customer_roles.tenant_id', '=', scope.tenantId)
        .where('customer_roles.organization_id', '=', scope.organizationId)
        .where('customer_roles.deleted_at', 'is', null)
        .where('customer_role_acls.tenant_id', '=', scope.tenantId)
        .execute()
      for (const row of roleAclRows) mergeGrant(roleGrants, row.user_id, row.features_json, row.is_portal_admin)
    }
    return candidates.filter((userId) => {
      const grant = userGrants.get(userId) ?? roleGrants.get(userId)
      if (!grant) return false
      return authorizeFeatures([requiredFeature], { grantedFeatures: grant.features, unrestricted: grant.isPortalAdmin })
    })
  } catch (err) {
    if (isPortalTableMissingError(err)) return []
    throw err
  }
}

export async function filterPortalRecipientsByFeature(
  em: EntityManager,
  userIds: string[],
  scope: { tenantId: string; organizationId: string },
  requiredFeature: string,
): Promise<string[]> {
  try {
    return await filterPortalRecipientsByFeatureStrict(em, userIds, scope, requiredFeature)
  } catch (err) {
    logger.warn('Could not resolve portal recipient features; treating the audience as empty', {
      feature: requiredFeature,
      err,
    })
    reportSwallowedRecipientError(err, 'staff.portal_recipients_feature_filter_failed')
    return []
  }
}
