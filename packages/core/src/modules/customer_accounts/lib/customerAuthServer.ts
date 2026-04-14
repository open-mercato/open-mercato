/**
 * Server-side customer auth helpers for Next.js server components.
 *
 * Uses the `cookies()` API from `next/headers` to read the customer auth token
 * from cookies — analogous to `getAuthFromCookies()` for staff auth.
 */

import { cookies } from 'next/headers'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CUSTOMER_JWT_AUDIENCE } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import type { CustomerAuthContext } from './customerAuth'

export type { CustomerAuthContext }

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
    return false
  }
}

type UserValidationResult =
  | { valid: false }
  | { valid: true; resolvedFeatures: string[] }

async function validateUserState(
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

/**
 * Read and verify customer auth from cookies in server components.
 *
 * Returns the customer auth context if a valid customer JWT is found,
 * or null if not authenticated.
 *
 * @example
 * ```tsx
 * // In a server component or catch-all route
 * import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'
 *
 * const customerAuth = await getCustomerAuthFromCookies()
 * if (!customerAuth) redirect('/login')
 * ```
 */
export async function getCustomerAuthFromCookies(): Promise<CustomerAuthContext | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('customer_auth_token')?.value
  if (!token) return null

  try {
    const payload = verifyAudienceJwt(CUSTOMER_JWT_AUDIENCE, token) as Record<string, unknown> | null
    if (!payload) return null
    if (payload.type !== 'customer') return null
    const sid = typeof payload.sid === 'string' ? payload.sid : ''
    if (!sid) return null
    const stillActive = await assertSessionStillActive(sid)
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
