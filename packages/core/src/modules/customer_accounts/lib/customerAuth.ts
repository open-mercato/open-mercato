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
  isPortalAdmin?: boolean
}

async function resolveSessionService(): Promise<
  InstanceType<typeof import('@open-mercato/core/modules/customer_accounts/services/customerSessionService').CustomerSessionService>
> {
  const [{ createRequestContainer }, { CustomerSessionService }] = await Promise.all([
    import('@open-mercato/shared/lib/di/container'),
    import('@open-mercato/core/modules/customer_accounts/services/customerSessionService'),
  ])
  const container = await createRequestContainer()
  return container.resolve('customerSessionService') as InstanceType<typeof CustomerSessionService>
}

async function assertSessionStillActive(input: {
  sessionId: string
  userId: string
  tenantId: string
  organizationId: string
}): Promise<boolean> {
  try {
    const service = await resolveSessionService()
    const session = await service.findActiveSessionForClaims(input)
    return session !== null
  } catch {
    // Fail closed: if we cannot verify the session, treat the token as revoked to prevent
    // replay of leaked JWTs when the backend is partially degraded.
    return false
  }
}

/**
 * Liveness re-check for a legacy token that carries no `sid` claim. It cannot name the session it
 * was issued for, so the check falls back to the strongest available statement: the customer must
 * still be signed in somewhere. Once every session is revoked — logout, per-device revoke, admin
 * action — the token stops authenticating instead of surviving until its own expiry.
 */
async function assertUserStillHasActiveSession(input: {
  userId: string
  tenantId: string
  organizationId: string
}): Promise<boolean> {
  try {
    const service = await resolveSessionService()
    return await service.hasActiveSessionForUser(input)
  } catch {
    // Same fail-closed contract as the sid-bound check above.
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
  | { valid: true; resolvedFeatures: string[]; isPortalAdmin: boolean }

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
  const resolvedFeatures = await rbac.getEffectiveFeatures(sub, {
    tenantId,
    organizationId: orgId,
  })
  return { valid: true, resolvedFeatures, isPortalAdmin: acl.isPortalAdmin }
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
    // Legacy fallback: accept a pre-migration customer token signed with the raw JWT_SECRET, but
    // only while `verifyJwt` itself still considers it legacy — it owns the grace window (token
    // `iat` vs JWT_LEGACY_GRACE_MINUTES / JWT_LEGACY_CUTOVER_AT) and marks the payload. Trusting
    // the bare return value would also let a staff-audience token through this branch, because
    // the default `verifyJwt` path verifies against the staff-derived key.
    if (!payload) {
      const legacyPayload = verifyJwt(token) as Record<string, unknown> | null
      if (legacyPayload && legacyPayload._legacyToken === true) payload = legacyPayload
    }
    if (!payload) return null
    if (payload.type !== 'customer') return null
    const sid = typeof payload.sid === 'string' ? payload.sid : ''
    if (!sid && payload._legacyToken !== true) return null
    const userId = String(payload.sub)
    const tenantId = String(payload.tenantId)
    const organizationId = String(payload.orgId)
    // Every accepted token is re-checked for liveness, exactly like the SSR path does — a token
    // without a `sid` is checked against the customer's remaining sessions rather than skipped,
    // so session revocation is never structurally unreachable on the API path.
    const stillActive = sid
      ? await assertSessionStillActive({
          sessionId: sid,
          userId,
          tenantId,
          organizationId,
        })
      : await assertUserStillHasActiveSession({ userId, tenantId, organizationId })
    if (!stillActive) return null

    const userState = await validateUserState(
      userId,
      tenantId,
      organizationId,
      payload.iat,
    )
    if (!userState.valid) return null

    return {
      sub: userId,
      sid,
      type: 'customer',
      tenantId,
      orgId: organizationId,
      email: String(payload.email || ''),
      displayName: String(payload.displayName || ''),
      customerEntityId: payload.customerEntityId ? String(payload.customerEntityId) : null,
      personEntityId: payload.personEntityId ? String(payload.personEntityId) : null,
      resolvedFeatures: userState.resolvedFeatures,
      isPortalAdmin: userState.isPortalAdmin,
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
