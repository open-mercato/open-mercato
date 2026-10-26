import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { Attachment } from '../data/entities'

type AttachmentStorageReferenceRow = {
  id: string
  partition_code: string
  storage_path: string
}

type AttachmentStorageReferenceDatabase = {
  attachments: AttachmentStorageReferenceRow
}

export type AttachmentStorageReference = Pick<Attachment, 'id' | 'partitionCode' | 'storagePath'>

export type AttachmentRecordRemoval = {
  removed: boolean
  releaseStorage: boolean
}

function selectAttachmentStorageReferences(
  em: EntityManager,
  reference: Pick<AttachmentStorageReference, 'partitionCode' | 'storagePath'>,
) {
  return em
    .getKysely<AttachmentStorageReferenceDatabase>()
    .selectFrom('attachments')
    .select('id')
    .where('partition_code', '=', reference.partitionCode)
    .where('storage_path', '=', reference.storagePath)
    .orderBy('id')
}

/**
 * Locks every attachment row that points at the same stored object and returns their ids.
 *
 * Several rows can legitimately share one stored object: catalog copies variant media onto the
 * product and message forwarding copies the source attachments, both by reusing `storagePath`.
 * The lock is held until the surrounding transaction ends, so two deletions of rows sharing an
 * object serialize and exactly one of them observes that it removed the last reference. A copy
 * inserted by a transaction that has not committed yet is not visible to this lock.
 */
export async function lockAttachmentStorageReferences(
  em: EntityManager,
  reference: Pick<AttachmentStorageReference, 'partitionCode' | 'storagePath'>,
): Promise<string[]> {
  const rows = await selectAttachmentStorageReferences(em, reference).forUpdate().execute()
  return rows.map((row) => String(row.id))
}

/**
 * Returns the ids of every attachment row that points at the same stored object, without locking.
 *
 * Only for the deprecated `releaseScoped(…, { flush: false })` call made outside a transaction,
 * where no lock could be held until commit. Concurrent deletions of rows sharing the object are
 * not serialized, so when they race the object is kept rather than deleted.
 */
export async function listAttachmentStorageReferences(
  em: EntityManager,
  reference: Pick<AttachmentStorageReference, 'partitionCode' | 'storagePath'>,
): Promise<string[]> {
  const rows = await selectAttachmentStorageReferences(em, reference).execute()
  return rows.map((row) => String(row.id))
}

export function resolveAttachmentStorageRelease(
  lockedReferenceIds: readonly string[],
  attachmentId: string,
): AttachmentRecordRemoval {
  if (!lockedReferenceIds.includes(attachmentId)) return { removed: false, releaseStorage: false }
  return { removed: true, releaseStorage: lockedReferenceIds.length === 1 }
}

/**
 * Removes an attachment row and reports whether its stored object may be deleted afterwards.
 *
 * Runs and commits its own transaction, so it refuses an entity manager that is already inside one.
 * Provider bytes must only be deleted after this resolves with `releaseStorage: true`; any other
 * attachment row still referencing the same object keeps it alive. `removed: false` means a
 * concurrent request already deleted the row.
 */
export async function removeAttachmentRecord(
  em: EntityManager,
  attachment: Attachment,
): Promise<AttachmentRecordRemoval> {
  const isInTransaction = (em as { isInTransaction?: () => boolean }).isInTransaction
  if (typeof isInTransaction === 'function' && isInTransaction.call(em)) {
    throw new Error('[internal] removeAttachmentRecord must commit its own transaction before provider bytes are deleted')
  }
  let removal: AttachmentRecordRemoval = { removed: false, releaseStorage: false }
  await withAtomicFlush(em, [async () => {
    const lockedReferenceIds = await lockAttachmentStorageReferences(em, attachment)
    removal = resolveAttachmentStorageRelease(lockedReferenceIds, attachment.id)
    if (removal.removed) em.remove(attachment)
  }], { transaction: true, label: 'attachments.attachment.delete' })
  return removal
}
