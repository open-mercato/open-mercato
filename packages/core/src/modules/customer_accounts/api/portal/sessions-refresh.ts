import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { readCookieFromHeader } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  const cookieHeader = req.headers.get('cookie') || ''
  const sessionToken = readCookieFromHeader(cookieHeader, 'customer_session_token')
  if (!sessionToken) {
    return NextResponse.json({ ok: false, error: 'No session token' }, { status: 401 })
  }

  let decodedToken: string
  try {
    decodedToken = decodeURIComponent(sessionToken)
  } catch {
    decodedToken = sessionToken
  }

  const container = await createRequestContainer()
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService

  const session = await customerSessionService.findByToken(decodedToken)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired session' }, { status: 401 })
  }

  const user = session.user as any
  if (!user || user.deletedAt || !user.isActive) {
    return NextResponse.json({ ok: false, error: 'Account not active' }, { status: 401 })
  }

  const acl = await customerRbacService.loadAcl(user.id, {
    tenantId: user.tenantId,
    organizationId: user.organizationId,
  })

  const result = await customerSessionService.refreshSession(decodedToken, acl.features)
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Session refresh failed' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true, resolvedFeatures: acl.features })

  res.cookies.set('customer_auth_token', result.jwt, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  })

  return res
}

const successSchema = z.object({ ok: z.literal(true), resolvedFeatures: z.array(z.string()) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Refresh customer JWT from session token',
  description: 'Uses the session cookie to issue a fresh JWT access token.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Token refreshed', schema: successSchema }],
  errors: [{ status: 401, description: 'Invalid session', schema: errorSchema }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Refresh customer session',
  methods: { POST: methodDoc },
}
