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

export const metadata = {
  GET: { requireAuth: true },
}

const UNREAD_COUNT_RESOURCE = 'notifications.notification'
const UNREAD_COUNT_TTL_MS = 10_000

function buildUnreadCountCacheKey(userId: string): string {
  return `notifications:unread-count:u=${userId}`
}

export async function GET(req: Request) {
  const { scope, ctx } = await resolveNotificationContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const userId = scope.userId
  const cache = userId && isCrudCacheEnabled() ? resolveCrudCache(ctx.container) : null
  const cacheKey = cache && userId ? buildUnreadCountCacheKey(userId) : null

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
  })

  if (cache && cacheKey) {
    try {
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(cacheKey, count, {
          ttl: UNREAD_COUNT_TTL_MS,
          tags: buildCollectionTags(UNREAD_COUNT_RESOURCE, scope.tenantId, [null]),
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
