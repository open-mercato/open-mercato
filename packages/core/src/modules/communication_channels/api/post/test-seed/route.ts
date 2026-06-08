import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../../../data/entities'
import {
  COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
  type ConnectCredentialChannelInput,
  type ConnectCredentialChannelResult,
} from '../../../commands/connect-credential-channel'
import { emitCommunicationChannelsEvent } from '../../../events'
import {
  TEST_SEED_PROVIDER_KEY,
  clearTestSeedCapturedMessages,
  ensureTestSeedAdapterRegistered,
  isTestChannelSeedingEnabled,
  listTestSeedCapturedMessages,
} from '../../../lib/test-seed'

/**
 * TEST-ONLY channel seeding endpoint.
 *
 * Gated by `OM_ENABLE_TEST_CHANNEL_SEEDING` — when the flag is unset (the
 * production default) every request returns 404, so this route is invisible and
 * inert in production. See `lib/test-seed.ts` for the full rationale.
 *
 * Two actions, both scoped to the caller's tenant/org:
 *   - `connect-channel`: connect a network-free `__test_seed__` channel owned by
 *     the caller (delegates to the real connect-credential command so the channel
 *     persists credentials + lands in `status='connected'`). Enables the outbound
 *     compose → deliver → `.sent` chain to complete in CI.
 *   - `emit-inbound`: insert an inbound `MessageChannelLink` (+ a `messages.message`
 *     row for threading) and emit `communication_channels.message.received` so the
 *     customers link-channel-message subscriber runs against real Postgres. Enables
 *     the inbound auto-link tests (TC-CRM-EMAIL-002..005).
 */
export const metadata = {
  path: '/communication_channels/test-seed',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

const addressObjectSchema = z.object({ address: z.string(), name: z.string().optional() })
const addressFieldSchema = z.union([
  z.string(),
  addressObjectSchema,
  z.array(z.union([z.string(), addressObjectSchema])),
])

const connectChannelSchema = z.object({
  action: z.literal('connect-channel'),
  displayName: z.string().min(1).max(255).optional(),
  externalIdentifier: z.string().min(1).max(255).optional(),
})

const seedSystemChannelSchema = z.object({
  action: z.literal('seed-system-channel'),
  displayName: z.string().min(1).max(255).optional(),
  externalIdentifier: z.string().min(1).max(255).optional(),
})

const clearCaptureSchema = z.object({
  action: z.literal('clear-capture'),
})

const listCaptureSchema = z.object({
  action: z.literal('list-capture'),
})

const emitInboundSchema = z.object({
  action: z.literal('emit-inbound'),
  /** Channel that owns the inbound message; controls authorUserId + default visibility. */
  channelId: z.string().uuid(),
  /** Provider key persisted on the link (defaults to the stub provider). */
  providerKey: z.string().min(1).max(64).optional(),
  /** Normalized inbound addresses (stored under channelPayload). */
  from: addressFieldSchema.optional(),
  to: addressFieldSchema.optional(),
  cc: addressFieldSchema.optional(),
  subject: z.string().max(500).optional(),
  bodyText: z.string().max(200_000).optional(),
  /** RFC2822 Message-ID of this inbound message (for In-Reply-To matching). */
  messageId: z.string().max(500).optional(),
  /** RFC2822 In-Reply-To header (threading-inheritance fallback). */
  inReplyTo: z.string().max(500).optional(),
  references: z.array(z.string().max(500)).max(50).optional(),
  /**
   * Open Mercato `messages.message` thread id this inbound message belongs to.
   * When set, a `messages.message` row is created with this `threadId` so the
   * hub-thread inheritance join can resolve a Person from a sibling message.
   */
  messageThreadId: z.string().uuid().optional(),
  /**
   * Test-only: also create a `ChannelThreadMapping` for the seeded thread. The
   * reaction (`/messages/[id]/reactions`) and thread-assign
   * (`/threads/[id]/assign`) routes resolve the owning channel through this
   * mapping and return 409/404 without it. Opt-in so the existing CRM-link
   * seeds (which don't need a mapping) keep their current mapping-free shape.
   */
  createThreadMapping: z.boolean().optional(),
})

const bodySchema = z.discriminatedUnion('action', [
  connectChannelSchema,
  emitInboundSchema,
  seedSystemChannelSchema,
  clearCaptureSchema,
  listCaptureSchema,
])

export async function POST(req: Request): Promise<Response> {
  // Fail-closed: invisible in production. Mirrors an unknown route (404) rather
  // than 403 so the surface leaks nothing when the flag is off.
  if (!isTestChannelSeedingEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await readJsonSafe(req, null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  // Defensive: make sure the stub adapter is registered for this process even if
  // a worker-only node skipped module di registration.
  ensureTestSeedAdapterRegistered()

  const tenantId = auth.tenantId as string
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const userId = auth.sub as string

  if (body.action === 'clear-capture') {
    await clearTestSeedCapturedMessages()
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'list-capture') {
    return NextResponse.json({ items: await listTestSeedCapturedMessages() })
  }

  if (body.action === 'seed-system-channel') {
    const em = (container.resolve('em') as EntityManager).fork()
    let channel = await em.findOne(CommunicationChannel, {
      providerKey: TEST_SEED_PROVIDER_KEY,
      channelType: 'email',
      tenantId,
      organizationId,
      userId: null,
      deletedAt: null,
    })
    if (!channel) {
      const stamp = Date.now()
      channel = em.create(CommunicationChannel, {
        providerKey: TEST_SEED_PROVIDER_KEY,
        channelType: 'email',
        displayName: body.displayName ?? `Test Seed System Email ${stamp}`,
        externalIdentifier: body.externalIdentifier ?? `system-${stamp}@test-seed.local`,
        userId: null,
        isPrimary: false,
        isActive: true,
        status: 'connected',
        tenantId,
        organizationId,
      })
      em.persist(channel)
      await em.flush()
    } else if (!channel.isActive || channel.status !== 'connected') {
      channel.isActive = true
      channel.status = 'connected'
      channel.lastError = null
      await em.flush()
    }

    return NextResponse.json({ channelId: channel.id }, { status: 201 })
  }

  if (body.action === 'connect-channel') {
    const stamp = Date.now()
    const commandBus = container.resolve('commandBus') as CommandBus
    const input: ConnectCredentialChannelInput = {
      providerKey: TEST_SEED_PROVIDER_KEY,
      displayName: body.displayName ?? `Test Seed Channel ${stamp}`,
      credentials: {
        username: body.externalIdentifier ?? `test-seed-${stamp}@test-seed.local`,
        fromAddress: body.externalIdentifier ?? `test-seed-${stamp}@test-seed.local`,
      },
      userId,
      scope: { tenantId, organizationId },
    }
    const { result } = await commandBus.execute<
      ConnectCredentialChannelInput,
      ConnectCredentialChannelResult
    >(COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID, {
      input,
      ctx: {
        container,
        auth: auth as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
      },
    })
    if (result.status !== 'connected') {
      return NextResponse.json(
        { error: '[internal] test-seed connect failed', detail: result },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { channelId: result.channelId, externalIdentifier: result.externalIdentifier },
      { status: 201 },
    )
  }

  // action === 'emit-inbound'
  const em = (container.resolve('em') as EntityManager).fork()
  const providerKey = body.providerKey ?? TEST_SEED_PROVIDER_KEY

  // A MessageChannelLink requires a non-null external_conversation_id (FK) and
  // message_id. Create a synthetic conversation + (optionally threaded) message
  // so the link is shaped like a real inbound row the subscriber can consume.
  const conversation = em.create(ExternalConversation, {
    channelId: body.channelId,
    externalConversationId: `inbound-seed:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
    subject: body.subject ?? null,
    tenantId,
    organizationId,
    lastMessageAt: new Date(),
  })
  em.persist(conversation)
  await em.flush()

  // Insert the platform `messages.message` row via raw SQL rather than importing
  // the messages module's entity class (cross-module ORM coupling rule). Only
  // `thread_id` matters for the hub-thread inheritance join (TC-CRM-EMAIL-005);
  // the rest satisfy NOT NULL constraints.
  const messageRows = (await em.getConnection().execute(
    `INSERT INTO messages
       (type, thread_id, sender_user_id, subject, body, body_format, priority, status,
        is_draft, sent_at, visibility, source_entity_type, source_entity_id,
        tenant_id, organization_id, created_at, updated_at)
     VALUES
       (?, ?, ?, ?, ?, 'text', 'normal', 'sent',
        false, now(), 'public', 'communication_channels.test_seed_inbound', ?,
        ?, ?, now(), now())
     RETURNING id`,
    [
      `channel.${providerKey}`,
      body.messageThreadId ?? null,
      userId,
      body.subject ?? '(no subject)',
      body.bodyText ?? '',
      body.channelId,
      tenantId,
      organizationId,
    ],
  )) as Array<{ id: string }>
  const messageId = messageRows[0]?.id
  if (!messageId) {
    return NextResponse.json({ error: '[internal] failed to seed message row' }, { status: 500 })
  }

  const link = em.create(MessageChannelLink, {
    messageId,
    externalConversationId: conversation.id,
    providerKey,
    channelType: 'email',
    direction: 'inbound',
    deliveryStatus: 'delivered',
    channelPayload: {
      ...(body.from !== undefined ? { from: body.from } : {}),
      ...(body.to !== undefined ? { to: body.to } : {}),
      ...(body.cc !== undefined ? { cc: body.cc } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.bodyText !== undefined ? { text: body.bodyText } : {}),
      ...(body.inReplyTo !== undefined ? { inReplyTo: body.inReplyTo } : {}),
      ...(body.references !== undefined ? { references: body.references } : {}),
    },
    channelContentType: 'text/plain',
    channelMetadata: {
      ...(body.messageId !== undefined ? { messageId: body.messageId } : {}),
    },
    tenantId,
    organizationId,
  })
  em.persist(link)
  await em.flush()

  // Optionally mirror `ingest-inbound-message`: a real inbound message always
  // lands a ChannelThreadMapping that the reaction + thread-assign routes use to
  // resolve the owning channel. Seeded inbound messages skip it by default; opt
  // in for tests that exercise those routes. Keyed by `messageThreadId ?? messageId`
  // to match how those commands resolve the mapping (`message.threadId ?? message.id`).
  if (body.createThreadMapping) {
    const mapping = em.create(ChannelThreadMapping, {
      externalConversationId: conversation.id,
      messageThreadId: body.messageThreadId ?? messageId,
      channelId: body.channelId,
      providerKey,
      externalThreadRef: conversation.externalConversationId,
      tenantId,
      organizationId,
    })
    em.persist(mapping)
    await em.flush()
  }

  // Emit the hub event through the real event bus so the persistent customers
  // link-channel-message-received subscriber is enqueued to the `events` queue.
  await emitCommunicationChannelsEvent(
    'communication_channels.message.received',
    {
      channelLinkId: link.id,
      channelId: body.channelId,
      providerKey,
      direction: 'inbound',
      tenantId,
      organizationId,
    },
    { persistent: true },
  )

  return NextResponse.json(
    { channelLinkId: link.id, messageId, conversationId: conversation.id },
    { status: 201 },
  )
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Test-only: seed a connected channel or emit an inbound message (env-gated)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 201, description: 'Channel seeded / inbound message emitted' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Test channel seeding disabled (production default)' },
        { status: 422, description: 'Invalid request body' },
        { status: 500, description: 'Seed failed' },
      ],
    },
  },
}

export default POST
