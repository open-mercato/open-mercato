import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'

export const metadata: { path?: string } = {}

export async function PUT(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const now = new Date()
  const count = await em.nativeUpdate(Notification, {
    recipientUserId: auth.sub,
    tenantId: auth.tenantId,
    status: 'unread',
  }, {
    status: 'read',
    readAt: now,
  })

  return NextResponse.json({ ok: true, count })
}

const successSchema = z.object({
  ok: z.literal(true),
  count: z.number(),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Mark all notifications as read',
  description: 'Marks all unread notifications as read for the authenticated customer user.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'All notifications marked as read', schema: successSchema }],
  errors: [{ status: 401, description: 'Not authenticated', schema: errorSchema }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Mark all customer notifications as read',
  methods: { PUT: methodDoc },
}
