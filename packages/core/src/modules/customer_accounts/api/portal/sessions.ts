import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, readCookieFromHeader } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'

export const metadata: { path?: string } = {}

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const sessions = await em.find(CustomerUserSession, {
    user: auth.sub as any,
    deletedAt: null,
    expiresAt: { $gt: new Date() },
  }, { orderBy: { createdAt: 'DESC' } })

  // Determine current session
  const cookieHeader = req.headers.get('cookie') || ''
  const sessionToken = readCookieFromHeader(cookieHeader, 'customer_session_token')
  let currentSessionHash: string | null = null
  if (sessionToken) {
    try {
      currentSessionHash = hashToken(decodeURIComponent(sessionToken))
    } catch {
      currentSessionHash = hashToken(sessionToken)
    }
  }

  const items = sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastUsedAt: s.lastUsedAt,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: currentSessionHash ? s.tokenHash === currentSessionHash : false,
  }))

  return NextResponse.json({ ok: true, sessions: items })
}

const sessionSchema = z.object({
  id: z.string().uuid(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  isCurrent: z.boolean(),
})

const methodDoc: OpenApiMethodDoc = {
  summary: 'List customer sessions',
  description: 'Returns active sessions for the authenticated customer user.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Session list', schema: z.object({ ok: z.literal(true), sessions: z.array(sessionSchema) }) }],
  errors: [{ status: 401, description: 'Not authenticated', schema: z.object({ ok: z.literal(false), error: z.string() }) }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer sessions',
  methods: { GET: methodDoc },
}
