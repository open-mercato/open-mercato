import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'

export const metadata: { path?: string } = {}

function readCookieFromHeader(header: string | null | undefined, name: string): string | undefined {
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

export async function POST(req: Request) {
  const cookieHeader = req.headers.get('cookie') || ''
  const sessionToken = readCookieFromHeader(cookieHeader, 'customer_session_token')

  if (sessionToken) {
    try {
      const decodedToken = decodeURIComponent(sessionToken)
      const container = await createRequestContainer()
      const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService
      const session = await customerSessionService.findByToken(decodedToken)
      if (session) {
        await customerSessionService.revokeSession(session.id)
      }
    } catch {
      // Best effort — clear cookies regardless
    }
  }

  const res = NextResponse.json({ ok: true })

  res.cookies.set('customer_auth_token', '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })
  res.cookies.set('customer_session_token', '', {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })

  return res
}

const successSchema = z.object({ ok: z.literal(true) })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Customer logout',
  description: 'Revokes the current session and clears authentication cookies.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Logged out', schema: successSchema }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer logout',
  methods: { POST: methodDoc },
}
