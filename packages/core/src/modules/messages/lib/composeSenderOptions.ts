import type { MessageSenderOption } from '@open-mercato/ui/backend/messages'

/**
 * Raw shape of `GET /api/communication_channels/me/channels` items, narrowed to
 * the fields the composer's sender list reads. Declared here rather than
 * imported so the messages module keeps no compile-time dependency on the
 * optional `communication_channels` module.
 */
export type ComposeSenderChannel = {
  id?: unknown
  channelType?: unknown
  status?: unknown
  displayName?: unknown
  externalIdentifier?: unknown
  isPrimary?: unknown
}

/**
 * Map the caller's owned channels onto composer sender options.
 *
 * The endpoint filters server-side on tenant/organization/user only, so both
 * filters belong here: a non-email channel cannot carry an email thread, and a
 * channel that is not `connected` cannot deliver. The user's primary mailbox is
 * flagged and sorted first so it is the one-click choice — flagging it does not
 * preselect it, because the platform sender stays the composer's default.
 */
export function toComposeSenderOptions(items: unknown): MessageSenderOption[] {
  if (!Array.isArray(items)) return []

  const options: Array<MessageSenderOption & { isDefault: boolean }> = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const channel = item as ComposeSenderChannel
    if (typeof channel.id !== 'string' || !channel.id) continue
    if (channel.channelType !== 'email') continue
    if (channel.status !== 'connected') continue

    const externalIdentifier =
      typeof channel.externalIdentifier === 'string' && channel.externalIdentifier.trim().length
        ? channel.externalIdentifier.trim()
        : null
    const displayName =
      typeof channel.displayName === 'string' && channel.displayName.trim().length
        ? channel.displayName.trim()
        : externalIdentifier ?? channel.id

    options.push({
      id: channel.id,
      label: displayName,
      description: externalIdentifier,
      isDefault: channel.isPrimary === true,
    })
  }

  return options.sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
}
