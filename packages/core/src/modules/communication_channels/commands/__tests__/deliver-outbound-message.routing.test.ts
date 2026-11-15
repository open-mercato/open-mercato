jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
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

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message } from '../../../messages/data/entities'
import {
  ChannelThreadMapping,
  CommunicationChannel,
  ExternalMessage,
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
    capabilities: { threading: false },
    convertOutbound: jest.fn(async (input: ConvertOutboundInput): Promise<ChannelNativeContent> => ({
      content: { text: input.body },
      metadata: input.channelMetadata,
    })),
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
      const fixture = makeFixture({ withLink: false, originalProviderKey })

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
      const mappingRead = mockFindOne.mock.calls.find((call) => call[1] === ChannelThreadMapping)
      expect(mappingRead?.[2]).toEqual({ messageThreadId: 'shared-crm-thread', ...fixture.scope })
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
