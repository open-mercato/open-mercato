/**
 * Server-side customer auth helpers for Next.js server components.
 *
 * Uses the `cookies()` API from `next/headers` to read the customer auth token
 * from cookies — analogous to `getAuthFromCookies()` for staff auth.
 */

import { cookies } from 'next/headers'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { CustomerAuthContext } from './customerAuth'

export type { CustomerAuthContext }

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
    const payload = verifyJwt(token) as Record<string, unknown> | null
    if (!payload) return null
    if (payload.type !== 'customer') return null

    return {
      sub: String(payload.sub),
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
