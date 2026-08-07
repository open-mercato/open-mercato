import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/core'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  buildCollectionTags,
  debugCrudCache,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'
import { Notification } from '../data/entities'
import { listNotificationsSchema, createNotificationSchema } from '../data/validators'
import { toNotificationDto } from '../lib/notificationMapper'
import { inAppVisibleFilter } from '../lib/notificationVisibility'
import {
  buildNotificationReadScopeWhere,
  getNotificationReadScopeTagOrganizationIds,
} from '../lib/notificationScope'
import {
  NOTIFICATION_RESOURCE_KIND,
  notificationCrudErrorResponse,
  notificationValidationErrorResponse,
  resolveNotificationContext,
  runGuardedNotificationWrite,
} from '../lib/routeHelpers'
import {
  buildNotificationsCrudOpenApi,
  createPagedListResponseSchema,
  notificationItemSchema,
} from './openapi'

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

const NOTIFICATIONS_LIST_TTL_MS = 10_000
// v2: the key gained the selected-organization scope (#4840). Bumping the version
// retires v1 entries, which were shared across organizations for the same user.
const NOTIFICATIONS_LIST_CACHE_VERSION = 2
const NOTIFICATIONS_LIST_RESOURCE = 'notifications.notification'

type NotificationsListPayload = {
  items: ReturnType<typeof toNotificationDto>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function buildNotificationsListCacheKey(
  userId: string,
  organizationScope: { organizationId: string | null; organizationIds: string[] },
  input: z.infer<typeof listNotificationsSchema>,
): string {
  const normalizedIds = Array.from(new Set(
    organizationScope.organizationIds.filter((value) => value.trim().length > 0),
  )).sort((left, right) => left.localeCompare(right))
  const scopeKey = normalizedIds.length === 0
    ? 'no-access'
    : `${organizationScope.organizationId ?? 'none'}:scope=${createHash('sha256')
        .update(normalizedIds.join('\0'))
        .digest('hex')
        .slice(0, 16)}`
  const filterSignature = JSON.stringify({
    status: Array.isArray(input.status)
      ? [...input.status].sort((left, right) => left.localeCompare(right))
      : input.status ?? null,
    type: input.type ?? null,
    severity: input.severity ?? null,
    sourceEntityType: input.sourceEntityType ?? null,
    sourceEntityId: input.sourceEntityId ?? null,
    since: input.since ?? null,
    page: input.page,
    pageSize: input.pageSize,
  })
  return `notifications:list:v${NOTIFICATIONS_LIST_CACHE_VERSION}:u=${userId}:org=${scopeKey}:filters=${filterSignature}`
}

function isNotificationsListPayload(value: unknown): value is NotificationsListPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<NotificationsListPayload>
  return (
    Array.isArray(payload.items)
    && typeof payload.total === 'number'
    && typeof payload.page === 'number'
    && typeof payload.pageSize === 'number'
    && typeof payload.totalPages === 'number'
  )
}

export async function GET(req: Request) {
  const { ctx, scope } = await resolveNotificationContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const url = new URL(req.url)
  const queryParams = Object.fromEntries(url.searchParams.entries())
  const input = listNotificationsSchema.parse(queryParams)
  const userId = scope.userId
  // Mirrors api/unread-count/route.ts: unrestricted and omitted legacy organization
  // scopes cannot be safely tagged for invalidation, because organization-specific
  // writes only invalidate their own collection tag. Leave those scopes uncached
  // rather than serving a stale tenant-wide list until the TTL expires.
  const cacheableOrganizationIds = Array.isArray(scope.organizationIds)
    ? scope.organizationIds
    : null
  const cache = userId && cacheableOrganizationIds && isCrudCacheEnabled()
    ? resolveCrudCache(ctx.container)
    : null
  const cacheKey = cache && userId && cacheableOrganizationIds
    ? buildNotificationsListCacheKey(
        userId,
        { organizationId: scope.organizationId, organizationIds: cacheableOrganizationIds },
        input,
      )
    : null

  if (cache && cacheKey) {
    try {
      const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(cacheKey))
      if (isNotificationsListPayload(cached)) {
        return Response.json(cached)
      }
    } catch (error) {
      debugCrudCache('notifications-list-cache-read-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const filters: Record<string, unknown> = {
    recipientUserId: userId,
    tenantId: scope.tenantId,
    // Read scope AND in-app visibility: both fragments carry their own `$or`, so they must be
    // AND-composed instead of spread (a spread would silently drop one of them).
    // Hidden rows are those not delivered to the in-app channel (push-only / opted-out); they remain as records.
    $and: [
      buildNotificationReadScopeWhere(scope),
      inAppVisibleFilter(),
    ],
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

  const payload: NotificationsListPayload = {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  }

  if (cache && cacheKey) {
    try {
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(cacheKey, payload, {
          ttl: NOTIFICATIONS_LIST_TTL_MS,
          tags: buildCollectionTags(
            NOTIFICATIONS_LIST_RESOURCE,
            scope.tenantId,
            getNotificationReadScopeTagOrganizationIds(scope),
          ),
        }),
      )
    } catch (error) {
      debugCrudCache('notifications-list-cache-write-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return Response.json(payload)
}

export async function POST(req: Request) {
  const { service, scope, ctx } = await resolveNotificationContext(req)

  const body = await req.json().catch(() => ({}))
  const parsed = createNotificationSchema.safeParse(body)
  if (!parsed.success) {
    return notificationValidationErrorResponse(parsed.error)
  }

  try {
    const guarded = await runGuardedNotificationWrite(
      ctx.container,
      scope,
      req,
      {
        resourceKind: NOTIFICATION_RESOURCE_KIND,
        operation: 'create',
        payload: parsed.data as Record<string, unknown>,
      },
      () => service.create(parsed.data, scope),
    )
    if (!guarded.ok) return guarded.response

    return Response.json({ id: guarded.result.id }, { status: 201 })
  } catch (error) {
    const errorResponse = notificationCrudErrorResponse(error)
    if (errorResponse) return errorResponse
    throw error
  }
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
