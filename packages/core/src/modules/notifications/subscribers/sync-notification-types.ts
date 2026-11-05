import type { EntityManager } from '@mikro-orm/postgresql'
import { TYPE_REGISTRY_SYNC_EVENT } from '../events'
import { syncNotificationTypes } from '../lib/notification-type-registry'

export const metadata = {
  event: TYPE_REGISTRY_SYNC_EVENT,
  persistent: true,
  id: 'notifications:sync-notification-types',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(_payload: unknown, ctx: ResolverContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  await syncNotificationTypes(em, { force: true })
}
