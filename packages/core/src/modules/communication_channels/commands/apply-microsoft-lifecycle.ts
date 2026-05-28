import type { EntityManager } from '@mikro-orm/postgresql'
import { CommunicationChannel } from '../data/entities'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import { emitCommunicationChannelsEvent } from '../events'

/**
 * Apply a Microsoft Graph subscription lifecycle event to a channel.
 *
 * Extracted from the lifecycle webhook route so the domain-state transition
 * lives in `commands/` rather than inline in the route handler (root AGENTS.md →
 * Command Side Effects). Like the sibling push helpers (`push-register` /
 * `push-unregister`), this is a lib-style command, not a `registerCommand`-style
 * undoable command — a provider-driven lifecycle notification has no meaningful
 * undo. Downstream reactions are driven by the emitted `requires_reauth` /
 * `push.deactivated` events.
 */
export async function applyMicrosoftLifecycleEvent(params: {
  em: EntityManager
  channel: CommunicationChannel
  lifecycleEvent: string
}): Promise<void> {
  const { em, channel, lifecycleEvent } = params

  if (lifecycleEvent === 'missed') {
    // Graph dropped notifications — enqueue a delta-sync to catch up.
    const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.microsoftDeltaSync)
    await queue.enqueue({
      channelId: channel.id,
      scope: {
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
      },
      notification: {
        subscriptionId:
          (channel.channelState as { subscriptionId?: string } | null)?.subscriptionId ?? '',
        changeType: 'missed',
        resource: "/me/mailFolders('inbox')/messages",
      },
    } as unknown as Record<string, unknown>)
    return
  }

  if (lifecycleEvent === 'reauthorizationRequired') {
    channel.status = 'requires_reauth'
    const state = (channel.channelState as Record<string, unknown> | null) ?? {}
    channel.channelState = { ...state, pushStatus: 'inactive' }
    channel.lastError = 'microsoft_lifecycle_reauth_required'
    await em.flush()
    await emitCommunicationChannelsEvent(
      'communication_channels.channel.requires_reauth',
      {
        channelId: channel.id,
        providerKey: channel.providerKey,
        channelType: channel.channelType,
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
        reason: 'microsoft_lifecycle',
      },
      { persistent: true },
    )
    return
  }

  if (lifecycleEvent === 'subscriptionRemoved') {
    const state = (channel.channelState as Record<string, unknown> | null) ?? {}
    channel.channelState = {
      ...state,
      pushStatus: 'inactive',
      subscriptionId: null,
      subscriptionExpiresAt: null,
    }
    channel.pollIntervalSeconds = 60
    await em.flush()
    await emitCommunicationChannelsEvent(
      'communication_channels.push.deactivated',
      {
        channelId: channel.id,
        providerKey: channel.providerKey,
        tenantId: channel.tenantId,
        organizationId: channel.organizationId ?? null,
        reason: 'subscription_removed',
      },
      { persistent: true },
    )
    return
  }

  // Unknown lifecycle event — log + ignore.
  console.warn(
    `[microsoft-lifecycle] unknown lifecycleEvent="${lifecycleEvent}" for channel ${channel.id}`,
  )
}
