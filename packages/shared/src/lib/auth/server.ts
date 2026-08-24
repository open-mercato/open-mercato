import { cookies } from 'next/headers.js'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isMfaPendingJwtPayload, verifyJwt } from './jwt'
import { isMfaPendingAccessAllowed } from './mfaPendingAccess'
import { getSharedApiKeyAuthCache } from './apiKeyAuthCache'
import { isTransientDbError } from '@open-mercato/shared/lib/db/pg-errors'

function readRequestPathname(req: Request): string | null {
  try {
    return new URL(req.url).pathname
  } catch {
    return null
  }
}

const TENANT_COOKIE_NAME = 'om_selected_tenant'
const ORGANIZATION_COOKIE_NAME = 'om_selected_org'
const ALL_ORGANIZATIONS_COOKIE_VALUE = '__all__'
const SUPERADMIN_ROLE = 'superadmin'

export type AuthContext = {
  sub: string
  sid?: string | null
  tenantId: string | null
  orgId: string | null
  email?: string
  roles?: string[]
  isApiKey?: boolean
  userId?: string
  keyId?: string
  keyName?: string
  [k: string]: unknown
} | null

type CookieOverride = { applied: boolean; value: string | null }
// 'error' means auth could not be determined because of a transient/unexpected
// failure (DB unavailable, connection-pool exhaustion, statement timeout, …) —
// NOT because the token is genuinely invalid. Callers MUST NOT clear the user's
// session cookies for 'error'; doing so would log everyone out at once during a
// shared infrastructure blip (issue #4176).
type AuthResolutionStatus = 'authenticated' | 'missing' | 'invalid' | 'error'
type AuthResolution = {
  auth: AuthContext
  status: AuthResolutionStatus
}

// Thrown by `resolveCanonicalInteractiveAuthContext` when the canonical auth
// lookup itself fails unexpectedly (as opposed to resolving to a genuine
// "not authorized" null). Kept distinct so resolvers can map it to the
// non-destructive 'error' status instead of the cookie-clearing 'invalid'.
export class AuthResolutionUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Auth resolution unavailable')
    this.name = 'AuthResolutionUnavailableError'
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

// Symbol-keyed trusted auth context. Set on synthetic Request objects by
// callers that have already authenticated (e.g. the AI in-process operation
// runner) so downstream auth resolution short-circuits without re-running
// cookie/JWT/API-key parsing. The hook is fail-open: if absent the normal
// resolution path runs unchanged.
export const TRUSTED_AUTH_CONTEXT_SYMBOL = Symbol.for('open-mercato.auth.trustedContext')

export type TrustedAuthContextEnvelope = {
  auth: AuthContext
  status?: AuthResolutionStatus
}

/**
 * Attach an already-resolved auth context to a synthetic request.
 *
 * INVARIANT callers MUST uphold: `envelope.auth` has to be the product of a gated resolution —
 * `getAuthFromRequest` / `getAuthFromCookies` (or an equivalently validated principal such as an
 * API-key record). The envelope short-circuits `resolveAuthFromRequestDetailed` ahead of both the
 * MFA-pending gate and `resolveCanonicalStaffAuthContext`, so an envelope built straight from an
 * unvalidated JWT would reinstate the MFA bypass this module closes and skip session-revocation
 * checks as well. Never populate it from raw request credentials.
 */
export function attachTrustedAuthContext(
  request: Request,
  envelope: TrustedAuthContextEnvelope
): Request {
  ;(request as unknown as Record<symbol, TrustedAuthContextEnvelope>)[TRUSTED_AUTH_CONTEXT_SYMBOL] = envelope
  return request
}

function readTrustedAuthContext(request: Request): TrustedAuthContextEnvelope | null {
  const carrier = request as unknown as Record<symbol, unknown>
  const envelope = carrier[TRUSTED_AUTH_CONTEXT_SYMBOL]
  if (!envelope || typeof envelope !== 'object') return null
  const candidate = envelope as TrustedAuthContextEnvelope
  if (!('auth' in candidate)) return null
  return candidate
}

function decodeCookieValue(raw: string | undefined): string | null {
  if (raw === undefined) return null
  try {
    const decoded = decodeURIComponent(raw)
    return decoded ?? null
  } catch {
    return raw ?? null
  }
}

function readCookieFromHeader(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined
  const parts = header.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1)
    }
  }
  return undefined
}

/**
 * A blank `om_selected_tenant` is "no selection", not a deliberate "no tenant".
 *
 * Unlike the organization cookie there is no all-tenants sentinel to express, and the tenant
 * selector renders with `includeEmptyOption={false}`, so no UI produces a blank value. Treating it
 * as an applied override nulled `tenantId` for the whole super-admin session, which is what turned
 * a cosmetic client bug into `tenantId ?? ''` reaching a NOT NULL uuid column. Reporting the
 * override as not applied instead keeps the tenant carried in the token and remediates an
 * already-poisoned browser on its next request, whatever wrote the cookie.
 */
function resolveTenantOverride(raw: string | undefined): CookieOverride {
  if (raw === undefined) return { applied: false, value: null }
  const decoded = decodeCookieValue(raw)
  if (!decoded) return { applied: false, value: null }
  const trimmed = decoded.trim()
  if (!trimmed) return { applied: false, value: null }
  return { applied: true, value: trimmed }
}

function resolveOrganizationOverride(raw: string | undefined): CookieOverride {
  if (raw === undefined) return { applied: false, value: null }
  const decoded = decodeCookieValue(raw)
  if (!decoded || decoded === ALL_ORGANIZATIONS_COOKIE_VALUE) {
    return { applied: true, value: null }
  }
  const trimmed = decoded.trim()
  if (!trimmed || trimmed === ALL_ORGANIZATIONS_COOKIE_VALUE) {
    return { applied: true, value: null }
  }
  return { applied: true, value: trimmed }
}

function isSuperAdminAuth(auth: AuthContext | null | undefined): boolean {
  if (!auth) return false
  return (auth as Record<string, unknown>).isSuperAdmin === true
}

function applySuperAdminScope(
  auth: AuthContext,
  tenantCookie: string | undefined,
  orgCookie: string | undefined
): AuthContext {
  if (!auth || !isSuperAdminAuth(auth)) return auth

  const tenantOverride = resolveTenantOverride(tenantCookie)
  const orgOverride = resolveOrganizationOverride(orgCookie)
  if (!tenantOverride.applied && !orgOverride.applied) return auth

  type MutableAuthContext = Exclude<AuthContext, null> & {
    actorTenantId?: string | null
    actorOrgId?: string | null
  }
  const baseAuth = auth as Exclude<AuthContext, null>
  const next: MutableAuthContext = { ...baseAuth }
  if (tenantOverride.applied) {
    if (!('actorTenantId' in next)) next.actorTenantId = auth?.tenantId ?? null
    next.tenantId = tenantOverride.value
  }
  if (orgOverride.applied) {
    if (!('actorOrgId' in next)) next.actorOrgId = auth?.orgId ?? null
    next.orgId = orgOverride.value
  }
  next.isSuperAdmin = true
  const existingRoles = Array.isArray(next.roles) ? next.roles : []
  if (!existingRoles.some((role) => typeof role === 'string' && role.trim().toLowerCase() === SUPERADMIN_ROLE)) {
    next.roles = [...existingRoles, 'superadmin']
  }
  return next
}

async function resolveApiKeyAuth(secret: string): Promise<AuthContext> {
  if (!secret) return null
  const cache = getSharedApiKeyAuthCache()
  const cached = cache.get(secret)
  if (cached !== undefined) return cached as AuthContext
  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    const { findApiKeyBySecret } = await import('@open-mercato/core/modules/api_keys/services/apiKeyService')
    const { Role, RoleAcl, User } = await import('@open-mercato/core/modules/auth/data/entities')
    const { Organization, Tenant } = await import('@open-mercato/core/modules/directory/data/entities')

    const record = await findApiKeyBySecret(em, secret)
    if (!record) {
      cache.setMiss(secret)
      return null
    }

    const roleIds = Array.isArray(record.rolesJson)
      ? record.rolesJson.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : []
    const roles = roleIds.length
      ? await em.find(Role, { id: { $in: roleIds }, deletedAt: null })
      : []
    const roleNames = roles.map((role) => role.name).filter((name): name is string => typeof name === 'string' && name.length > 0)

    // A role-level super-admin grant is authorization-grade only when it is genuinely
    // unrestricted: the grant itself must not be organization-scoped, it must belong to the
    // key's tenant, and the key must not be bound to a single organization. RbacService applies
    // the same intersection when projecting the scoped ACL, but generic guards
    // (tenantAccess.resolveIsSuperAdmin, the scoped-API helpers) trust this raw bit *before*
    // live RBAC runs — so an organization-restricted key must never carry it.
    let keyIsSuperAdmin = false
    const keyOrganizationId = typeof record.organizationId === 'string' && record.organizationId.trim().length > 0
      ? record.organizationId.trim()
      : null
    if (roleIds.length && !keyOrganizationId) {
      const superAcls = await em.find(
        RoleAcl,
        {
          role: { $in: roleIds } as any,
          tenantId: record.tenantId ?? null,
          isSuperAdmin: true,
          deletedAt: null,
        } as any,
      )
      keyIsSuperAdmin = superAcls.some((acl) => {
        const organizations = Array.isArray((acl as { organizationsJson?: string[] | null }).organizationsJson)
          ? (acl as { organizationsJson?: string[] | null }).organizationsJson as string[]
          : null
        // An empty list means "inherit the key's own binding"; with no binding that is tenant-wide.
        return !organizations || organizations.length === 0 || organizations.includes('__all__')
      })
    }

    if (cache.shouldWriteLastUsed(record.id)) {
      try {
        record.lastUsedAt = new Date()
        await em.persist(record).flush()
      } catch {
        // best-effort update; ignore write failures
      }
    }

    // Ephemeral session keys are always user-bound. Regular keys retain their
    // legacy creator identity, while tenant-scoped regular keys ignore only the
    // creator's concrete organization when validating the wider key scope.
    // Keep every session marker fail-closed so a malformed session key cannot
    // fall back to the regular key path and escape its user/scope binding.
    const isSessionBoundKey = Boolean(
      record.sessionToken
      || record.sessionUserId
      || record.sessionSecretEncrypted
      || record.opencodeSessionId
    )
    const actualUserId = isSessionBoundKey
      ? record.sessionUserId ?? null
      : record.createdBy ?? null

    if (isSessionBoundKey && !actualUserId) {
      cache.setMiss(secret)
      return null
    }

    if (actualUserId) {
      const user = await em.findOne(User, { id: actualUserId, deletedAt: null })
      if (!user) {
        cache.setMiss(secret)
        return null
      }
      if ((user.tenantId ?? null) !== (record.tenantId ?? null)) {
        cache.setMiss(secret)
        return null
      }
      const requiresExactOrganization = isSessionBoundKey || Boolean(record.organizationId)
      if (requiresExactOrganization && (user.organizationId ?? null) !== (record.organizationId ?? null)) {
        cache.setMiss(secret)
        return null
      }
    } else {
      if (record.tenantId) {
        const tenant = await em.findOne(Tenant, { id: record.tenantId, deletedAt: null, isActive: true })
        if (!tenant) {
          cache.setMiss(secret)
          return null
        }
      }
      if (record.organizationId) {
        const organization = await em.findOne(Organization, { id: record.organizationId, deletedAt: null, isActive: true })
        if (!organization) {
          cache.setMiss(secret)
          return null
        }
        if (record.tenantId && String(organization.tenant.id) !== record.tenantId) {
          cache.setMiss(secret)
          return null
        }
      }
    }

    const auth: Exclude<AuthContext, null> = {
      sub: `api_key:${record.id}`,
      tenantId: record.tenantId ?? null,
      orgId: record.organizationId ?? null,
      roles: roleNames,
      isApiKey: true,
      isSuperAdmin: keyIsSuperAdmin,
      keyId: record.id,
      keyName: record.name,
      ...(actualUserId ? { userId: actualUserId } : {}),
    }
    cache.setSuccess(secret, auth, record.expiresAt ? record.expiresAt.getTime() : null)
    return auth
  } catch (err) {
    // A transient DB failure (pool exhausted, `max_connections` reached, DB
    // restarting) means we could not confirm the key — NOT that it is invalid.
    // Surface it so callers return a retryable 503 instead of masking it as an
    // auth miss (401). Genuine misses already returned `null` above.
    if (isTransientDbError(err)) {
      throw new AuthResolutionUnavailableError(err)
    }
    return null
  }
}

function extractApiKey(req: Request): string | null {
  const header = (req.headers.get('x-api-key') || '').trim()
  if (header) return header
  const authHeader = (req.headers.get('authorization') || '').trim()
  if (authHeader.toLowerCase().startsWith('apikey ')) {
    return authHeader.slice(7).trim()
  }
  return null
}

async function resolveCanonicalInteractiveAuthContext(auth: AuthContext): Promise<AuthContext> {
  if (!auth || auth.isApiKey) return auth
  if (typeof auth.sub !== 'string' || auth.sub.trim().length === 0) return null

  try {
    const [{ createRequestContainer }, { resolveCanonicalStaffAuthContext }] = await Promise.all([
      import('@open-mercato/shared/lib/di/container'),
      import('@open-mercato/core/modules/auth/lib/sessionIntegrity'),
    ])
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    return await resolveCanonicalStaffAuthContext(em, auth)
  } catch (err) {
    // A thrown error here means we could not check the token against the
    // database (DB down, pool exhausted, timeout). This is NOT the same as the
    // token being invalid — surface it so callers keep the session intact and
    // fail the request transiently instead of force-logging the user out.
    throw new AuthResolutionUnavailableError(err)
  }
}

export async function resolveAuthFromCookiesDetailed(): Promise<AuthResolution> {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth_token')?.value
  if (!token) return { auth: null, status: 'missing' }
  try {
    const payload = verifyJwt(token) as AuthContext
    if (!payload) return { auth: null, status: 'invalid' }
    if (payload.type === 'customer') return { auth: null, status: 'invalid' }
    // MFA-pending tokens are provisional: pages never complete the second factor, so they
    // must not resolve to an authenticated context anywhere in the RSC/page flow.
    if (isMfaPendingJwtPayload(payload)) return { auth: null, status: 'invalid' }
    const canonicalAuth = await resolveCanonicalInteractiveAuthContext(payload)
    if (!canonicalAuth) return { auth: null, status: 'invalid' }
    const tenantCookie = cookieStore.get(TENANT_COOKIE_NAME)?.value
    const orgCookie = cookieStore.get(ORGANIZATION_COOKIE_NAME)?.value
    return {
      auth: applySuperAdminScope(canonicalAuth, tenantCookie, orgCookie),
      status: 'authenticated',
    }
  } catch (err) {
    if (err instanceof AuthResolutionUnavailableError) return { auth: null, status: 'error' }
    return { auth: null, status: 'invalid' }
  }
}

export async function getAuthFromCookies(): Promise<AuthContext> {
  return (await resolveAuthFromCookiesDetailed()).auth
}

export async function resolveAuthFromRequestDetailed(req: Request): Promise<AuthResolution> {
  // Deliberately ahead of the MFA-pending gate below: the envelope carries a context that was
  // already gated by its producer (see `attachTrustedAuthContext`), not raw request credentials.
  const trusted = readTrustedAuthContext(req)
  if (trusted) {
    return {
      auth: trusted.auth,
      status: trusted.status ?? (trusted.auth ? 'authenticated' : 'missing'),
    }
  }
  const cookieHeader = req.headers.get('cookie') || ''
  const tenantCookie = readCookieFromHeader(cookieHeader, TENANT_COOKIE_NAME)
  const orgCookie = readCookieFromHeader(cookieHeader, ORGANIZATION_COOKIE_NAME)
  const authHeader = (req.headers.get('authorization') || '').trim()
  let token: string | undefined
  let hadInvalidInteractiveToken = false
  let hadUnavailableResolution = false
  if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim()
  if (!token) {
    const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (match) token = decodeURIComponent(match[1])
  }
  if (token) {
    try {
      const payload = verifyJwt(token) as AuthContext
      if (payload && payload.type === 'customer') return { auth: null, status: 'invalid' }
      if (payload && isMfaPendingJwtPayload(payload)) {
        // MFA-pending tokens authenticate only the registered challenge-completion routes;
        // everywhere else they resolve to `invalid` so the dispatcher answers 401 (clearing
        // staff auth cookies) instead of restoring the account's roles/features.
        if (!isMfaPendingAccessAllowed(req.method, readRequestPathname(req))) {
          return { auth: null, status: 'invalid' }
        }
      }
      if (payload) {
        const canonicalAuth = await resolveCanonicalInteractiveAuthContext(payload)
        if (canonicalAuth) {
          return {
            auth: applySuperAdminScope(canonicalAuth, tenantCookie, orgCookie),
            status: 'authenticated',
          }
        }
        hadInvalidInteractiveToken = true
      }
    } catch (err) {
      // Transient/unexpected canonical-resolution failures must not invalidate
      // the token — surface them so we return 'error' (retryable) rather than
      // clearing the session cookies.
      if (err instanceof AuthResolutionUnavailableError) hadUnavailableResolution = true
      else hadInvalidInteractiveToken = true
    }
  }

  const resolveUnauthenticatedStatus = (): AuthResolutionStatus =>
    hadUnavailableResolution ? 'error' : hadInvalidInteractiveToken ? 'invalid' : 'missing'

  const apiKey = extractApiKey(req)
  if (!apiKey) {
    return { auth: null, status: resolveUnauthenticatedStatus() }
  }
  let apiAuth: AuthContext
  try {
    apiAuth = await resolveApiKeyAuth(apiKey)
  } catch (err) {
    // Only a transient canonical-resolution failure maps to 'error' (retryable
    // 503), mirroring the interactive-token path above. Anything else is an
    // unexpected bug — rethrow so it surfaces as a 500 rather than being masked
    // as an auth failure.
    if (!(err instanceof AuthResolutionUnavailableError)) {
      throw err
    }
    hadUnavailableResolution = true
    return { auth: null, status: resolveUnauthenticatedStatus() }
  }
  if (!apiAuth) {
    return { auth: null, status: resolveUnauthenticatedStatus() }
  }
  return {
    auth: applySuperAdminScope(apiAuth, tenantCookie, orgCookie),
    status: 'authenticated',
  }
}

export async function getAuthFromRequest(req: Request): Promise<AuthContext> {
  return (await resolveAuthFromRequestDetailed(req)).auth
}
