import { cookies } from 'next/headers.js'
import type { EntityManager } from '@mikro-orm/postgresql'
import { verifyJwt } from './jwt'

const TENANT_COOKIE_NAME = 'om_selected_tenant'
const ORGANIZATION_COOKIE_NAME = 'om_selected_org'
const ALL_ORGANIZATIONS_COOKIE_VALUE = '__all__'
const SUPERADMIN_ROLE = 'superadmin'

export type AuthContext = {
  sub: string
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
type AuthResolutionStatus = 'authenticated' | 'missing' | 'invalid'
type AuthResolution = {
  auth: AuthContext
  status: AuthResolutionStatus
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

function resolveTenantOverride(raw: string | undefined): CookieOverride {
  if (raw === undefined) return { applied: false, value: null }
  const decoded = decodeCookieValue(raw)
  if (!decoded) return { applied: true, value: null }
  const trimmed = decoded.trim()
  if (!trimmed) return { applied: true, value: null }
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
  if ((auth as Record<string, unknown>).isSuperAdmin === true) return true
  const roles = Array.isArray(auth?.roles) ? auth.roles : []
  return roles.some((role) => typeof role === 'string' && role.trim().toLowerCase() === SUPERADMIN_ROLE)
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
  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    const { findApiKeyBySecret } = await import('@open-mercato/core/modules/api_keys/services/apiKeyService')
    const { Role, User } = await import('@open-mercato/core/modules/auth/data/entities')
    const { Organization, Tenant } = await import('@open-mercato/core/modules/directory/data/entities')

    const record = await findApiKeyBySecret(em, secret)
    if (!record) return null

    const roleIds = Array.isArray(record.rolesJson)
      ? record.rolesJson.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : []
    const roles = roleIds.length
      ? await em.find(Role, { id: { $in: roleIds }, deletedAt: null })
      : []
    const roleNames = roles.map((role) => role.name).filter((name): name is string => typeof name === 'string' && name.length > 0)

    try {
      record.lastUsedAt = new Date()
      await em.persistAndFlush(record)
    } catch {
      // best-effort update; ignore write failures
    }

    // For session keys, use sessionUserId; for regular keys, use createdBy
    const actualUserId = record.sessionUserId ?? record.createdBy ?? null

    if (actualUserId) {
      const user = await em.findOne(User, { id: actualUserId, deletedAt: null })
      if (!user) return null
      if ((user.tenantId ?? null) !== (record.tenantId ?? null)) return null
      if ((user.organizationId ?? null) !== (record.organizationId ?? null)) return null
    } else {
      if (record.tenantId) {
        const tenant = await em.findOne(Tenant, { id: record.tenantId, deletedAt: null, isActive: true })
        if (!tenant) return null
      }
      if (record.organizationId) {
        const organization = await em.findOne(Organization, { id: record.organizationId, deletedAt: null, isActive: true })
        if (!organization) return null
        if (record.tenantId && String(organization.tenant.id) !== record.tenantId) return null
      }
    }

    return {
      sub: `api_key:${record.id}`,
      tenantId: record.tenantId ?? null,
      orgId: record.organizationId ?? null,
      roles: roleNames,
      isApiKey: true,
      keyId: record.id,
      keyName: record.name,
      ...(actualUserId ? { userId: actualUserId } : {}),
    }
  } catch {
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
  } catch {
    return null
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
    const canonicalAuth = await resolveCanonicalInteractiveAuthContext(payload)
    if (!canonicalAuth) return { auth: null, status: 'invalid' }
    const tenantCookie = cookieStore.get(TENANT_COOKIE_NAME)?.value
    const orgCookie = cookieStore.get(ORGANIZATION_COOKIE_NAME)?.value
    return {
      auth: applySuperAdminScope(canonicalAuth, tenantCookie, orgCookie),
      status: 'authenticated',
    }
  } catch {
    return { auth: null, status: 'invalid' }
  }
}

export async function getAuthFromCookies(): Promise<AuthContext> {
  return (await resolveAuthFromCookiesDetailed()).auth
}

export async function resolveAuthFromRequestDetailed(req: Request): Promise<AuthResolution> {
  const cookieHeader = req.headers.get('cookie') || ''
  const tenantCookie = readCookieFromHeader(cookieHeader, TENANT_COOKIE_NAME)
  const orgCookie = readCookieFromHeader(cookieHeader, ORGANIZATION_COOKIE_NAME)
  const authHeader = (req.headers.get('authorization') || '').trim()
  let token: string | undefined
  let hadInvalidInteractiveToken = false
  if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim()
  if (!token) {
    const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (match) token = decodeURIComponent(match[1])
  }
  if (token) {
    try {
      const payload = verifyJwt(token) as AuthContext
      if (payload && payload.type === 'customer') return { auth: null, status: 'invalid' }
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
    } catch {
      hadInvalidInteractiveToken = true
    }
  }

  const apiKey = extractApiKey(req)
  if (!apiKey) {
    return { auth: null, status: hadInvalidInteractiveToken ? 'invalid' : 'missing' }
  }
  const apiAuth = await resolveApiKeyAuth(apiKey)
  if (!apiAuth) {
    return { auth: null, status: hadInvalidInteractiveToken ? 'invalid' : 'missing' }
  }
  return {
    auth: applySuperAdminScope(apiAuth, tenantCookie, orgCookie),
    status: 'authenticated',
  }
}

export async function getAuthFromRequest(req: Request): Promise<AuthContext> {
  return (await resolveAuthFromRequestDetailed(req)).auth
}
