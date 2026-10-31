import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CommunicationChannel } from '../data/entities'

/**
 * What a delete records about the owner's other channels so its undo can tell a
 * row that lived next to the deleted one from a row that took its connection
 * afterwards. `unidentifiedSiblingIds` lists the live identifier-less rows of the
 * same provider at delete time: connect adopts such a row in place when the
 * adapter reports an identifier, so it keeps its old `createdAt` while it becomes
 * the reconnected channel. Absent on undo entries written before it existed.
 */
export interface ChannelRestoreRecord {
  unidentifiedSiblingIds?: string[]
}

/**
 * Advisory lock key shared by connect (`createConnectedChannelRow`) and restore,
 * so a reconnect cannot land between the duplicate check of an undo and its write.
 * One key per tenant and owner (`tenant` for tenant-wide channels) covers every
 * key connect compares: provider, mailbox and the cross-provider mailbox guard.
 */
export function channelConnectionLockKey(tenantId: string, userId: string | null): string {
  return `communication_channels:connection:${tenantId}:${userId ?? 'tenant'}`
}

function identifierOf(channel: CommunicationChannel): string | null {
  const value = channel.externalIdentifier
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isTenantWidePush(channel: CommunicationChannel): boolean {
  return channel.channelType === 'push' && (channel.userId ?? null) === null
}

function connectedSinceDelete(restored: CommunicationChannel, candidate: CommunicationChannel): boolean {
  if (!restored.deletedAt || !candidate.createdAt) return true
  return candidate.createdAt.getTime() >= restored.deletedAt.getTime()
}

function adoptedSinceDelete(
  restored: CommunicationChannel,
  candidate: CommunicationChannel,
  record: ChannelRestoreRecord,
): boolean {
  if (identifierOf(restored) !== null || identifierOf(candidate) === null) return false
  if (!record.unidentifiedSiblingIds) return true
  return record.unidentifiedSiblingIds.includes(candidate.id)
}

function holdsSameConnection(
  restored: CommunicationChannel,
  candidate: CommunicationChannel,
  record: ChannelRestoreRecord,
): boolean {
  if (isTenantWidePush(restored)) {
    return candidate.channelType === 'push' && candidate.providerKey === restored.providerKey
  }
  const restoredIdentifier = identifierOf(restored)
  const candidateIdentifier = identifierOf(candidate)
  if (candidate.providerKey === restored.providerKey) {
    if (restoredIdentifier !== null && candidateIdentifier !== null) {
      return restoredIdentifier === candidateIdentifier
    }
    return (
      (candidate.organizationId ?? null) === (restored.organizationId ?? null) &&
      (connectedSinceDelete(restored, candidate) || adoptedSinceDelete(restored, candidate, record))
    )
  }
  return (
    restoredIdentifier !== null &&
    candidateIdentifier !== null &&
    restoredIdentifier.toLowerCase() === candidateIdentifier.toLowerCase()
  )
}

/**
 * The record a delete stores with its undo payload: the ids of the live
 * identifier-less rows of the deleted channel's provider and owner, read the same
 * way connect reads the rows it may adopt. Empty for channels that cannot be on
 * the restoring side of an adoption.
 */
export async function captureChannelRestoreRecord(
  em: EntityManager,
  channel: CommunicationChannel,
): Promise<Required<ChannelRestoreRecord>> {
  if (identifierOf(channel) !== null || isTenantWidePush(channel)) return { unidentifiedSiblingIds: [] }
  const siblings = (await findWithDecryption(
    em,
    CommunicationChannel,
    {
      tenantId: channel.tenantId,
      userId: channel.userId ?? null,
      providerKey: channel.providerKey,
      externalIdentifier: null,
      deletedAt: null,
      id: { $ne: channel.id },
    },
    undefined,
    { tenantId: channel.tenantId, organizationId: null },
  )) as CommunicationChannel[]
  return { unidentifiedSiblingIds: siblings.map((sibling) => sibling.id) }
}

export function parseChannelRestoreRecord(value: Record<string, unknown>): ChannelRestoreRecord {
  const ids = value.unidentifiedSiblingIds
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return {}
  return { unidentifiedSiblingIds: ids as string[] }
}

/**
 * Find a live channel that already holds the connection a soft-deleted channel
 * would take back on restore. Connect (`createConnectedChannelRow`) only heals
 * rows with `deleted_at IS NULL`, so a reconnect after a delete inserts a new row
 * or adopts an older identifier-less one, and restoring the deleted one next to it
 * leaves two channels on one account.
 *
 * The keys follow connect: tenant-wide push channels are one per provider; other
 * channels match on (owner, provider, identifier), exactly as the heal key and the
 * mailbox unique index compare them; an identifier-less row of a provider is the
 * same connection as a row of that provider in the same organization that connect
 * created or adopted after the delete (credentials are stored once per provider,
 * owner and organization, which is why `adoptUnidentifiedChannel` folds them),
 * while rows that already lived next to the deleted one before stay as they were;
 * and one mailbox is never connected through two providers for one owner, compared
 * case-insensitively like the cross-provider connect guard. Without a delete-time
 * record (older undo entries) any identified row of the provider counts as adopted.
 */
export async function findActiveDuplicateChannel(
  em: EntityManager,
  channel: CommunicationChannel,
  record: ChannelRestoreRecord = {},
): Promise<CommunicationChannel | null> {
  const active = (await findWithDecryption(
    em,
    CommunicationChannel,
    { tenantId: channel.tenantId, userId: channel.userId ?? null, deletedAt: null, id: { $ne: channel.id } },
    undefined,
    { tenantId: channel.tenantId, organizationId: null },
  )) as CommunicationChannel[]
  return active.find((candidate) => holdsSameConnection(channel, candidate, record)) ?? null
}

export async function assertChannelRestorable(
  em: EntityManager,
  channel: CommunicationChannel,
  record: ChannelRestoreRecord = {},
): Promise<void> {
  const duplicate = await findActiveDuplicateChannel(em, channel, record)
  if (!duplicate) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(
      'communication_channels.errors.undoRestoreDuplicate',
      'This channel was connected again after it was deleted. Delete the newer connection before undoing this delete.',
    ),
  })
}

/**
 * Undo of a channel delete: clear `deleted_at`, unless a live channel took the
 * same connection since the delete. The check and the write run in one
 * transaction under the connect lock of the channel's owner, so a concurrent
 * reconnect either commits first (and the restore refuses with a 409) or waits
 * until the restored row is visible (and heals or adopts it like any live row).
 */
export async function restoreDeletedChannel(
  em: EntityManager,
  target: { channelId: string; tenantId: string } & ChannelRestoreRecord,
): Promise<void> {
  const where = { id: target.channelId, tenantId: target.tenantId }
  const decryptionScope = { tenantId: target.tenantId, organizationId: null }
  const located = await findOneWithDecryption(em, CommunicationChannel, where, undefined, decryptionScope)
  if (!located) return
  await withAdvisoryXactLock(em, channelConnectionLockKey(target.tenantId, located.userId ?? null), async (txEm) => {
    const channel = await findOneWithDecryption(txEm, CommunicationChannel, where, undefined, decryptionScope)
    if (!channel || !channel.deletedAt) return
    await assertChannelRestorable(txEm, channel, target)
    channel.deletedAt = null
    await txEm.flush()
  })
}
