import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../data/entities'
import { ChannelMutationBlockedError, guardOutboundCreate } from './mutation-guards'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from './queue'
import type { OutboundDeliveryPayload } from '../workers/outbound-delivery'
import { htmlToText } from './email-mime'

export type SendAsUserActor = {
  userId: string
  tenantId: string
  organizationId: string | null
  /** Forwarded as the messages compose command `ctx.auth`. */
  auth?: unknown
}

export type SendAsUserInput = {
  userChannelId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: { plain?: string; html?: string }
  inReplyTo?: string
  references?: string[]
  /**
   * Open Mercato `messages.message` id of the message being replied to. When
   * set, the composed message joins that message's thread (the messages module
   * derives `threadId` from the parent), so a CRM reply continues the existing
   * conversation instead of starting a new thread. Optional — omitted for new
   * threads.
   */
  parentMessageId?: string
  /**
   * Free-form metadata persisted on the resulting MessageChannelLink. Used by
   * downstream subscribers (e.g. the customers module's link-channel-message
   * subscriber) to anchor the sent message back to a CRM Person or honor a
   * caller-specified visibility flag. The hub does not interpret these keys.
   */
  channelMetadata?: Record<string, unknown>
}

export type SendAsUserResult =
  | {
      ok: true
      messageId: string
      threadId: string
      channelId: string
      providerKey: string
    }
  | { ok: false; status: number; error: string; fieldErrors?: Record<string, string> }

/**
 * In-process send-as-user facade.
 *
 * Validates the actor owns `userChannelId`, composes the Message via the
 * messages module command, persists the outbound MessageChannelLink + thread
 * mapping, and enqueues delivery. Returns a discriminated result instead of an
 * HTTP Response so it can be invoked both by the `/send-as-user` route and by
 * other modules via DI (`container.resolve('communicationChannelsSendAsUser')`)
 * — no HTTP self-call required.
 */
export async function sendAsUser(
  container: AppContainer,
  actor: SendAsUserActor,
  input: SendAsUserInput,
): Promise<SendAsUserResult> {
  if (!input.body.plain && !input.body.html) {
    return { ok: false, status: 422, error: 'Either body.plain or body.html is required' }
  }
  // Re-validate here (not only in the HTTP route's zod schema) because this
  // facade is also reachable via DI; `input.to[0]` below would otherwise become
  // `undefined` for an empty recipient list.
  if (!Array.isArray(input.to) || input.to.length === 0) {
    return { ok: false, status: 422, error: 'At least one recipient is required' }
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const { tenantId } = actor
  const organizationId = actor.organizationId
  const dscope = { tenantId, organizationId }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id: input.userChannelId, tenantId, organizationId, deletedAt: null },
    undefined,
    dscope,
  )
  if (!channel) return { ok: false, status: 404, error: 'Channel not found' }
  if (channel.userId !== actor.userId) {
    return { ok: false, status: 403, error: 'You can only send through channels you own' }
  }

  // Hub mutation guard: map known non-deliverable states (`requires_reauth`,
  // `disconnected`) to a 422 with field-level errors; other transitional states
  // fall through to the 409 below.
  try {
    await guardOutboundCreate(em, { channelId: channel.id, scope: dscope })
  } catch (err) {
    if (err instanceof ChannelMutationBlockedError) {
      return { ok: false, status: 422, error: err.message, fieldErrors: err.errors }
    }
    throw err
  }
  if (!channel.isActive || channel.status !== 'connected') {
    return {
      ok: false,
      status: 409,
      error: `Channel is in status '${channel.status}' (not connected)`,
    }
  }

  // Create the Message via the messages module compose command. The outbound
  // subscriber picks it up via `messages.message.sent` and routes through the
  // adapter chain.
  const commandBus = container.resolve('commandBus') as CommandBus
  const messageBody = input.body.plain ?? htmlToText(input.body.html ?? '')
  const composeInput = {
    type: `channel.${channel.providerKey}`,
    visibility: 'public' as const,
    sourceEntityType: 'communication_channels.send_as_user',
    sourceEntityId: channel.id,
    externalEmail: input.to[0],
    externalName: input.subject,
    recipients: [],
    subject: input.subject,
    body: messageBody,
    bodyFormat: 'text' as const,
    priority: 'normal' as const,
    sendViaEmail: false,
    parentMessageId: input.parentMessageId,
    isDraft: false,
    tenantId,
    organizationId,
    userId: actor.userId,
  }
  let result
  try {
    result = await commandBus.execute<typeof composeInput, { id: string; threadId: string | null }>(
      'messages.messages.compose',
      {
        input: composeInput,
        ctx: {
          container,
          auth: actor.auth as never,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: organizationId ? [organizationId] : null,
        },
      },
    )
  } catch (err) {
    console.error('[communication_channels] send-as-user compose failed', err)
    return { ok: false, status: 500, error: '[internal] compose failed' }
  }

  const messageId = result.result.id
  const messageThreadId = result.result.threadId ?? messageId
  const externalThreadRef = `outbound:${messageThreadId}`

  // Persist the conversation, thread mapping, and channel link as one unit. The
  // conversation's id is DB-generated (`gen_random_uuid()`), so it must be
  // flushed before the mapping/link can reference it — hence the eager flushes
  // rather than `withAtomicFlush` (single trailing flush). `em.transactional`
  // wraps the whole sequence so a mid-way failure rolls back all three writes
  // instead of leaving an orphaned conversation row.
  await em.transactional(async () => {
    let conversation = await findOneWithDecryption(
      em,
      ExternalConversation,
      {
        channelId: channel.id,
        externalConversationId: externalThreadRef,
        tenantId,
        organizationId,
      },
      undefined,
      dscope,
    )
    if (!conversation) {
      conversation = em.create(ExternalConversation, {
        channelId: channel.id,
        externalConversationId: externalThreadRef,
        subject: input.subject,
        assignedUserId: actor.userId,
        tenantId,
        organizationId,
        lastMessageAt: new Date(),
      })
      em.persist(conversation)
      await em.flush()
    } else {
      conversation.subject = conversation.subject ?? input.subject
      conversation.assignedUserId = conversation.assignedUserId ?? actor.userId
      conversation.lastMessageAt = new Date()
      // Flush the scalar updates BEFORE the ChannelThreadMapping lookup below: a
      // find/findOne on the same EntityManager between a scalar mutation and flush
      // can silently drop the pending UPDATE (core AGENTS.md → Entity Update Safety).
      await em.flush()
    }

    const existingMapping = await findOneWithDecryption(
      em,
      ChannelThreadMapping,
      {
        externalConversationId: conversation.id,
        tenantId,
        organizationId,
      },
      undefined,
      dscope,
    )
    if (!existingMapping) {
      const mapping = em.create(ChannelThreadMapping, {
        externalConversationId: conversation.id,
        messageThreadId,
        channelId: channel.id,
        providerKey: channel.providerKey,
        externalThreadRef,
        assignedUserId: actor.userId,
        tenantId,
        organizationId,
      })
      em.persist(mapping)
    }

    const channelLink = em.create(MessageChannelLink, {
      messageId,
      externalConversationId: conversation.id,
      providerKey: channel.providerKey,
      channelType: channel.channelType,
      direction: 'outbound',
      deliveryStatus: 'pending',
      channelPayload: {
        text: input.body.plain ?? messageBody,
        ...(input.body.html ? { html: input.body.html } : {}),
      },
      channelContentType: input.body.html ? 'text/html' : 'text/plain',
      channelMetadata: {
        // Caller-supplied pass-through metadata merged FIRST so the validated
        // routing fields below always win — a caller cannot override the
        // recipients/subject/threading headers via `channelMetadata`.
        ...(input.channelMetadata ?? {}),
        to: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject,
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? [],
      },
      tenantId,
      organizationId,
    })
    em.persist(channelLink)
    await em.flush()
  })

  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.outbound)
  const deliveryJob: OutboundDeliveryPayload = {
    messageId,
    scope: dscope,
    attempt: 1,
  }
  await queue.enqueue(deliveryJob as unknown as Record<string, unknown>)

  return {
    ok: true,
    messageId,
    threadId: messageThreadId,
    channelId: channel.id,
    providerKey: channel.providerKey,
  }
}

/** DI service type for cross-module callers (resolve `communicationChannelsSendAsUser`). */
export type SendAsUserService = typeof sendAsUser
