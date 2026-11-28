import type { EntityManager, EntityName } from '@mikro-orm/core'

/**
 * `attachments` and `notifications` are optional peers of `messages`: their entity
 * metadata (and tables) exist only when the module is enabled in `src/modules.ts`.
 * Messaging checks these before touching either so it keeps working without them
 * (#9201). An entity manager that exposes no metadata (test doubles) is treated as
 * having the module, which keeps the pre-existing behavior.
 */
async function isEntityRegistered(em: EntityManager, loadEntity: () => Promise<EntityName<object>>): Promise<boolean> {
  if (typeof em.getMetadata !== 'function') return true
  const metadata = em.getMetadata()
  if (typeof metadata?.find !== 'function') return true
  return Boolean(metadata.find(await loadEntity()))
}

export function isAttachmentsModuleAvailable(em: EntityManager): Promise<boolean> {
  return isEntityRegistered(em, async () => (await import('@open-mercato/core/modules/attachments/data/entities')).Attachment)
}

export function isNotificationsModuleAvailable(em: EntityManager): Promise<boolean> {
  return isEntityRegistered(em, async () => (await import('@open-mercato/core/modules/notifications/data/entities')).Notification)
}
