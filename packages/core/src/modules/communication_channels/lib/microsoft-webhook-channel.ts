import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { CommunicationChannel } from '../data/entities'
import { constantTimeEquals } from './constant-time-equals'

type MicrosoftWebhookEvent = Record<string, unknown>

export type MicrosoftWebhookChannelResolution = {
  channel: CommunicationChannel
  expectedClientState: string
  expectedSubscriptionId: string | null
}

export type MicrosoftWebhookValidation =
  | { ok: true; resolution: MicrosoftWebhookChannelResolution }
  | { ok: false; status: number; error: string }

export async function validateMicrosoftWebhookChannel(params: {
  em: EntityManager
  pathToken: string
  events: MicrosoftWebhookEvent[]
}): Promise<MicrosoftWebhookValidation> {
  const { em, pathToken, events } = params
  const subscriptionIds = collectSubscriptionIds(events)

  const channel = await resolveMicrosoftWebhookChannel(em, pathToken, subscriptionIds)
  if (!channel) {
    return { ok: false, status: 410, error: 'subscription_not_found' }
  }

  const reloaded = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: channel.id,
      tenantId: channel.tenantId,
      organizationId: channel.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    { tenantId: channel.tenantId, organizationId: channel.organizationId ?? null },
  )
  if (!reloaded) {
    return { ok: false, status: 410, error: 'subscription_not_found' }
  }

  const expectedClientState =
    (reloaded as { clientStateEncrypted?: string | null }).clientStateEncrypted ?? null
  if (!expectedClientState) {
    return { ok: false, status: 410, error: 'channel_missing_client_state' }
  }

  const expectedSubscriptionId =
    typeof (reloaded.channelState as { subscriptionId?: unknown } | null)?.subscriptionId === 'string'
      ? ((reloaded.channelState as { subscriptionId: string }).subscriptionId)
      : null

  for (const event of events) {
    const providedClientState = typeof event.clientState === 'string' ? event.clientState : ''
    if (!constantTimeEquals(providedClientState, expectedClientState)) {
      return { ok: false, status: 401, error: 'invalid_client_state' }
    }

    const providedSubscriptionId = typeof event.subscriptionId === 'string' ? event.subscriptionId : null
    if (expectedSubscriptionId && providedSubscriptionId && providedSubscriptionId !== expectedSubscriptionId) {
      return { ok: false, status: 401, error: 'invalid_subscription' }
    }
  }

  return {
    ok: true,
    resolution: { channel: reloaded, expectedClientState, expectedSubscriptionId },
  }
}

function collectSubscriptionIds(events: MicrosoftWebhookEvent[]): Set<string> {
  const out = new Set<string>()
  for (const event of events) {
    if (typeof event.subscriptionId === 'string' && event.subscriptionId.length > 0) {
      out.add(event.subscriptionId)
    }
  }
  return out
}

async function resolveMicrosoftWebhookChannel(
  em: EntityManager,
  pathToken: string,
  subscriptionIds: Set<string>,
): Promise<CommunicationChannel | null> {
  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      providerKey: 'microsoft',
      isActive: true,
      deletedAt: null,
    },
  )

  return channels.find((channel) => {
    const state = (channel.channelState as { subscriptionId?: unknown } | null) ?? null
    const storedSubscriptionId = typeof state?.subscriptionId === 'string' ? state.subscriptionId : null
    return (
      channel.id === pathToken ||
      storedSubscriptionId === pathToken ||
      (storedSubscriptionId ? subscriptionIds.has(storedSubscriptionId) : false)
    )
  }) ?? null
}
