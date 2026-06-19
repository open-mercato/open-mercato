import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CacheStrategy } from '@open-mercato/cache'
import { parseSelectedOrganizationCookie, parseSelectedTenantCookie } from './scopeCookies'

export { parseSelectedOrganizationCookie, parseSelectedTenantCookie }

export type OrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
  tenantId: string | null
}

// Phase 4 — short-TTL cache for resolveOrganizationScopeForRequest.
// OrganizationScope is a pure function of (userId, tenantId, selectedOrgId,
// requestedTenant) between membership changes; caching it bypasses 1
// SELECT on `organizations` per CRUD request. TTL is short (60s default)
// to keep staleness bounded as a backstop. Tag-based invalidation also fires
// eagerly: per-user entries are dropped by RbacService.invalidateUserCache
// (every ACL/role grant change goes through it — see buildOrgScopeUserCacheTag)
// and per-tenant entries by the directory.organization.* subscriber plus
// RbacService.invalidateTenantCache (role-ACL changes).
const ORG_SCOPE_CACHE_KEY_PREFIX = 'org-scope'
// Phase 4 default-off until the same readiness probe (`GET /api/customers/people`)
// stays green with the cache layer engaged. Set `OM_ORG_SCOPE_CACHE_TTL_MS=60000`
// (or any positive integer) to opt in once cross-request safety is re-verified.
const ORG_SCOPE_DEFAULT_TTL_MS = 0

function resolveOrgScopeTtlMs(): number {
  const raw = process.env.OM_ORG_SCOPE_CACHE_TTL_MS
  if (raw === undefined) return ORG_SCOPE_DEFAULT_TTL_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return ORG_SCOPE_DEFAULT_TTL_MS
  return parsed
}

function buildOrgScopeCacheKey(parts: {
  userId: string
  effectiveTenantId: string
  selectedOrgId: string | null
  requestedTenantId: string | null
}): string {
  const selected = parts.selectedOrgId ?? 'none'
  const requested = parts.requestedTenantId ?? 'none'
  return `${ORG_SCOPE_CACHE_KEY_PREFIX}:${parts.userId}:${parts.effectiveTenantId}:${selected}:${requested}`
}

// Tag builders are exported so the modules that own the "this user's scope
// changed" / "this tenant's org tree changed" signals (auth RBAC invalidation,
// the directory.organization.* subscriber) can drop the matching cross-request
// cache entries without re-deriving the tag format. Keeping the format in one
// place is what lets the TTL be enabled safely (issue #2259).
export function buildOrgScopeUserCacheTag(userId: string): string {
  return `${ORG_SCOPE_CACHE_KEY_PREFIX}:user:${userId}`
}

export function buildOrgScopeTenantCacheTag(tenantId: string): string {
  return `${ORG_SCOPE_CACHE_KEY_PREFIX}:tenant:${tenantId}`
}

function buildOrgScopeCacheTags(parts: { userId: string; effectiveTenantId: string }): string[] {
  return [
    buildOrgScopeUserCacheTag(parts.userId),
    buildOrgScopeTenantCacheTag(parts.effectiveTenantId),
  ]
}

function isValidCachedScope(value: unknown): value is OrganizationScope {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<OrganizationScope>
  const idOk = (v: unknown) => v === null || typeof v === 'string'
  const arrOk = (v: unknown) => v === null || (Array.isArray(v) && v.every((entry) => typeof entry === 'string'))
  return idOk(record.selectedId) && idOk(record.tenantId) && arrOk(record.filterIds) && arrOk(record.allowedIds)
}

function resolveCacheFromContainer(container: AwilixContainer | null | undefined): CacheStrategy | null {
  if (!container) return null
  try {
    const c = container.resolve('cache') as CacheStrategy | undefined
    if (c && typeof c.get === 'function' && typeof c.set === 'function') return c
  } catch {
    return null
  }
  return null
}

export async function invalidateOrganizationScopeCacheForUser(
  container: AwilixContainer,
  userId: string,
): Promise<void> {
  const cache = resolveCacheFromContainer(container)
  if (!cache?.deleteByTags) return
  try {
    await cache.deleteByTags([buildOrgScopeUserCacheTag(userId)])
  } catch (err) {
    console.warn('[org-scope:cache] invalidate user failed', err)
  }
}

export async function invalidateOrganizationScopeCacheForTenant(
  container: AwilixContainer,
  tenantId: string,
): Promise<void> {
  const cache = resolveCacheFromContainer(container)
  if (!cache?.deleteByTags) return
  try {
    await cache.deleteByTags([buildOrgScopeTenantCacheTag(tenantId)])
  } catch (err) {
    console.warn('[org-scope:cache] invalidate tenant failed', err)
  }
}

// Issue #2259 — per-request memoization. resolveOrganizationScopeForRequest
// runs at least twice per CRUD request: once for the route-level feature check
// (resolveFeatureCheckContext) and once inside the shared factory's withCtx.
// Those two call sites use different request-scoped DI containers but are handed
// the SAME Request instance, so memoizing the resolved scope on a WeakMap keyed
// by that request collapses the duplicate work — and the duplicate
// `organizations` SELECT — into a single resolution. The inner map is keyed by
// the same identity tuple as the cross-request cache key, so distinct explicit
// selectedId/tenant overrides on one request stay independent. There is no
// staleness risk: the memo lives only for the lifetime of one request and is
// dropped with the request object by the GC.
const orgScopeRequestMemo = new WeakMap<object, Map<string, Promise<OrganizationScope>>>()

function getRequestScopeMemo(request: unknown): Map<string, Promise<OrganizationScope>> | null {
  if (!request || (typeof request !== 'object' && typeof request !== 'function')) return null
  const key = request as object
  let memo = orgScopeRequestMemo.get(key)
  if (!memo) {
    memo = new Map<string, Promise<OrganizationScope>>()
    orgScopeRequestMemo.set(key, memo)
  }
  return memo
}

function normalizeOrganizationId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getSelectedOrganizationFromRequest(req: Request | { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get(name: string): string | null } }): string | null {
  const cookieContainer = (req as { cookies?: { get: (name: string) => { value: string } | undefined } }).cookies
  if (cookieContainer && typeof cookieContainer.get === 'function') {
    const val = cookieContainer.get('om_selected_org')?.value
    return val ?? null
  }
  const headerContainer = (req as { headers?: { get(name: string): string | null } }).headers
  const header = typeof headerContainer?.get === 'function' ? headerContainer.get('cookie') : null
  return parseSelectedOrganizationCookie(header)
}

export function getSelectedTenantFromRequest(
  req: Request | { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get(name: string): string | null } },
): string | null {
  const cookieContainer = (req as { cookies?: { get: (name: string) => { value: string } | undefined } }).cookies
  if (cookieContainer && typeof cookieContainer.get === 'function') {
    const val = cookieContainer.get('om_selected_tenant')?.value
    return val ?? null
  }
  const headerContainer = (req as { headers?: { get(name: string): string | null } }).headers
  const header = typeof headerContainer?.get === 'function' ? headerContainer.get('cookie') : null
  return parseSelectedTenantCookie(header)
}

function normalizeOrganizationIds(ids: string[]): string[] {
  return Array.from(new Set(
    ids.map((value) => normalizeOrganizationId(value)).filter((value): value is string => {
      if (!value) return false
      if (isAllOrganizationsSelection(value)) return false
      return true
    })
  ))
}

// Map each organization id to itself plus its persisted descendant ids. Only
// orgs that exist for the tenant and are not soft-deleted are included, so an
// unknown/inaccessible id simply has no entry (matching the per-id query that
// returned an empty set for it).
type OrgDescendantMap = Map<string, string[]>

// Issue #2228 — single round-trip for org-scope resolution. Instead of issuing
// one `organizations` SELECT per `collectWithDescendants` call (up to 3-4
// sequential queries per request: accessible set, fallback set, selected set),
// gather every candidate id up front and fetch their descendant expansions in
// one `em.find(Organization, { id: $in })`. Expansion then happens in-memory.
async function loadOrgDescendantMap(em: EntityManager, tenantId: string, ids: string[]): Promise<OrgDescendantMap> {
  const unique = normalizeOrganizationIds(ids)
  if (!unique.length) return new Map()
  const filter: FilterQuery<Organization> = {
    tenant: tenantId,
    id: { $in: unique },
    deletedAt: null,
  }
  const orgs = await em.find(Organization, filter)
  const map: OrgDescendantMap = new Map()
  for (const org of orgs) {
    const id = String(org.id)
    const expansion = [id]
    if (Array.isArray(org.descendantIds)) {
      for (const desc of org.descendantIds) expansion.push(String(desc))
    }
    map.set(id, expansion)
  }
  return map
}

function expandWithDescendants(map: OrgDescendantMap, ids: string[]): Set<string> {
  const set = new Set<string>()
  for (const value of ids) {
    const id = normalizeOrganizationId(value)
    if (!id || isAllOrganizationsSelection(id)) continue
    const expansion = map.get(id)
    if (!expansion) continue
    for (const entry of expansion) set.add(entry)
  }
  return set
}

export async function resolveOrganizationScope({
  em,
  rbac,
  auth,
  selectedId,
  tenantId: tenantIdOverride,
}: {
  em: EntityManager
  rbac: RbacService
  auth: AuthContext
  selectedId?: string | null
  tenantId?: string | null
}): Promise<OrganizationScope> {
  if (!auth || !auth.sub) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }
  const actorTenantId = typeof auth.tenantId === 'string' && auth.tenantId.trim().length > 0 ? auth.tenantId.trim() : null
  const candidateTenantId = typeof tenantIdOverride === 'string' && tenantIdOverride.trim().length > 0
    ? tenantIdOverride.trim()
    : tenantIdOverride === null
      ? null
      : actorTenantId
  if (!candidateTenantId) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }
  const usingOverride = candidateTenantId !== actorTenantId
  const isSuperAdminActor = auth.isSuperAdmin === true
  const tenantId = usingOverride && actorTenantId && !isSuperAdminActor ? actorTenantId : candidateTenantId
  if (!tenantId) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }
  const normalizedRequestedSelection = normalizeOrganizationId(selectedId)
  const explicitAllOrgsChoice =
    normalizedRequestedSelection !== null && isAllOrganizationsSelection(normalizedRequestedSelection)
  const normalizedSelectedId = explicitAllOrgsChoice
    ? null
    : normalizedRequestedSelection
  const contextOrgId = actorTenantId && actorTenantId === tenantId ? normalizeOrganizationId(auth.orgId) : null
  const acl = await rbac.loadAcl(auth.sub, { tenantId, organizationId: contextOrgId })
  const aclIsSuperAdmin = acl?.isSuperAdmin === true
  const effectiveSuperAdmin = aclIsSuperAdmin || isSuperAdminActor
  const normalizedAccessible = effectiveSuperAdmin
    ? null
    : Array.isArray(acl?.organizations)
      ? acl.organizations
        .map((value) => normalizeOrganizationId(value))
        .filter((value): value is string => value !== null)
      : null
  const accessibleList = effectiveSuperAdmin
    ? null
    : normalizedAccessible && normalizedAccessible.some((value) => isAllOrganizationsSelection(value))
      ? null
      : normalizedAccessible?.filter((value) => !isAllOrganizationsSelection(value)) ?? null

  const accountOrgId = actorTenantId && actorTenantId === tenantId ? normalizeOrganizationId(auth.orgId) : null
  const fallbackOrgId = accountOrgId ?? null

  // Every id that could be expanded below — accessible set, fallback (account)
  // org, and the requested selection — is known up front, so fetch them all in
  // a single `organizations` query and expand from the in-memory map.
  const candidateIds = [
    ...(accessibleList ?? []),
    ...(fallbackOrgId ? [fallbackOrgId] : []),
    ...(normalizedSelectedId ? [normalizedSelectedId] : []),
  ]
  const orgDescendants = await loadOrgDescendantMap(em, tenantId, candidateIds)
  const loadFallbackSet = (): Set<string> | null =>
    fallbackOrgId ? expandWithDescendants(orgDescendants, [fallbackOrgId]) : null

  let allowedSet: Set<string> | null = null
  if (accessibleList === null) {
    allowedSet = null
  } else if (accessibleList.length === 0) {
    allowedSet = new Set()
  } else {
    allowedSet = expandWithDescendants(orgDescendants, accessibleList)
  }

  if (allowedSet && allowedSet.size === 0 && fallbackOrgId) {
    const computed = loadFallbackSet()
    if (computed && computed.size > 0) {
      allowedSet = computed
    }
  }

  const hasUnrestrictedAccess = effectiveSuperAdmin || (accessibleList === null)
  const noOrgSelection = normalizedSelectedId === null && !explicitAllOrgsChoice
  const widenToAllOrgs =
    (explicitAllOrgsChoice && hasUnrestrictedAccess)
    || (effectiveSuperAdmin && noOrgSelection)
  const initialSelected =
    normalizedSelectedId
    ?? (widenToAllOrgs ? null : accountOrgId ?? null)
  let effectiveSelected: string | null = null
  if (initialSelected) {
    if (allowedSet === null || allowedSet.has(initialSelected)) {
      effectiveSelected = initialSelected
    }
  }

  let filterSet: Set<string> | null = null
  if (effectiveSelected) {
    filterSet = expandWithDescendants(orgDescendants, [effectiveSelected])
  } else if (allowedSet !== null) {
    filterSet = allowedSet
  } else if (widenToAllOrgs) {
    filterSet = null
  } else if (auth.orgId) {
    filterSet = loadFallbackSet()
  }

  if ((!filterSet || filterSet.size === 0) && fallbackOrgId && !widenToAllOrgs) {
    const computed = loadFallbackSet()
    if (computed && computed.size > 0) {
      filterSet = computed
      if (!effectiveSelected) {
        effectiveSelected = fallbackOrgId
      }
    }
  }

  return {
    selectedId: effectiveSelected,
    filterIds: filterSet ? Array.from(filterSet) : null,
    allowedIds: allowedSet ? Array.from(allowedSet) : null,
    tenantId,
  }
}

export async function resolveOrganizationScopeForRequest({
  container,
  auth,
  request,
  selectedId,
  tenantId: tenantOverride,
}: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: Request | { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get(name: string): string | null } }
  selectedId?: string | null
  tenantId?: string | null
}): Promise<OrganizationScope> {
  if (!auth || !auth.sub) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }

  let em: EntityManager | null = null
  let rbac: RbacService | null = null
  try { em = container.resolve<EntityManager>('em') } catch { em = null }
  try { rbac = container.resolve<RbacService>('rbacService') } catch { rbac = null }
  const normalizeString = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    return null
  }
  if (!em || !rbac) {
    const fallbackSelected = normalizeOrganizationId(selectedId ?? auth.orgId ?? null)
    return {
      selectedId: fallbackSelected,
      filterIds: fallbackSelected ? [fallbackSelected] : null,
      allowedIds: fallbackSelected ? [fallbackSelected] : null,
      tenantId: normalizeString(auth.tenantId),
    }
  }

  const actorTenantField = (auth as { actorTenantId?: string | null }).actorTenantId
  const actorTenant = actorTenantField === undefined
    ? normalizeString(auth.tenantId)
    : actorTenantField === null
      ? null
      : normalizeString(actorTenantField)
  const actorOrgField = (auth as { actorOrgId?: string | null }).actorOrgId
  const actorOrgId = actorOrgField === undefined
    ? normalizeString(auth.orgId)
    : actorOrgField === null
      ? null
      : normalizeString(actorOrgField)

  const cookieTenant = request ? getSelectedTenantFromRequest(request) : null
  const requestedTenant =
    tenantOverride !== undefined
      ? tenantOverride
      : cookieTenant !== undefined
        ? cookieTenant
        : undefined
  const requestedTenantId = typeof requestedTenant === 'string' && requestedTenant.trim().length > 0 ? requestedTenant.trim() : null
  const isSuperAdminActor = auth.isSuperAdmin === true
  let effectiveTenantId = requestedTenantId ?? actorTenant ?? null
  if (actorTenant && effectiveTenantId && effectiveTenantId !== actorTenant && !isSuperAdminActor) {
    effectiveTenantId = actorTenant
  }
  if (!effectiveTenantId) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }

  const scopedAuth = {
    ...auth,
    tenantId: effectiveTenantId,
    orgId: actorTenant && actorTenant === effectiveTenantId ? actorOrgId ?? null : null,
  }

  const rawSelected = selectedId !== undefined ? selectedId : (request ? getSelectedOrganizationFromRequest(request) : null)
  const normalizedSelectedId = typeof rawSelected === 'string' && rawSelected.trim().length > 0
    ? rawSelected.trim()
    : null

  const userId = typeof auth.sub === 'string' && auth.sub.length > 0 ? auth.sub : null
  const ttlMs = resolveOrgScopeTtlMs()
  const cache = ttlMs > 0 ? resolveCacheFromContainer(container) : null
  const cacheKey = userId
    ? buildOrgScopeCacheKey({
        userId,
        effectiveTenantId,
        selectedOrgId: normalizedSelectedId,
        requestedTenantId: requestedTenantId ?? null,
      })
    : null

  const requestMemo = getRequestScopeMemo(request)
  if (requestMemo && cacheKey) {
    const memoized = requestMemo.get(cacheKey)
    if (memoized) return memoized
  }

  const resolveScope = async (): Promise<OrganizationScope> => {
    if (cache && cacheKey && typeof cache.get === 'function') {
      try {
        const cached = await cache.get(cacheKey)
        if (isValidCachedScope(cached)) return cached
      } catch (err) {
        console.warn('[org-scope:cache] read failed', err)
      }
    }

    const baseScope = await resolveOrganizationScope({
      em,
      rbac,
      auth: scopedAuth,
      selectedId: rawSelected,
      tenantId: effectiveTenantId,
    })

    if (cache && cacheKey && userId && typeof cache.set === 'function') {
      try {
        await cache.set(cacheKey, baseScope, {
          ttl: ttlMs,
          tags: buildOrgScopeCacheTags({ userId, effectiveTenantId }),
        })
      } catch (err) {
        console.warn('[org-scope:cache] write failed', err)
      }
    }

    return baseScope
  }

  if (requestMemo && cacheKey) {
    const pending = resolveScope()
    requestMemo.set(cacheKey, pending)
    return pending
  }

  return resolveScope()
}

export type FeatureCheckContext = {
  organizationId: string | null
  scope: OrganizationScope
  allowedOrganizationIds: string[] | null
}

export async function resolveFeatureCheckContext({
  container,
  auth,
  request,
  selectedId,
  tenantId,
}: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: Request | { cookies?: { get: (name: string) => { value: string } | undefined } }
  selectedId?: string | null
  tenantId?: string | null
}): Promise<FeatureCheckContext> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request, selectedId, tenantId })
  const allowedOrganizationIds = scope.allowedIds ?? null
  const authOrgId = auth?.orgId ?? null
  const organizationId =
    scope.selectedId
    ?? (authOrgId && (!Array.isArray(allowedOrganizationIds) || allowedOrganizationIds.includes(authOrgId)) ? authOrgId : null)
    ?? (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length ? allowedOrganizationIds[0] : null)

  return { organizationId, scope, allowedOrganizationIds }
}
