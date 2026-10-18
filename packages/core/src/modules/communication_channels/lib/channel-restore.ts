import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CommunicationChannel } from '../data/entities'

function identifierOf(channel: CommunicationChannel): string | null {
  const value = channel.externalIdentifier
  return typeof value === 'string' && value.length > 0 ? value : null
}

function connectedSinceDelete(restored: CommunicationChannel, candidate: CommunicationChannel): boolean {
  if (!restored.deletedAt || !candidate.createdAt) return true
  return candidate.createdAt.getTime() >= restored.deletedAt.getTime()
}

function holdsSameConnection(restored: CommunicationChannel, candidate: CommunicationChannel): boolean {
  if (restored.channelType === 'push' && (restored.userId ?? null) === null) {
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
      connectedSinceDelete(restored, candidate)
    )
  }
  return (
    restoredIdentifier !== null &&
    candidateIdentifier !== null &&
    restoredIdentifier.toLowerCase() === candidateIdentifier.toLowerCase()
  )
}

/**
 * Find a live channel that already holds the connection a soft-deleted channel
 * would take back on restore. Connect (`createConnectedChannelRow`) only heals
 * rows with `deleted_at IS NULL`, so a reconnect after a delete inserts a new row,
 * and restoring the deleted one next to it leaves two channels on one account.
 *
 * The keys follow connect: tenant-wide push channels are one per provider; other
 * channels match on (owner, provider, identifier), exactly as the heal key and the
 * mailbox unique index compare them; an identifier-less row of a provider is the
 * same connection as a row of that provider connected for the owner in the same
 * organization after the delete (credentials are stored once per provider, owner
 * and organization, which is why `adoptUnidentifiedChannel` folds them), while
 * rows that already lived next to the deleted one before stay as they were; and
 * one mailbox is never connected through two providers for one owner, compared
 * case-insensitively like the cross-provider connect guard.
 */
export async function findActiveDuplicateChannel(
  em: EntityManager,
  channel: CommunicationChannel,
): Promise<CommunicationChannel | null> {
  const active = (await findWithDecryption(
    em,
    CommunicationChannel,
    { tenantId: channel.tenantId, userId: channel.userId ?? null, deletedAt: null, id: { $ne: channel.id } },
    undefined,
    { tenantId: channel.tenantId, organizationId: null },
  )) as CommunicationChannel[]
  return active.find((candidate) => holdsSameConnection(channel, candidate)) ?? null
}

export async function assertChannelRestorable(
  em: EntityManager,
  channel: CommunicationChannel,
): Promise<void> {
  const duplicate = await findActiveDuplicateChannel(em, channel)
  if (!duplicate) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(
      'communication_channels.errors.undoRestoreDuplicate',
      'This channel was connected again after it was deleted. Delete the newer connection before undoing this delete.',
    ),
  })
}
