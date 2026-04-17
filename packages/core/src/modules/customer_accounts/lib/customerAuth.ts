import { NextResponse } from 'next/server'
import { verifyAudienceJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CUSTOMER_JWT_AUDIENCE } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'

export interface CustomerAuthContext {
  sub: string
  sid: string
  type: 'customer'
  tenantId: string
  orgId: string
  email: string
  displayName: string
  customerEntityId?: string | null
  personEntityId?: string | null
  resolvedFeatures: string[]
}

async function assertSessionStillActive(sessionId: string): Promise<boolean> {
  try {
    const [{ createRequestContainer }, { CustomerSessionService }] = await Promise.all([
      import('@open-mercato/shared/lib/di/container'),
      import('@open-mercato/core/modules/customer_accounts/services/customerSessionService'),
    ])
    const container = await createRequestContainer()
    const service = container.resolve('customerSessionService') as InstanceType<typeof CustomerSessionService>
    const session = await service.findActiveSessionById(sessionId)
    return session !== null
  } catch {
    // Fail closed: if we cannot verify the session, treat the token as revoked to prevent
    // replay of leaked JWTs when the backend is partially degraded.
    return false
  }
}

export function readCookieFromHeader(header: string | null | undefined, name: string): string | undefined {
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

export type UserValidationResult =
  | { valid: false }
  | { valid: true; resolvedFeatures: string[] }

export async function validateUserState(
  sub: string,
  tenantId: string,
  orgId: string,
  iat: unknown,
): Promise<UserValidationResult> {
  const [{ createRequestContainer }, { CustomerUser }] = await Promise.all([
    import('@open-mercato/shared/lib/di/container'),
    import('@open-mercato/core/modules/customer_accounts/data/entities'),
  ])
  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const user = await findOneWithDecryption(em, CustomerUser, { id: sub }, {
    fields: ['sessionsRevokedAt', 'deletedAt', 'isActive'],
  })
  if (!user) return { valid: false }
  if (user.deletedAt) return { valid: false }
  if (!user.isActive) return { valid: false }
  if (user.sessionsRevokedAt && typeof iat === 'number' && iat * 1000 < user.sessionsRevokedAt.getTime()) {
    return { valid: false }
  }

  const { CustomerRbacService } = await import(
    '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
  )
  const rbac = container.resolve('customerRbacService') as InstanceType<typeof CustomerRbacService>
  const acl = await rbac.loadAcl(sub, { tenantId, organizationId: orgId })
  return { valid: true, resolvedFeatures: acl.isPortalAdmin ? ['*'] : acl.features }
}

export async function getCustomerAuthFromRequest(req: Request): Promise<CustomerAuthContext | null> {
  const cookieHeader = req.headers.get('cookie') || ''
  const authHeader = (req.headers.get('authorization') || '').trim()

  let token: string | undefined
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim()
  }
  if (!token) {
    const cookieValue = readCookieFromHeader(cookieHeader, 'customer_auth_token')
    if (cookieValue) {
      try {
        token = decodeURIComponent(cookieValue)
      } catch {
        // Malformed percent-encoding; use raw value
        token = cookieValue
      }
    }
  }
  if (!token) return null

  try {
    let payload = verifyAudienceJwt(CUSTOMER_JWT_AUDIENCE, token) as Record<string, unknown> | null
    // Legacy fallback: try raw JWT_SECRET for pre-migration customer tokens
    if (!payload) {
      payload = verifyJwt(token) as Record<string, unknown> | null
      if (payload) payload._legacyToken = true
    }
    if (!payload) return null
    if (payload.type !== 'customer') return null
    const sid = typeof payload.sid === 'string' ? payload.sid : ''
    if (!sid && payload._legacyToken !== true) return null
    const stillActive = sid ? await assertSessionStillActive(sid) : true
    if (!stillActive) return null

    const userState = await validateUserState(
      String(payload.sub),
      String(payload.tenantId),
      String(payload.orgId),
      payload.iat,
    )
    if (!userState.valid) return null

    return {
      sub: String(payload.sub),
      sid,
      type: 'customer',
      tenantId: String(payload.tenantId),
      orgId: String(payload.orgId),
      email: String(payload.email || ''),
      displayName: String(payload.displayName || ''),
      customerEntityId: payload.customerEntityId ? String(payload.customerEntityId) : null,
      personEntityId: payload.personEntityId ? String(payload.personEntityId) : null,
      resolvedFeatures: userState.resolvedFeatures,
    }
  } catch {
    // Invalid or expired JWT — treat as unauthenticated
    return null
  }
}

export async function requireCustomerAuth(req: Request): Promise<CustomerAuthContext> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    throw NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  return auth
}

export async function requireCustomerFeature(
  auth: CustomerAuthContext,
  features: string[],
  rbac: CustomerRbacService,
): Promise<void> {
  if (!features.length) return
  const ok = await rbac.userHasAllFeatures(
    auth.sub,
    features,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )
  if (!ok) {
    throw NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }
}
