import { NextResponse } from 'next/server'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
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

async function isSessionRevoked(sub: string, iat: unknown): Promise<boolean> {
  const [{ createRequestContainer }, { CustomerUser }] = await Promise.all([
    import('@open-mercato/shared/lib/di/container'),
    import('@open-mercato/core/modules/customer_accounts/data/entities'),
  ])
  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const user = await findOneWithDecryption(em, CustomerUser, { id: sub }, { fields: ['sessionsRevokedAt'] })
  if (!user) return true
  if (!user.sessionsRevokedAt || typeof iat !== 'number') return false
  return iat * 1000 < user.sessionsRevokedAt.getTime()
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
    const payload = verifyAudienceJwt(CUSTOMER_JWT_AUDIENCE, token) as Record<string, unknown> | null
    if (!payload) return null
    if (payload.type !== 'customer') return null
    const sid = typeof payload.sid === 'string' ? payload.sid : ''
    if (!sid) return null
    const stillActive = await assertSessionStillActive(sid)
    if (!stillActive) return null

    try {
      if (await isSessionRevoked(String(payload.sub), payload.iat)) return null
    } catch {
      return null
    }

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
      resolvedFeatures: Array.isArray(payload.resolvedFeatures) ? payload.resolvedFeatures as string[] : [],
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
