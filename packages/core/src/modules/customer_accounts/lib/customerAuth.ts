import { NextResponse } from 'next/server'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

export interface CustomerAuthContext {
  sub: string
  type: 'customer'
  tenantId: string
  orgId: string
  email: string
  displayName: string
  customerEntityId?: string | null
  personEntityId?: string | null
  resolvedFeatures: string[]
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

export async function requireCustomerAuth(req: Request): Promise<CustomerAuthContext> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    throw NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  return auth
}

export function requireCustomerFeature(auth: CustomerAuthContext, features: string[]): void {
  if (!features.length) return
  if (!hasAllFeatures(features, auth.resolvedFeatures)) {
    throw NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }
}
