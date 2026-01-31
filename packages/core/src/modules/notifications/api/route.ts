import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/core'
import { Notification } from '../data/entities'
import { listNotificationsSchema, createNotificationSchema } from '../data/validators'
import { toNotificationDto } from '../lib/notificationMapper'
import { resolveNotificationContext } from '../lib/routeHelpers'
import {
  buildNotificationsCrudOpenApi,
  createPagedListResponseSchema,
  notificationItemSchema,
} from './openapi'

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveNotificationContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const url = new URL(req.url)
  const queryParams = Object.fromEntries(url.searchParams.entries())
  const input = listNotificationsSchema.parse(queryParams)

  const filters: Record<string, unknown> = {
    recipientUserId: scope.userId,
    tenantId: scope.tenantId,
  }

  if (input.status) {
    filters.status = Array.isArray(input.status) ? { $in: input.status } : input.status
  } else {
    filters.status = { $ne: 'dismissed' }
  }
  if (input.type) {
    filters.type = input.type
  }
  if (input.severity) {
    filters.severity = input.severity
  }
  if (input.sourceEntityType) {
    filters.sourceEntityType = input.sourceEntityType
  }
  if (input.sourceEntityId) {
    filters.sourceEntityId = input.sourceEntityId
  }
  if (input.since) {
    filters.createdAt = { $gt: new Date(input.since) }
  }

  const [notifications, total] = await Promise.all([
    em.find(Notification, filters, {
      orderBy: { createdAt: 'desc' },
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }),
    em.count(Notification, filters),
  ])

  const items = notifications.map(toNotificationDto)

  return Response.json({
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  })
}

export async function POST(req: Request) {
  const { service, scope } = await resolveNotificationContext(req)

  const body = await req.json().catch(() => ({}))
  const input = createNotificationSchema.parse(body)

  const notification = await service.create(input, scope)

  return Response.json({ id: notification.id }, { status: 201 })
}

export const openApi = buildNotificationsCrudOpenApi({
  resourceName: 'Notification',
  querySchema: listNotificationsSchema,
  listResponseSchema: createPagedListResponseSchema(notificationItemSchema),
  create: {
    schema: createNotificationSchema,
    responseSchema: z.object({ id: z.string().uuid() }),
    description: 'Creates a notification for a user.',
  },
})
