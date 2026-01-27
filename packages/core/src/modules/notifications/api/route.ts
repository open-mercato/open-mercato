import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { EntityManager } from '@mikro-orm/core'
import { Notification } from '../data/entities'
import { listNotificationsSchema, createNotificationSchema } from '../data/validators'
import { resolveNotificationService } from '../lib/notificationService'
import { toNotificationDto } from '../lib/notificationMapper'
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
  const { ctx } = await resolveRequestContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const url = new URL(req.url)
  const queryParams = Object.fromEntries(url.searchParams.entries())
  const input = listNotificationsSchema.parse(queryParams)

  const filters: Record<string, unknown> = {
    recipientUserId: ctx.auth?.sub,
    tenantId: ctx.auth?.tenantId,
  }

  if (input.status) {
    filters.status = Array.isArray(input.status) ? { $in: input.status } : input.status
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
  const { ctx } = await resolveRequestContext(req)
  const notificationService = resolveNotificationService(ctx.container)

  const body = await req.json().catch(() => ({}))
  const input = createNotificationSchema.parse(body)

  const notification = await notificationService.create(input, {
    tenantId: ctx.auth?.tenantId ?? '',
    organizationId: ctx.selectedOrganizationId ?? null,
    userId: ctx.auth?.sub ?? null,
  })

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
