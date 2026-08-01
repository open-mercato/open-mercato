import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/core'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  buildCollectionTags,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'
import { Notification } from '../../data/entities'
import { unreadCountResponseSchema } from '../openapi'
import { resolveNotificationContext } from '../../lib/routeHelpers'
import {
  buildNotificationReadScopeWhere,
  getNotificationReadScopeTagOrganizationIds,
} from '../../lib/notificationScope'

export const metadata = {
  GET: { requireAuth: true },
}

const UNREAD_COUNT_RESOURCE = 'notifications.notification'
const UNREAD_COUNT_TTL_MS = 10_000

function buildUnreadCountCacheKey(params: {
  userId: string
  organizationId: string | null
  organizationIds: string[]
}): string {
  const normalizedIds = Array.from(new Set(
    params.organizationIds.filter((value) => value.trim().length > 0),
  )).sort((left, right) => left.localeCompare(right))
  const scopeKey = normalizedIds.length === 0
    ? 'no-access'
    : `${params.organizationId ?? 'none'}:scope=${createHash('sha256')
        .update(normalizedIds.join('\0'))
        .digest('hex')
        .slice(0, 16)}`
  return `notifications:unread-count:u=${params.userId}:org=${scopeKey}`
}

export async function GET(req: Request) {
  const { scope, ctx } = await resolveNotificationContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const userId = scope.userId
  const cacheableOrganizationIds = Array.isArray(scope.organizationIds)
    ? scope.organizationIds
    : null
  // Unrestricted and omitted legacy scopes cannot be safely tagged for invalidation:
  // org-specific writes only invalidate their own collection tag. Keep those scopes
  // uncached rather than serving a stale tenant-wide total until the TTL expires.
  const cache = userId && cacheableOrganizationIds && isCrudCacheEnabled()
    ? resolveCrudCache(ctx.container)
    : null
  const cacheKey = cache && userId && cacheableOrganizationIds
    ? buildUnreadCountCacheKey({
        userId,
        organizationId: scope.organizationId,
        organizationIds: cacheableOrganizationIds,
      })
    : null

  if (cache && cacheKey) {
    try {
      const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(cacheKey))
      if (typeof cached === 'number') {
        return Response.json({ unreadCount: cached })
      }
    } catch {}
  }

  const count = await em.count(Notification, {
    recipientUserId: userId,
    tenantId: scope.tenantId,
    status: 'unread',
    ...buildNotificationReadScopeWhere(scope),
  })

  if (cache && cacheKey) {
    try {
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(cacheKey, count, {
          ttl: UNREAD_COUNT_TTL_MS,
          tags: buildCollectionTags(
            UNREAD_COUNT_RESOURCE,
            scope.tenantId,
            getNotificationReadScopeTagOrganizationIds(scope),
          ),
        }),
      )
    } catch {}
  }

  return Response.json({ unreadCount: count })
}

export const openApi = {
  GET: {
    summary: 'Get unread notification count',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Unread count',
        content: {
          'application/json': {
            schema: unreadCountResponseSchema,
          },
        },
      },
    },
  },
}
