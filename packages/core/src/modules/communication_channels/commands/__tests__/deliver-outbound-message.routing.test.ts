jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

jest.mock('../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: jest.fn(async (input: { credentials: Record<string, unknown> }) => ({
    refreshed: false,
    credentials: input.credentials,
  })),
}))

jest.mock('../../lib/thread-token', () => ({
  getOrCreateThreadToken: jest.fn(async () => ({ token: 'routing-token' })),
  buildBodyFooter: jest.fn(() => ({ html: '', plain: '' })),
  buildReferencesId: jest.fn((token: string) => `<om-${token}>`),
}))

jest.mock('../../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { outbound: 'outbound' },
  getCommunicationChannelsQueue: jest.fn(),
}))

jest.mock('../../lib/system-user', () => ({
  resolveCommunicationChannelsSystemUserId: jest.fn(async () => 'system-user'),
}))

import bridge from '../../subscribers/outbound-bridge'
import worker, { type OutboundDeliveryPayload } from '../../workers/outbound-delivery'
import type { QueuedJob } from '@open-mercato/queue'
import { getCommunicationChannelsQueue } from '../../lib/queue'
import { convertOutboundForDiscord } from '../../../../../../channel-discord/src/modules/channel_discord/lib/convert-outbound'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message } from '../../../messages/data/entities'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalMessage,
  ExternalConversation,
  MessageChannelLink,
} from '../../data/entities'
import { emitCommunicationChannelsEvent } from '../../events'
import type {
  ChannelNativeContent,
  ConvertOutboundInput,
  SendMessageInput,
  SendMessageResult,
} from '../../lib/adapter'
import deliverOutboundMessageCommand from '../deliver-outbound-message'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFindMany = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockQueue = getCommunicationChannelsQueue as jest.MockedFunction<typeof getCommunicationChannelsQueue>
const mockEmit = emitCommunicationChannelsEvent as jest.MockedFunction<typeof emitCommunicationChannelsEvent>

const MESSAGE_ID = '550e8400-e29b-41d4-a716-446655440010'
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440020'
const ORGANIZATION_ID = '550e8400-e29b-41d4-a716-446655440030'
const OTHER_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040'
const OTHER_ORGANIZATION_ID = '550e8400-e29b-41d4-a716-446655440050'

type TestEntityManager = {
  fork(): TestEntityManager
  create(entity: new () => object, data: Record<string, unknown>): object
  persist(record: object): void
  flush(): Promise<void>
}

function makeAdapter(providerKey: string) {
  return {
    providerKey,
    capabilities: { threading: providerKey === 'discord' },
    convertOutbound: jest.fn(async (input: ConvertOutboundInput): Promise<ChannelNativeContent> => (
      providerKey === 'discord' ? convertOutboundForDiscord(input) : {
        content: { text: input.body },
        metadata: input.channelMetadata,
      }
    )),
    sendMessage: jest.fn(async (_input: SendMessageInput): Promise<SendMessageResult> => ({
      status: 'sent',
      externalMessageId: `${providerKey}-outbound-1`,
    })),
  }
}

function makeFixture(options: {
  organizationId?: string | null
  deliveryStatus?: string
  withLink?: boolean
  withSelectedMapping?: boolean
  originalProviderKey?: string
} = {}) {
  const organizationId = options.organizationId === undefined ? ORGANIZATION_ID : options.organizationId
  const scope = { tenantId: TENANT_ID, organizationId }
  const message = Object.assign(new Message(), {
    id: MESSAGE_ID,
    threadId: 'shared-crm-thread',
    parentMessageId: null,
    visibility: 'public',
    senderUserId: 'original-user',
    body: 'Reply from the selected mailbox',
    bodyFormat: 'text',
    deletedAt: null,
    ...scope,
  })
  const originalChannel = Object.assign(new CommunicationChannel(), {
    id: 'original-mailbox',
    providerKey: options.originalProviderKey ?? 'gmail',
    channelType: options.originalProviderKey === 'discord' ? 'chat' : 'email',
    userId: 'original-user',
    credentialsRef: 'original-credentials',
    deletedAt: null,
    ...scope,
  })
  const selectedChannel = Object.assign(new CommunicationChannel(), {
    id: 'selected-mailbox',
    providerKey: 'imap',
    channelType: 'email',
    userId: 'replying-user',
    credentialsRef: 'selected-credentials',
    deletedAt: null,
    ...scope,
  })
  const originalMapping = Object.assign(new ChannelThreadMapping(), {
    id: 'original-mapping',
    messageThreadId: message.threadId,
    channelId: originalChannel.id,
    externalConversationId: 'original-conversation',
    externalThreadRef: 'original-provider-thread',
    providerKey: originalChannel.providerKey,
    ...scope,
  })
  const selectedMapping = Object.assign(new ChannelThreadMapping(), {
    id: 'selected-mapping',
    messageThreadId: message.threadId,
    channelId: selectedChannel.id,
    externalConversationId: 'selected-conversation',
    externalThreadRef: 'selected-provider-thread',
    providerKey: selectedChannel.providerKey,
    ...scope,
  })
  const link = Object.assign(new MessageChannelLink(), {
    id: 'reply-link',
    messageId: message.id,
    externalConversationId: selectedMapping.externalConversationId,
    providerKey: selectedChannel.providerKey,
    channelType: selectedChannel.channelType,
    direction: 'outbound',
    deliveryStatus: options.deliveryStatus ?? 'pending',
    channelPayload: { text: message.body },
    channelMetadata: { to: ['client@example.com'] },
    ...scope,
  })
  const mappingRows = [
    originalMapping,
    Object.assign(new ChannelThreadMapping(), selectedMapping, { tenantId: OTHER_TENANT_ID }),
    Object.assign(new ChannelThreadMapping(), selectedMapping, { organizationId: OTHER_ORGANIZATION_ID }),
    Object.assign(new ChannelThreadMapping(), selectedMapping, { messageThreadId: 'unrelated-thread' }),
    ...(options.withSelectedMapping === false ? [] : [selectedMapping]),
  ]
  const rowsByEntity = new Map<unknown, object[]>([
    [Message, [message]],
    [ExternalConversation, [originalMapping, selectedMapping].map((mapping) => Object.assign(new ExternalConversation(), {
      id: mapping.externalConversationId, externalConversationId: mapping.externalThreadRef, channelId: mapping.channelId, ...scope,
    }))],
    [MessageChannelLink, options.withLink === false ? [] : [link]],
    [ChannelThreadMapping, mappingRows],
    [CommunicationChannel, [originalChannel, selectedChannel]],
  ])
  mockFindOne.mockImplementation(async (_em, entity, query) => {
    const rows = rowsByEntity.get(entity) ?? []
    return (rows.find((row) => Object.entries(query).every(
      ([key, value]) => (row as Record<string, unknown>)[key] === value,
    )) ?? null) as never
  })
  mockFindMany.mockImplementation(async (_em, entity, query, options) => {
    const rows = (rowsByEntity.get(entity) ?? []).filter((row) => Object.entries(query).every(
      ([key, value]) => (row as Record<string, unknown>)[key] === value,
    ))
    return rows.slice(0, options?.limit ?? rows.length) as never
  })
  const created: { entity: unknown; data: Record<string, unknown> }[] = []
  const em: TestEntityManager = {
    fork: jest.fn(() => em),
    create: jest.fn((entity: new () => object, data: Record<string, unknown>) => {
      const record = Object.assign(new entity(), { id: 'created-link' }, data)
      created.push({ entity, data: record as Record<string, unknown> })
      rowsByEntity.set(entity, [...(rowsByEntity.get(entity) ?? []), record])
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  const originalAdapter = makeAdapter(originalChannel.providerKey)
  const selectedAdapter = makeAdapter(selectedChannel.providerKey)
  const adapters = new Map([
    [originalChannel.providerKey, originalAdapter],
    [selectedChannel.providerKey, selectedAdapter],
  ])
  const resolveCredentials = jest.fn(async (
    _integrationId: string,
    credentialsScope: { userId?: string | null },
  ) => ({ mailbox: credentialsScope.userId }))
  const registryGet = jest.fn((providerKey: string) => adapters.get(providerKey))
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'channelAdapterRegistry') return { get: registryGet }
        if (name === 'integrationCredentialsService') return { resolve: resolveCredentials }
        if (name === 'integrationLogService') return { error: jest.fn() }
        throw new Error(`[internal] Unexpected dependency: ${name}`)
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: organizationId ? [organizationId] : null,
  }
  return {
    ctx,
    message,
    rowsByEntity,
    mappingRows,
    originalChannel,
    selectedChannel,
    scope,
    em,
    created,
    link,
    originalAdapter,
    originalMapping,
    selectedAdapter,
    selectedMapping,
    resolveCredentials,
    registryGet,
  }
}

describe('deliverOutboundMessageCommand selected mailbox routing', () => {
  beforeEach(() => {
    mockFindOne.mockReset()
    mockFindMany.mockReset()
    mockEmit.mockClear()
  })

  it.each([ORGANIZATION_ID, null])(
    'routes a shared-thread reply through its selected conversation in organization %s',
    async (organizationId) => {
      const fixture = makeFixture({ organizationId })
      const input = { messageId: MESSAGE_ID, scope: fixture.scope }

      const result = await deliverOutboundMessageCommand.execute(input, fixture.ctx)

      expect(result).toMatchObject({ status: 'delivered', providerKey: 'imap', channelLinkId: fixture.link.id })
      expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.resolveCredentials).toHaveBeenCalledTimes(1)
      expect(fixture.resolveCredentials).toHaveBeenCalledWith('channel_imap', {
        tenantId: TENANT_ID,
        organizationId: organizationId ?? TENANT_ID,
        userId: 'replying-user',
      })
      expect(fixture.selectedAdapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: fixture.selectedMapping.externalThreadRef,
        credentials: { mailbox: 'replying-user' },
      }))
      expect(fixture.selectedAdapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
        channelMetadata: expect.objectContaining({ thread_id: fixture.selectedMapping.externalThreadRef }),
      }))
      const externalMessage = fixture.created.find((record) => record.entity === ExternalMessage)
      expect(externalMessage?.data).toMatchObject({
        channelId: 'selected-mailbox',
        conversationId: fixture.selectedMapping.externalConversationId,
        externalMessageId: 'imap-outbound-1',
        ...fixture.scope,
      })
      expect(fixture.link.externalMessageId).toBe(externalMessage?.data.id)
      expect(fixture.link.externalConversationId).toBe(fixture.selectedMapping.externalConversationId)
      expect(mockEmit).toHaveBeenCalledWith('communication_channels.message.sent', expect.objectContaining({
        channelId: 'selected-mailbox',
        conversationId: fixture.selectedMapping.externalConversationId,
        providerKey: 'imap',
        ...fixture.scope,
      }), { persistent: true })
      const linkReads = mockFindOne.mock.calls.filter((call) => call[1] === MessageChannelLink)
      expect(linkReads).toHaveLength(1)
      expect(linkReads[0][2]).toEqual({ messageId: MESSAGE_ID, ...fixture.scope })
      expect(linkReads[0][4]).toEqual(fixture.scope)
      const mappingRead = mockFindOne.mock.calls.find((call) => call[1] === ChannelThreadMapping)
      expect(mappingRead?.[2]).toEqual({
        messageThreadId: 'shared-crm-thread',
        externalConversationId: fixture.selectedMapping.externalConversationId,
        ...fixture.scope,
      })
      expect(mappingRead?.[4]).toEqual(fixture.scope)

      await expect(deliverOutboundMessageCommand.execute(input, fixture.ctx)).resolves.toEqual({
        status: 'already_delivered',
        messageId: MESSAGE_ID,
        channelLinkId: fixture.link.id,
      })
      expect(fixture.selectedAdapter.sendMessage).toHaveBeenCalledTimes(1)
      expect(mockEmit).toHaveBeenCalledTimes(1)
    },
  )

  it.each([ORGANIZATION_ID, null])(
    'does not fall back to another mailbox when the selected mapping is missing in organization %s',
    async (organizationId) => {
      const fixture = makeFixture({ organizationId, withSelectedMapping: false })

      await expect(deliverOutboundMessageCommand.execute(
        { messageId: MESSAGE_ID, scope: fixture.scope },
        fixture.ctx,
      )).resolves.toEqual({ status: 'no_channel_link' })

      expect(fixture.registryGet).not.toHaveBeenCalled()
      expect(fixture.resolveCredentials).not.toHaveBeenCalled()
      expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.selectedAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.em.persist).not.toHaveBeenCalled()
      expect(fixture.em.flush).not.toHaveBeenCalled()
      expect(fixture.link.deliveryStatus).toBe('pending')
      expect(mockEmit).not.toHaveBeenCalled()
    },
  )

  it.each(['gmail', 'discord'])(
    'preserves native thread routing for %s messages without a pre-created link',
    async (originalProviderKey) => {
      const fixture = makeFixture({ withLink: false, withSelectedMapping: false, originalProviderKey })

      const result = await deliverOutboundMessageCommand.execute(
        { messageId: MESSAGE_ID, scope: fixture.scope },
        fixture.ctx,
      )

      expect(result).toMatchObject({ status: 'delivered', providerKey: originalProviderKey })
      expect(fixture.originalAdapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: fixture.originalMapping.externalThreadRef,
        credentials: { mailbox: 'original-user' },
      }))
      expect(fixture.selectedAdapter.sendMessage).not.toHaveBeenCalled()
      const createdLink = fixture.created.find((record) => record.entity === MessageChannelLink)
      expect(createdLink?.data).toMatchObject({
        messageId: MESSAGE_ID,
        externalConversationId: fixture.originalMapping.externalConversationId,
        providerKey: originalProviderKey,
        deliveryStatus: 'sent',
        ...fixture.scope,
      })
      expect(mockFindMany).toHaveBeenCalledWith(expect.anything(), ChannelThreadMapping,
        { messageThreadId: 'shared-crm-thread', ...fixture.scope }, { limit: 2 }, fixture.scope)
    },
  )

  it.each(['queued', 'sent', 'delivered', 'read'])(
    'does not resend a selected mailbox link with delivery status %s',
    async (deliveryStatus) => {
      const fixture = makeFixture({ deliveryStatus })

      await expect(deliverOutboundMessageCommand.execute(
        { messageId: MESSAGE_ID, scope: fixture.scope },
        fixture.ctx,
      )).resolves.toEqual({ status: 'already_delivered', messageId: MESSAGE_ID, channelLinkId: fixture.link.id })

      expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.selectedAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.resolveCredentials).not.toHaveBeenCalled()
      expect(fixture.created).toEqual([])
      expect(mockEmit).not.toHaveBeenCalled()
    },
  )
})


describe('native routing across bridge, worker, command and provider conversion (#9739)', () => {
  beforeEach(() => {
    mockFindOne.mockReset()
    mockFindMany.mockReset()
    mockEmit.mockClear()
    mockQueue.mockReset()
  })

  function withParent(fixture: ReturnType<typeof makeFixture>, conversation: 'original' | 'selected', origin: 'inbound' | 'send_as_user') {
    const mapping = conversation === 'original' ? fixture.originalMapping : fixture.selectedMapping
    const channel = conversation === 'original' ? fixture.originalChannel : fixture.selectedChannel
    const parent = Object.assign(new Message(), {
      id: 'parent-message', threadId: fixture.message.threadId, deletedAt: null, ...fixture.scope,
      sourceEntityType: origin === 'inbound' ? 'communication_channels.external_conversation' : 'communication_channels.send_as_user',
      sourceEntityId: origin === 'inbound' ? mapping.externalConversationId : channel.id,
    })
    Object.assign(fixture.message, {
      parentMessageId: parent.id, sourceEntityType: parent.sourceEntityType, sourceEntityId: parent.sourceEntityId,
      senderUserId: channel.userId,
    })
    const parentLink = Object.assign(new MessageChannelLink(), {
      id: 'parent-link', messageId: parent.id, externalConversationId: mapping.externalConversationId,
      externalMessageId: 'parent-external', providerKey: channel.providerKey, channelType: channel.channelType,
      direction: origin === 'inbound' ? 'inbound' : 'outbound', deliveryStatus: 'sent', ...fixture.scope,
    })
    fixture.rowsByEntity.set(Message, [fixture.message, parent])
    fixture.rowsByEntity.set(MessageChannelLink, [...(fixture.rowsByEntity.get(MessageChannelLink) ?? []), parentLink])
    fixture.rowsByEntity.set(ExternalMessage, [Object.assign(new ExternalMessage(), {
      id: 'parent-external', conversationId: mapping.externalConversationId, channelId: channel.id,
      externalMessageId: 'discord-parent-id', ...fixture.scope,
    })])
    return { parent, parentLink }
  }

  async function bridgeAndDeliver(fixture: ReturnType<typeof makeFixture>, reorder = false) {
    const jobs: OutboundDeliveryPayload[] = []
    const enqueue = jest.fn(async (payload: OutboundDeliveryPayload) => { jobs.push(payload); return 'job' })
    mockQueue.mockReturnValue({ enqueue } as unknown as ReturnType<typeof getCommunicationChannelsQueue>)
    const outcomes: unknown[] = []
    const resolve = <Service,>(name: string): Service => {
      if (name === 'commandBus') return {
        execute: async (commandId: string, args: { input: Parameters<typeof deliverOutboundMessageCommand.execute>[0]; ctx: CommandRuntimeContext }) => {
          expect(commandId).toBe(deliverOutboundMessageCommand.id)
          const result = await deliverOutboundMessageCommand.execute(args.input, args.ctx)
          outcomes.push(result)
          return { result }
        },
      } as Service
      return fixture.ctx.container.resolve(name) as Service
    }
    await bridge({ messageId: MESSAGE_ID, replyTo: fixture.message.parentMessageId, ...fixture.scope }, { resolve })
    if (reorder) fixture.mappingRows.reverse()
    for (const payload of [...jobs]) {
      await worker({ payload } as QueuedJob<OutboundDeliveryPayload>, { resolve })
    }
    return { jobs, outcomes }
  }

  const routingCases = (['original', 'selected'] as const).flatMap((conversation) =>
    [false, true].flatMap((reversed) =>
      (['inbound', 'send_as_user'] as const).flatMap((origin) =>
        [false, true].flatMap((withLink) =>
          [ORGANIZATION_ID, null].map((organizationId) => ({ conversation, reversed, origin, withLink, organizationId })),
        ),
      ),
    ),
  )

  it.each(routingCases)(
    'routes $conversation from $origin (reversed=$reversed, link=$withLink, org=$organizationId)',
    async ({ conversation, reversed, origin, withLink, organizationId }) => {
      const fixture = makeFixture({ withLink, organizationId, originalProviderKey: 'discord' })
      const target = conversation === 'original' ? fixture.originalMapping : fixture.selectedMapping
      const adapter = conversation === 'original' ? fixture.originalAdapter : fixture.selectedAdapter
      const other = conversation === 'original' ? fixture.selectedAdapter : fixture.originalAdapter
      withParent(fixture, conversation, origin)
      if (withLink) {
        Object.assign(fixture.link, {
          externalConversationId: target.externalConversationId, providerKey: target.providerKey,
          channelType: conversation === 'original' ? 'chat' : 'email', deliveryStatus: 'failed',
        })
      }
      if (reversed) fixture.mappingRows.reverse()
      const result = await bridgeAndDeliver(fixture, true)
      expect(result.jobs).toHaveLength(1)
      expect(result.outcomes).toEqual([expect.objectContaining({ status: 'delivered' })])
      expect(other.sendMessage).not.toHaveBeenCalled()
      expect(adapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: target.externalThreadRef }))
      expect(adapter.convertOutbound).toHaveBeenCalledWith(expect.objectContaining({
        channelMetadata: expect.objectContaining({ thread_id: target.externalThreadRef }),
      }))
      if (conversation === 'original') {
        expect(adapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
          content: expect.objectContaining({ text: fixture.message.body, bodyFormat: 'markdown' }),
          metadata: expect.objectContaining({ messageReferenceId: 'discord-parent-id' }),
        }))
      }
      await deliverOutboundMessageCommand.execute({ messageId: MESSAGE_ID, scope: fixture.scope }, fixture.ctx)
      expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
    },
  )


  it.each(['queued', 'sent', 'delivered', 'read'])('preserves %s idempotency after all mappings disappear', async (deliveryStatus) => {
    const fixture = makeFixture({ deliveryStatus })
    fixture.rowsByEntity.set(ChannelThreadMapping, [])
    await expect(deliverOutboundMessageCommand.execute({ messageId: MESSAGE_ID, scope: fixture.scope }, fixture.ctx))
      .resolves.toEqual({ status: 'already_delivered', messageId: MESSAGE_ID, channelLinkId: fixture.link.id })
    expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
    expect(fixture.selectedAdapter.sendMessage).not.toHaveBeenCalled()
  })
  it('accepts a root parent whose platform thread is represented by its own id', async () => {
    const fixture = makeFixture({ withLink: false })
    const { parent, parentLink } = withParent(fixture, 'selected', 'inbound')
    parent.id = fixture.message.threadId ?? ''
    parent.threadId = null
    parentLink.messageId = parent.id
    fixture.message.parentMessageId = parent.id
    const result = await bridgeAndDeliver(fixture, true)
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'delivered', providerKey: 'imap' })])
    expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
  })

  it('uses source provenance before a parent channel link exists', async () => {
    const fixture = makeFixture({ withLink: false })
    withParent(fixture, 'selected', 'inbound')
    fixture.rowsByEntity.set(MessageChannelLink, [])
    const result = await bridgeAndDeliver(fixture, true)
    expect(result.outcomes).toEqual([expect.objectContaining({ status: 'delivered', providerKey: 'imap' })])
    expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps explicit mailbox selection ahead of inherited source and parent', async () => {
    const fixture = makeFixture()
    withParent(fixture, 'original', 'inbound')
    fixture.selectedChannel.userId = fixture.message.senderUserId
    fixture.link.deliveryStatus = 'failed'
    await bridgeAndDeliver(fixture, true)
    expect(fixture.selectedAdapter.sendMessage).toHaveBeenCalledTimes(1)
    expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
  })

  it.each(['missing', 'conflicting', 'missing-parent', 'parent-thread', 'tenant', 'organization', 'conversation-channel', 'thread-ref', 'provider', 'link-provider', 'source-channel'])(
    'refuses %s provenance both at the bridge and when a worker bypasses it', async (failure) => {
      const fixture = makeFixture({ withLink: false })
      const { parent, parentLink } = withParent(fixture, 'selected', 'inbound')
      if (failure === 'missing') Object.assign(fixture.message, { parentMessageId: null, sourceEntityType: null, sourceEntityId: null })
      if (failure === 'conflicting') fixture.message.sourceEntityId = fixture.originalMapping.externalConversationId
      if (failure === 'missing-parent') fixture.rowsByEntity.set(Message, [fixture.message])
      if (failure === 'parent-thread') parent.threadId = 'different-thread'
      if (failure === 'tenant') fixture.selectedMapping.tenantId = OTHER_TENANT_ID
      if (failure === 'organization') fixture.selectedMapping.organizationId = OTHER_ORGANIZATION_ID
      if (failure === 'conversation-channel') {
        const conversation = fixture.rowsByEntity.get(ExternalConversation)?.find((row) => (row as ExternalConversation).id === fixture.selectedMapping.externalConversationId)
        Object.assign(conversation ?? {}, { channelId: fixture.originalChannel.id })
      }
      if (failure === 'thread-ref') fixture.selectedMapping.externalThreadRef = fixture.originalMapping.externalThreadRef
      if (failure === 'provider') fixture.selectedMapping.providerKey = 'other-provider'
      if (failure === 'link-provider') parentLink.providerKey = 'other-provider'
      if (failure === 'source-channel') Object.assign(fixture.message, { sourceEntityType: 'communication_channels.send_as_user', sourceEntityId: fixture.originalChannel.id })
      const bridged = await bridgeAndDeliver(fixture, true)
      expect(bridged.jobs).toHaveLength(0)
      await expect(deliverOutboundMessageCommand.execute({ messageId: MESSAGE_ID, scope: fixture.scope }, fixture.ctx))
        .resolves.toEqual({ status: 'no_channel_link' })
      expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.selectedAdapter.sendMessage).not.toHaveBeenCalled()
      expect(fixture.created).toEqual([])
    },
  )

  it('honors parent channel provenance when neither message has a conversation link', async () => {
    const fixture = makeFixture({ withLink: false, withSelectedMapping: false })
    withParent(fixture, 'selected', 'send_as_user')
    Object.assign(fixture.message, { sourceEntityType: null, sourceEntityId: null })
    fixture.rowsByEntity.set(MessageChannelLink, [])
    const bridged = await bridgeAndDeliver(fixture)
    expect(bridged.jobs).toHaveLength(0)
    await expect(deliverOutboundMessageCommand.execute({ messageId: MESSAGE_ID, scope: fixture.scope }, fixture.ctx))
      .resolves.toEqual({ status: 'no_channel_link' })
    expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
  })

  it('rechecks routing after the bridge when mappings change before worker delivery', async () => {
    const fixture = makeFixture({ withLink: false })
    fixture.rowsByEntity.set(ChannelThreadMapping, [fixture.originalMapping])
    const enqueue = jest.fn(async () => {
      fixture.rowsByEntity.set(ChannelThreadMapping, [fixture.selectedMapping, fixture.originalMapping])
      return 'job'
    })
    mockQueue.mockReturnValue({ enqueue } as unknown as ReturnType<typeof getCommunicationChannelsQueue>)
    const resolve = <Service,>(name: string): Service => fixture.ctx.container.resolve(name) as Service
    await bridge({ messageId: MESSAGE_ID, replyTo: fixture.message.parentMessageId, ...fixture.scope }, { resolve })
    expect(enqueue).toHaveBeenCalledTimes(1)
    await expect(deliverOutboundMessageCommand.execute({ messageId: MESSAGE_ID, scope: fixture.scope }, fixture.ctx))
      .resolves.toEqual({ status: 'no_channel_link' })
    expect(fixture.originalAdapter.sendMessage).not.toHaveBeenCalled()
  })
})
