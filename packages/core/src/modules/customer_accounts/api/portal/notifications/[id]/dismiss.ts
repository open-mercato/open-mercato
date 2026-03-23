import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'

export const metadata: { path?: string } = {}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const notification = await em.findOne(Notification, {
    id: params.id,
    recipientUserId: auth.sub,
    tenantId: auth.tenantId,
  })

  if (!notification) {
    return NextResponse.json({ ok: false, error: 'Notification not found' }, { status: 404 })
  }

  notification.status = 'dismissed'
  notification.dismissedAt = new Date()
  await em.flush()

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Dismiss notification',
  description: 'Dismisses a single notification for the authenticated customer user.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Notification dismissed', schema: successSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Notification not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Dismiss customer notification',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { PUT: methodDoc },
}
