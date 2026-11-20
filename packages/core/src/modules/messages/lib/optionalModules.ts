import type { EntityManager } from '@mikro-orm/core'

type MetadataProbe = { has?: (entity: unknown) => boolean }

/**
 * `attachments` and `notifications` are optional peers of `messages`: their entity
 * metadata (and tables) exist only when the module is enabled in `src/modules.ts`.
 * Messaging checks these before touching either so it keeps working without them
 * (#9201). An entity manager that exposes no metadata (test doubles) is treated as
 * having the module, which keeps the pre-existing behavior.
 */
async function isEntityRegistered(em: EntityManager, loadEntity: () => Promise<unknown>): Promise<boolean> {
  const getMetadata = (em as { getMetadata?: () => MetadataProbe }).getMetadata
  if (typeof getMetadata !== 'function') return true
  const metadata = getMetadata.call(em)
  if (typeof metadata?.has !== 'function') return true
  return metadata.has(await loadEntity())
}

export function isAttachmentsModuleAvailable(em: EntityManager): Promise<boolean> {
  return isEntityRegistered(em, async () => (await import('@open-mercato/core/modules/attachments/data/entities')).Attachment)
}

export function isNotificationsModuleAvailable(em: EntityManager): Promise<boolean> {
  return isEntityRegistered(em, async () => (await import('@open-mercato/core/modules/notifications/data/entities')).Notification)
}
