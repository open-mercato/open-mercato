import type { EntityManager } from '@mikro-orm/core'

type Resolver = { resolve: <T = unknown>(name: string) => T }

/**
 * `notifications` is an optional peer of record_locks: its entity metadata exists only when the
 * module is enabled in `src/modules.ts` (#9205). Subscribers skip delivery when it is absent and
 * otherwise let delivery failures propagate so the persistent event handler can retry.
 */
export async function isNotificationsModuleAvailable(ctx: Resolver): Promise<boolean> {
  const em = ctx.resolve<EntityManager>('em')
  const { Notification } = await import('@open-mercato/core/modules/notifications/data/entities')
  return Boolean(em.getMetadata().find(Notification))
}
