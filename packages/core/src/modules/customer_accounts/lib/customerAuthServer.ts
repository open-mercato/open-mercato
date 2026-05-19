/**
 * Server-side customer auth helpers for Next.js server components.
 *
 * Uses the `cookies()` API from `next/headers` to read the customer auth token
 * from cookies — analogous to `getAuthFromCookies()` for staff auth.
 */

import { cookies } from 'next/headers'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { CUSTOMER_JWT_AUDIENCE, CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'
import { tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import { platformDomains } from '@open-mercato/core/modules/customer_accounts/lib/platformDomains'
import { validateUserState } from './customerAuth'
import type { CustomerAuthContext } from './customerAuth'

export type { CustomerAuthContext }

async function assertSessionStillActive(sessionId: string): Promise<boolean> {
  try {
    const container = await createRequestContainer()
    const service = container.resolve('customerSessionService') as InstanceType<typeof CustomerSessionService>
    const session = await service.findActiveSessionById(sessionId)
    return session !== null
  } catch {
    return false
  }
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
export async function getCustomerAuthFromCookies(
  options?: { expectedTenantId?: string },
): Promise<CustomerAuthContext | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('customer_auth_token')?.value
  if (!token) return null

  try {
    const payload = verifyAudienceJwt(CUSTOMER_JWT_AUDIENCE, token) as Record<string, unknown> | null
    if (!payload) return null
    if (payload.type !== 'customer') return null
    const sid = typeof payload.sid === 'string' ? payload.sid : ''
    if (!sid) return null
    const tenantId = String(payload.tenantId)
    if (options?.expectedTenantId && options.expectedTenantId !== tenantId) {
      // Cross-host JWT replay defense. See spec rev 5 Customer Authentication
      // section: the host-resolved tenant is the authoritative scope; mismatched
      // JWTs are rejected as if unauthenticated.
      return null
    }
    const stillActive = await assertSessionStillActive(sid)
    if (!stillActive) return null

    const userState = await validateUserState(
      String(payload.sub),
      tenantId,
      String(payload.orgId),
      payload.iat,
    )
    if (!userState.valid) return null

    return {
      sub: String(payload.sub),
      sid,
      type: 'customer',
      tenantId,
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

/**
 * Convenience wrapper for custom-domain pages: resolves the host, calls
 * getCustomerAuthFromCookies with the host-resolved tenant as expectedTenantId.
 *
 * Use from server components rendered under custom domains.
 */
export async function getCustomerAuthForHost(
  host: string | null | undefined,
): Promise<CustomerAuthContext | null> {
  if (!host) return getCustomerAuthFromCookies()

  try {
    const hostname = tryNormalizeHostname(host)
    if (!hostname) return getCustomerAuthFromCookies()
    if (platformDomains().includes(hostname)) return getCustomerAuthFromCookies()

    const container = await createRequestContainer()
    const service = container.resolve('domainMappingService') as InstanceType<typeof DomainMappingService>
    const resolved = await service.resolveByHostname(hostname)
    if (!resolved || resolved.status !== 'active') return null
    return getCustomerAuthFromCookies({ expectedTenantId: resolved.tenantId })
  } catch (err) {
    console.warn('[customer_accounts] getCustomerAuthForHost: domain resolve failed; falling back to platform cookie', err)
    return getCustomerAuthFromCookies()
  }
}
