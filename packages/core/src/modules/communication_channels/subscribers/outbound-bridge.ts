import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadMapping, CommunicationChannel, MessageChannelLink } from '../data/entities'
import { Message } from '../../messages/data/entities'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../lib/queue'
import type { OutboundDeliveryPayload } from '../workers/outbound-delivery'

/**
 * Subscriber: outbound bridge.
 *
 * Listens to `messages.message.sent` and, when the Message lives in a channel-linked
 * thread, enqueues a delivery job to the `communication-channels-outbound` queue.
 *
 * Per the pre-implementation analysis we **re-fetch the Message by ID** rather than
 * trusting the event payload — this keeps the subscriber decoupled from the
 * `messages.message.sent` payload shape, so any future addition/removal of fields
 * in the messages module doesn't break this bridge.
 *
 * Idempotency: we check for an existing `MessageChannelLink` with `direction='outbound'`
 * and `deliveryStatus IN ('queued','pending','sent','delivered','read')`. If found, we
 * skip — the message is already delivered or has a delivery in flight. Including the
 * in-flight states ('queued'/'pending') stops a replayed `messages.message.sent` from
 * enqueueing a second delivery job while the worker is mid-send. The command-side check
 * is the authoritative gate, but this cheap subscriber-level check avoids redundant jobs.
 *
 * Internal-only messages (no `ChannelThreadMapping` for the threadId) are skipped
 * silently — this is the expected steady-state for the majority of platform messages.
 */
export const metadata = {
  event: 'messages.message.sent',
  persistent: true,
  id: 'communication_channels:outbound-bridge',
}

type MessageSentPayload = {
  messageId: string
  senderUserId?: string
  recipientUserIds?: string[]
  sendViaEmail?: boolean
  externalEmail?: string | null
  tenantId: string
  organizationId?: string | null
}

type SubscriberContext = {
  /** Canonical event-bus context: `resolve` is exposed directly (no `.container` wrapper). */
  resolve: <T = unknown>(name: string) => T
  /** Some callers wrap in a `container` — supported for forward-compat. */
  container?: { resolve: <T = unknown>(name: string) => T }
}

function resolveFromCtx<T = unknown>(ctx: SubscriberContext, name: string): T {
  if (typeof ctx?.resolve === 'function') return ctx.resolve<T>(name)
  if (ctx?.container && typeof ctx.container.resolve === 'function') {
    return ctx.container.resolve<T>(name)
  }
  throw new Error(`outbound-bridge: subscriber context has no resolver (looking for '${name}')`)
}

export default async function handler(
  payload: MessageSentPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload?.messageId || !payload.tenantId) {
    return
  }

  const em = (resolveFromCtx<EntityManager>(ctx, 'em')).fork()
  const dscope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  }

  // (a) Re-fetch the Message — no payload-shape coupling.
  const message = await findOneWithDecryption(
    em,
    Message,
    {
      id: payload.messageId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!message) return
  if (message.sourceEntityType === 'communication_channels.send_as_user') {
    return
  }
  // Inbound ingest path: when `ingest-inbound-message` composes a new platform
  // Message for an incoming email, the messages module also emits
  // `messages.message.sent` (the Message row is fresh and marked sent). Without
  // this guard, we'd treat it as outbound and queue a redundant SMTP delivery —
  // which fails because inbound MCLs carry recipient info in `channelPayload`,
  // not `channelMetadata`, and the failure marker then leaks back onto the
  // inbound link itself.
  if (message.sourceEntityType === 'communication_channels.external_conversation') {
    return
  }
  if (!message.threadId) return // Internal-only; no channel routing.

  // (b) Look up the channel mapping by threadId.
  const mapping = await findOneWithDecryption(
    em,
    ChannelThreadMapping,
    {
      messageThreadId: message.threadId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    },
    undefined,
    dscope,
  )
  if (!mapping) return // Internal-only thread; skip silently.

  // (c) Idempotency — skip if already delivered.
  const existingLink = await findOneWithDecryption(
    em,
    MessageChannelLink,
    {
      messageId: message.id,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    },
    undefined,
    dscope,
  )
  if (
    existingLink &&
    (existingLink.deliveryStatus === 'queued' ||
      existingLink.deliveryStatus === 'pending' ||
      existingLink.deliveryStatus === 'sent' ||
      existingLink.deliveryStatus === 'delivered' ||
      existingLink.deliveryStatus === 'read')
  ) {
    return
  }

  // (c2) Per-user ownership gate. Outbound delivery sends with the CHANNEL
  // OWNER's credentials (workers/outbound-delivery → deliver-outbound-message),
  // so we may only bridge a platform message into a per-user channel when the
  // message's sender OWNS that channel. Tenant-wide channels (userId == null —
  // shared inboxes) accept any sender. Without this, composing into another
  // user's channel-linked thread would send from their connected account
  // (impersonation). Mirrors lib/send-as-user and the reaction ownership gate.
  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: mapping.channelId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!channel) return
  if (channel.userId != null && channel.userId !== message.senderUserId) {
    return
  }

  // (d) Enqueue the delivery worker.
  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.outbound)
  const job: OutboundDeliveryPayload = {
    messageId: message.id,
    scope: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    },
    attempt: 1,
  }
  await queue.enqueue(job as unknown as Record<string, unknown>)
}
