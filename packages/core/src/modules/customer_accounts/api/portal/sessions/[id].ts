import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, readCookieFromHeader } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'

export const metadata: { path?: string } = {}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const sessionId = params.id
  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService

  // Verify session belongs to this user
  const session = await em.findOne(CustomerUserSession, {
    id: sessionId,
    user: auth.sub as any,
    deletedAt: null,
  })
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 })
  }

  // Prevent revoking current session
  const cookieHeader = req.headers.get('cookie') || ''
  const sessionToken = readCookieFromHeader(cookieHeader, 'customer_session_token')
  if (sessionToken) {
    try {
      const currentHash = hashToken(decodeURIComponent(sessionToken))
      if (session.tokenHash === currentHash) {
        return NextResponse.json({ ok: false, error: 'Cannot revoke current session. Use logout instead.' }, { status: 400 })
      }
    } catch {
      // Malformed cookie value — proceed with revocation since we can't confirm it's the current session
    }
  }

  await customerSessionService.revokeSession(sessionId)
  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Revoke a customer session',
  description: 'Revokes a specific session (not the current one).',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Session revoked', schema: successSchema }],
  errors: [
    { status: 400, description: 'Cannot revoke current session', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Session not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Revoke customer session',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { DELETE: methodDoc },
}
