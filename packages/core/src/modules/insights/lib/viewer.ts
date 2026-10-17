import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import {
  resolveCanonicalAuthSubject,
  type CanonicalActorSubject,
} from '@open-mercato/core/modules/audit_logs/lib/actorSubject'
import type { FeatureGate } from './engine/target'

export const EXPLAIN_VIEW_FEATURE = 'insights.explain.view'
export const AUDIT_VIEW_TENANT_FEATURE = 'audit_logs.view_tenant'
export const AUDIT_VIEW_SELF_FEATURE = 'audit_logs.view_self'

export type ExplainViewer = {
  auth: NonNullable<AuthContext>
  subject: CanonicalActorSubject
  tenantId: string
  organizationIds: string[] | null
  rbacOrganizationId: string | null
  locale: string | null
}

export type ExplainViewerRescope = (requiredFeatures: readonly string[]) => Promise<ExplainViewer | null>

export type ExplainVisibility = {
  canSeeActors: boolean
  canSeePastValues: boolean
  canSeeOwnValues: boolean
}

type ExplainRequestLike = Request | {
  cookies?: { get: (name: string) => { value: string } | undefined }
  headers?: { get(name: string): string | null }
}

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Resolves who is asking and which organizations they may read. Fails closed (null)
 * without a canonical subject or a resolved tenant. `organizationIds` follows the
 * directory scope filter: null = tenant-wide (unrestricted), [] = nothing, list = IN.
 */
export async function resolveExplainViewer(params: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: ExplainRequestLike
  requiredFeatures?: readonly string[]
  locale?: string | null
}): Promise<ExplainViewer | null> {
  const auth = params.auth
  if (!auth) return null
  const subject = resolveCanonicalAuthSubject(auth)
  if (!subject) return null
  const { scope } = await resolveFeatureCheckContext({
    container: params.container,
    auth,
    request: params.request,
    requiredFeatures: params.requiredFeatures,
  })
  const tenantId = normalizeId(scope.tenantId) ?? normalizeId(auth.tenantId)
  if (!tenantId) return null
  const filter = resolveOrganizationScopeFilter(scope, auth)
  return {
    auth,
    subject,
    tenantId,
    organizationIds: filter.organizationIds === undefined ? null : Array.from(new Set(filter.organizationIds)),
    rbacOrganizationId: filter.rbacOrganizationId,
    locale: params.locale ?? null,
  }
}

export type ExplainFeatureChecker = {
  organizationId: string | null
  has: (requiredFeatures: readonly string[] | undefined) => Promise<boolean>
  prepare: (lists: ReadonlyArray<readonly string[] | undefined>) => Promise<FeatureGate>
}

export type ExplainFeatureCheckerOptions = {
  organizationId?: string | null
}

function featureListKey(features: readonly string[]): string {
  return Array.from(new Set(features))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .join('\u0000')
}

function normalizeFeatureList(requiredFeatures: readonly string[] | undefined): string[] {
  if (!Array.isArray(requiredFeatures)) return []
  return requiredFeatures.filter((feature) => typeof feature === 'string' && feature.length > 0)
}

/**
 * Wildcard-aware feature checks for one viewer, memoized per feature set for the
 * lifetime of a request. Checks are evaluated at `options.organizationId` (the
 * organization of the record or audit entry being explained); without one they fall
 * back to the viewer's tenant-level RBAC organization.
 *
 * `has` fails closed: an absent or empty feature list denies. `prepare` returns a
 * synchronous gate for OPTIONAL per-field restrictions, where an absent (or explicitly
 * empty) list means "no extra requirement" beyond the already-checked resource features,
 * and a list holding a blank or non-string entry denies.
 */
export function createExplainFeatureChecker(
  rbac: RbacService,
  viewer: ExplainViewer,
  options: ExplainFeatureCheckerOptions = {},
): ExplainFeatureChecker {
  const organizationId = normalizeId(options.organizationId) ?? viewer.rbacOrganizationId
  const cache = new Map<string, Promise<boolean>>()
  const has = (requiredFeatures: readonly string[] | undefined): Promise<boolean> => {
    const features = normalizeFeatureList(requiredFeatures)
    if (features.length === 0) return Promise.resolve(false)
    const key = featureListKey(features)
    const cached = cache.get(key)
    if (cached) return cached
    const pending = rbac.userHasAllFeatures(viewer.auth.sub, Array.from(new Set(features)), {
      tenantId: viewer.tenantId,
      organizationId,
    })
    cache.set(key, pending)
    return pending
  }
  const prepare = async (lists: ReadonlyArray<readonly string[] | undefined>): Promise<FeatureGate> => {
    const results = new Map<string, boolean>()
    await Promise.all(lists.map(async (list) => {
      const features = normalizeFeatureList(list)
      if (features.length === 0) return
      results.set(featureListKey(features), await has(features))
    }))
    return (requiredFeatures) => {
      if (requiredFeatures === undefined) return true
      if (!Array.isArray(requiredFeatures)) return false
      const features = normalizeFeatureList(requiredFeatures)
      if (features.length !== requiredFeatures.length) return false
      if (features.length === 0) return true
      return results.get(featureListKey(features)) === true
    }
  }
  return { organizationId, has, prepare }
}

export async function resolveExplainVisibility(checker: ExplainFeatureChecker): Promise<ExplainVisibility> {
  const [canViewTenant, canViewSelf] = await Promise.all([
    checker.has([AUDIT_VIEW_TENANT_FEATURE]),
    checker.has([AUDIT_VIEW_SELF_FEATURE]),
  ])
  return {
    canSeeActors: canViewTenant,
    canSeePastValues: canViewTenant,
    canSeeOwnValues: canViewTenant || canViewSelf,
  }
}

export function isOrganizationInScope(organizationId: string | null | undefined, organizationIds: string[] | null): boolean {
  if (organizationIds === null) return true
  if (!organizationId) return false
  return organizationIds.includes(organizationId)
}
