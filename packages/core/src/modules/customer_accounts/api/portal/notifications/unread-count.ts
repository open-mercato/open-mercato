import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'

export const metadata: { path?: string } = {}

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const unreadCount = await em.count(Notification, {
    recipientUserId: auth.sub,
    tenantId: auth.tenantId,
    status: 'unread',
  })

  return NextResponse.json({ ok: true, unreadCount })
}

const successSchema = z.object({
  ok: z.literal(true),
  unreadCount: z.number(),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Get unread notification count',
  description: 'Returns the number of unread notifications for the authenticated customer user.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Unread count', schema: successSchema }],
  errors: [{ status: 401, description: 'Not authenticated', schema: errorSchema }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer unread notification count',
  methods: { GET: methodDoc },
}
