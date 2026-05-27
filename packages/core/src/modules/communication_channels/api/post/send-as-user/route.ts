import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../../../data/entities'
import { ChannelMutationBlockedError, guardOutboundCreate } from '../../../lib/mutation-guards'
import { COMMUNICATION_CHANNELS_QUEUES, getCommunicationChannelsQueue } from '../../../lib/queue'
import type { OutboundDeliveryPayload } from '../../../workers/outbound-delivery'

export const metadata = {
  path: '/communication_channels/send-as-user',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.manage'],
  },
}

const bodySchema = z.object({
  /** ID of the user-owned channel to send from. Caller MUST own the channel. */
  userChannelId: z.string().uuid(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(500),
  body: z.object({
    plain: z.string().max(50_000).optional(),
    html: z.string().max(200_000).optional(),
  }),
  inReplyTo: z.string().min(1).max(500).optional(),
  references: z.array(z.string().min(1).max(500)).optional(),
  /**
   * Free-form metadata persisted on the resulting MessageChannelLink. Used by
   * downstream subscribers (e.g. the customers module's link-channel-message
   * subscriber) to anchor the sent message back to a CRM Person or honor a
   * caller-specified visibility flag. Keys are caller-defined; the hub does
   * not interpret them.
   */
  channelMetadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Programmatic send-as-user facade.
 *
 * Thin wrapper that:
 *   1. Validates the caller owns `userChannelId`.
 *   2. Creates a `Message` via the messages module's `messages.messages.compose` command
 *      with the channel-routing metadata baked in.
 *   3. Lets the existing outbound subscriber (slice 2c) deliver via the channel adapter.
 *
 * Returns once the Message is persisted; the actual external send is async.
 * See email integration spec § API Contracts → POST /send-as-user.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json().catch(() => null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }
  if (!body.body.plain && !body.body.html) {
    return NextResponse.json(
      { error: 'Either body.plain or body.html is required' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: body.userChannelId,
      tenantId: auth.tenantId as string,
      organizationId,
      deletedAt: null,
    } as any,
    undefined,
    dscope,
  )
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }
  if (channel.userId !== auth.sub) {
    return NextResponse.json(
      { error: 'You can only send through channels you own' },
      { status: 403 },
    )
  }
  // Hub mutation guard (Phase 4): map known non-deliverable states
  // (`requires_reauth`, `disconnected`) to a 422 with a field-level error so
  // CrudForm callers can inline the message on the channel selector. Other
  // non-connected statuses (e.g. `connecting` in flight) keep the 409 below.
  try {
    await guardOutboundCreate(em, {
      channelId: channel.id,
      scope: dscope,
    })
  } catch (err) {
    if (err instanceof ChannelMutationBlockedError) {
      return NextResponse.json({ error: err.message, fieldErrors: err.errors }, { status: 422 })
    }
    throw err
  }
  if (!channel.isActive || channel.status !== 'connected') {
    return NextResponse.json(
      { error: `Channel is in status '${channel.status}' (not connected)` },
      { status: 409 },
    )
  }

  // Create the Message via the messages module compose command. The outbound
  // subscriber from slice 2c picks it up via `messages.message.sent` event and
  // routes through the adapter chain.
  const commandBus = container.resolve('commandBus') as CommandBus
  const messageBody = body.body.plain ?? stripHtml(body.body.html ?? '')
  const composeInput = {
    type: `channel.${channel.providerKey}`,
    visibility: 'public' as const,
    sourceEntityType: 'communication_channels.send_as_user',
    sourceEntityId: channel.id,
    externalEmail: body.to[0],
    externalName: body.subject,
    recipients: [],
    subject: body.subject,
    body: messageBody,
    bodyFormat: 'text' as const,
    priority: 'normal' as const,
    sendViaEmail: false,
    parentMessageId: undefined,
    isDraft: false,
    tenantId: auth.tenantId as string,
    organizationId,
    userId: auth.sub as string,
  }
  let result
  try {
    result = await commandBus.execute<typeof composeInput, { id: string; threadId: string | null }>(
      'messages.messages.compose',
      {
        input: composeInput,
        ctx: {
          container,
          auth: auth as never,
          organizationScope: null,
          selectedOrganizationId: organizationId,
          organizationIds: organizationId
            ? [organizationId]
            : null,
        },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'compose failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const messageId = result.result.id
  const messageThreadId = result.result.threadId ?? messageId
  const externalThreadRef = `outbound:${messageThreadId}`
  let conversation = await findOneWithDecryption(
    em,
    ExternalConversation,
    {
      channelId: channel.id,
      externalConversationId: externalThreadRef,
      tenantId: auth.tenantId as string,
      organizationId,
    } as any,
    undefined,
    dscope,
  )
  if (!conversation) {
    conversation = em.create(ExternalConversation, {
      channelId: channel.id,
      externalConversationId: externalThreadRef,
      subject: body.subject,
      assignedUserId: auth.sub as string,
      tenantId: auth.tenantId as string,
      organizationId,
      lastMessageAt: new Date(),
    } as any)
    em.persist(conversation)
    await em.flush()
  } else {
    conversation.subject = conversation.subject ?? body.subject
    conversation.assignedUserId = conversation.assignedUserId ?? (auth.sub as string)
    conversation.lastMessageAt = new Date()
  }

  const existingMapping = await findOneWithDecryption(
    em,
    ChannelThreadMapping,
    {
      externalConversationId: conversation.id,
      tenantId: auth.tenantId as string,
      organizationId,
    } as any,
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
      assignedUserId: auth.sub as string,
      tenantId: auth.tenantId as string,
      organizationId,
    } as any)
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
      text: body.body.plain ?? messageBody,
      ...(body.body.html ? { html: body.body.html } : {}),
    },
    channelContentType: body.body.html ? 'text/html' : 'text/plain',
    channelMetadata: {
      to: body.to,
      cc: body.cc ?? [],
      bcc: body.bcc ?? [],
      subject: body.subject,
      inReplyTo: body.inReplyTo ?? null,
      references: body.references ?? [],
      // Caller-supplied pass-through metadata merged last so routing fields
      // (to/cc/bcc/subject) are never overwritten by the caller.
      ...(body.channelMetadata ?? {}),
    },
    tenantId: auth.tenantId as string,
    organizationId,
  } as any)
  em.persist(channelLink)
  await em.flush()

  const queue = getCommunicationChannelsQueue(COMMUNICATION_CHANNELS_QUEUES.outbound)
  const deliveryJob: OutboundDeliveryPayload = {
    messageId,
    scope: dscope,
    attempt: 1,
  }
  await queue.enqueue(deliveryJob as unknown as Record<string, unknown>)

  return NextResponse.json(
    {
      messageId,
      threadId: messageThreadId,
      channelId: channel.id,
      providerKey: channel.providerKey,
      enqueuedForDelivery: true,
    },
    { status: 202 },
  )
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Send a message through the current user\'s own channel',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 202, description: 'Message persisted; outbound delivery enqueued' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Cannot send through a channel you don\'t own' },
        { status: 404, description: 'Channel not found' },
        { status: 409, description: 'Channel in a non-deliverable transitional status' },
        { status: 422, description: 'Invalid body, or channel requires_reauth / disconnected' },
      ],
    },
  },
}
export default POST
