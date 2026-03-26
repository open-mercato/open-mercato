import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { toNotificationDto } from '@open-mercato/core/modules/notifications/lib/notificationMapper'

export const metadata: { path?: string } = {}

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const rawPageSize = parseInt(url.searchParams.get('pageSize') || '50', 10) || 50
  const pageSize = Math.min(Math.max(1, rawPageSize), 100)
  const status = url.searchParams.get('status') || undefined
  const since = url.searchParams.get('since') || undefined

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const where: Record<string, unknown> = {
    recipientUserId: auth.sub,
    tenantId: auth.tenantId,
  }

  if (status) {
    where.status = status
  } else {
    where.status = { $ne: 'dismissed' }
  }

  if (since) {
    const sinceDate = new Date(since)
    if (!isNaN(sinceDate.getTime())) {
      where.createdAt = { $gte: sinceDate }
    }
  }

  const offset = (page - 1) * pageSize

  const [items, total] = await Promise.all([
    em.find(Notification, where, {
      orderBy: { createdAt: 'DESC' },
      limit: pageSize,
      offset,
    }),
    em.count(Notification, where),
  ])

  return NextResponse.json({
    ok: true,
    items: items.map(toNotificationDto),
    total,
    page,
    pageSize,
  })
}

const notificationDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  titleKey: z.string().nullable().optional(),
  bodyKey: z.string().nullable().optional(),
  titleVariables: z.record(z.string(), z.string()).nullable().optional(),
  bodyVariables: z.record(z.string(), z.string()).nullable().optional(),
  icon: z.string().nullable().optional(),
  severity: z.enum(['info', 'warning', 'success', 'error']),
  status: z.enum(['unread', 'read', 'actioned', 'dismissed']),
  actions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    labelKey: z.string().optional(),
    variant: z.string().optional(),
    icon: z.string().optional(),
  })),
  primaryActionId: z.string().optional(),
  sourceModule: z.string().nullable().optional(),
  sourceEntityType: z.string().nullable().optional(),
  sourceEntityId: z.string().nullable().optional(),
  linkHref: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
  actionTaken: z.string().nullable().optional(),
})

const listResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(notificationDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'List customer notifications',
  description: 'Returns paginated notifications for the authenticated customer user. Dismissed notifications are excluded by default unless ?status=dismissed is specified.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Notification list', schema: listResponseSchema }],
  errors: [{ status: 401, description: 'Not authenticated', schema: errorSchema }],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer notifications',
  methods: { GET: methodDoc },
}
