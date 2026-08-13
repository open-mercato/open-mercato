import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalConversation,
  MessageChannelLink,
} from '../../../data/entities'
import { ChannelAccessDeniedError, assertCanManageChannel } from '../../../lib/access-control'
import {
  COMMUNICATION_CHANNELS_CONNECT_CREDENTIAL_CHANNEL_COMMAND_ID,
  type ConnectCredentialChannelInput,
  type ConnectCredentialChannelResult,
} from '../../../commands/connect-credential-channel'
import { emitCommunicationChannelsEvent } from '../../../events'
import {
  TEST_SEED_CHAT_PROVIDER_KEY,
  TEST_SEED_PROVIDER_KEY,
  ensureTestSeedAdapterRegistered,
  isTestChannelSeedingEnabled,
} from '../../../lib/test-seed'
import {
  COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID,
  type IngestInboundMessageInput,
  type IngestInboundMessageResult,
} from '../../../commands/ingest-inbound-message'

/**
 * TEST-ONLY channel seeding endpoint.
 *
 * Gated by `OM_ENABLE_TEST_CHANNEL_SEEDING` — when the flag is unset (the
 * production default) every request returns 404, so this route is invisible and
 * inert in production. See `lib/test-seed.ts` for the full rationale.
 *
 * Three actions, all scoped to the caller's tenant/org:
 *   - `connect-channel`: connect a network-free stub channel owned by the caller
 *     (delegates to the real connect-credential command so the channel persists
 *     credentials + lands in `status='connected'`). Enables the outbound
 *     compose → deliver → `.sent` chain to complete in CI. `providerFlavor: 'chat'`
 *     connects the non-email stub instead, for tests about sender identity.
 *   - `ingest-inbound`: run the REAL `ingest_inbound_message` command over an
 *     adapter-normalized chat frame, so the platform compose path — and every
 *     validation rule on it — actually executes. Use this for anything that
 *     claims inbound works.
 *   - `emit-inbound`: insert an inbound `MessageChannelLink` (+ a `messages.message`
 *     row for threading) and emit `communication_channels.message.received` so the
 *     customers link-channel-message subscriber runs against real Postgres. Enables
 *     the inbound auto-link tests (TC-CRM-EMAIL-002..005). NOTE: this action
 *     deliberately bypasses `messages.messages.compose` — it can never prove that
 *     the hub accepts a message, only that downstream subscribers fire.
 */
type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

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
  /**
   * Which stub provider to connect. `email` (default) keeps the historical
   * email-shaped channel; `chat` connects a channel whose senders have no
   * address, so a test can exercise the hub's non-email identity contract
   * without inventing one (#4975).
   */
  providerFlavor: z.enum(['email', 'chat']).optional(),
})

/**
 * Drive the REAL `ingest_inbound_message` command with a chat-shaped frame.
 *
 * `emit-inbound` below deliberately bypasses the platform compose path (it
 * inserts the `messages` row with raw SQL) because it only ever needed a
 * landing zone for the CRM-link subscribers. That bypass is why an inbound test
 * could pass while `composeMessageSchema` rejected every real message (#4975).
 * This action takes the opposite approach: it hands the frame to the adapter and
 * the ingest command and asserts nothing on the way, so whatever the hub's
 * contract really is, the test feels it.
 */
const ingestInboundSchema = z.object({
  action: z.literal('ingest-inbound'),
  channelId: z.string().uuid(),
  /** Opaque sender handle — a Discord snowflake, a Slack member id, etc. */
  senderIdentifier: z.string().min(1).max(255),
  senderDisplayName: z.string().max(255).optional(),
  body: z.string().max(50_000).optional(),
  externalMessageId: z.string().min(1).max(255),
  externalConversationId: z.string().min(1).max(255),
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
  ingestInboundSchema,
  emitInboundSchema,
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

  if (body.action === 'connect-channel') {
    const stamp = Date.now()
    const commandBus = container.resolve('commandBus') as CommandBus
    const isChatFlavor = body.providerFlavor === 'chat'
    // A chat channel is deliberately connected WITHOUT an email-ish credential
    // key, so `connect-credential-channel` derives no `externalIdentifier` and
    // the row is shaped exactly like a real Discord channel (identifier NULL —
    // the condition #4977 describes). Inventing one here would recreate the
    // fixture dishonesty that hid #4975.
    const credentials = isChatFlavor
      ? { handle: body.externalIdentifier ?? `test-seed-chat-${stamp}` }
      : {
          username: body.externalIdentifier ?? `test-seed-${stamp}@test-seed.local`,
          fromAddress: body.externalIdentifier ?? `test-seed-${stamp}@test-seed.local`,
        }
    const input: ConnectCredentialChannelInput = {
      providerKey: isChatFlavor ? TEST_SEED_CHAT_PROVIDER_KEY : TEST_SEED_PROVIDER_KEY,
      displayName:
        body.displayName ?? `Test Seed ${isChatFlavor ? 'Chat ' : ''}Channel ${stamp}`,
      credentials,
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

  // action === 'ingest-inbound' | 'emit-inbound' — both address an existing channel.
  const em = (container.resolve('em') as EntityManager).fork()
  // Only the `emit-inbound` branch stamps a caller-chosen provider key onto the
  // rows it seeds; `ingest-inbound` takes the channel's own (see below).
  const providerKey =
    body.action === 'emit-inbound' ? body.providerKey ?? TEST_SEED_PROVIDER_KEY : TEST_SEED_PROVIDER_KEY

  // `channelId` is caller-supplied, so confirm it names a channel this tenant/org
  // actually owns before seeding rows that reference it. Mirrors the ownership
  // lookup every other per-channel route performs (see channels/[id]/test-send).
  const ownedChannel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: body.channelId,
      tenantId,
      organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId, organizationId },
  )
  if (!ownedChannel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  // Tenant/org scope alone does not authorize: `connect_user_channel` is granted
  // broadly, so a same-tenant caller could otherwise seed against a colleague's
  // personal mailbox. Enforce the module's owner-only contract — personal
  // channels are owner-restricted, shared channels need `manage`.
  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const acl = await rbac.loadAcl(userId, { tenantId, organizationId })
    userFeatures = acl?.isSuperAdmin ? ['*'] : Array.isArray(acl?.features) ? acl.features : []
  } catch {
    userFeatures = []
  }
  try {
    assertCanManageChannel(
      { userId: ownedChannel.userId },
      userId,
      userFeatures,
      'communication_channels.manage',
    )
  } catch (err) {
    if (err instanceof ChannelAccessDeniedError) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    const status = (err as { statusCode?: number }).statusCode ?? 403
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Access denied' },
      { status },
    )
  }

  if (body.action === 'ingest-inbound') {
    // Everything below this point is the real path: the adapter normalizes the
    // frame and `ingest_inbound_message` composes the platform message through
    // `messages.messages.compose`. Nothing is short-circuited, so a hub contract
    // the provider cannot satisfy surfaces here as a failure instead of hiding
    // behind seeded rows (#4975).
    // The channel's own provider key, never a hardcoded one: ingest does not
    // check that `providerKey` matches the channel it names, so passing a
    // different one would silently stamp the wrong provider onto the link.
    const channelProviderKey = ownedChannel.providerKey
    if (channelProviderKey !== TEST_SEED_CHAT_PROVIDER_KEY) {
      return NextResponse.json(
        {
          error:
            'ingest-inbound requires a channel connected with providerFlavor: "chat"; ' +
            `channel ${body.channelId} is '${channelProviderKey}'`,
        },
        { status: 422 },
      )
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const adapterRegistry = container.resolve('channelAdapterRegistry') as {
      get: (key: string) => { normalizeInbound: (raw: unknown) => Promise<unknown> } | undefined
    }
    const adapter = adapterRegistry.get(channelProviderKey)
    if (!adapter) {
      return NextResponse.json(
        { error: '[internal] test-seed chat adapter is not registered' },
        { status: 500 },
      )
    }

    const normalized = await adapter.normalizeInbound({
      raw: {
        externalMessageId: body.externalMessageId,
        externalConversationId: body.externalConversationId,
        senderIdentifier: body.senderIdentifier,
        senderDisplayName: body.senderDisplayName,
        body: body.body ?? '',
      },
      eventType: 'message',
      metadata: {},
    })

    const ingestInput = {
      channelId: body.channelId,
      providerKey: channelProviderKey,
      channelType: ownedChannel.channelType,
      scope: { tenantId, organizationId },
      message: normalized,
    } as IngestInboundMessageInput

    const { result } = await commandBus.execute<
      IngestInboundMessageInput,
      IngestInboundMessageResult
    >(COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID, {
      input: ingestInput,
      ctx: {
        container,
        auth: auth as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: organizationId ? [organizationId] : null,
      },
    })

    return NextResponse.json(
      {
        status: result.status,
        messageId: result.messageId ?? null,
        conversationId: result.externalConversationId ?? null,
        channelLinkId: result.channelLinkId ?? null,
        channelType: ownedChannel.channelType,
      },
      { status: 201 },
    )
  }

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
      summary:
        'Test-only: seed a connected channel, ingest a real inbound message, or emit a seeded inbound link (env-gated)',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 201, description: 'Channel seeded / inbound message emitted' },
        { status: 401, description: 'Unauthorized' },
        {
          status: 404,
          description:
            'Test channel seeding disabled (production default), or the requested channel does not belong to the caller',
        },
        { status: 422, description: 'Invalid request body' },
        { status: 500, description: 'Seed failed' },
      ],
    },
  },
}

export default POST
