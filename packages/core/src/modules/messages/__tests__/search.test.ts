jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
      const values = typeof fallbackOrParams === 'object' && fallbackOrParams ? fallbackOrParams : params
      let out = fallback
      if (values) for (const [name, value] of Object.entries(values)) out = out.replace(new RegExp(`{{${name}}}`, 'g'), String(value))
      return out
    },
  }),
}))

import type { SearchResult, SearchResultVisibilityContext } from '@open-mercato/shared/modules/search'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageRecipient } from '../data/entities'
import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from '../lib/channelThreadAccess'
import searchConfig, { filterVisibleMessages } from '../search'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

function getMessageEntity() {
  const entity = searchConfig.entities.find((entry) => entry.entityId === 'messages:message')
  if (!entity) throw new Error('messages:message entity missing from search config')
  return entity
}

describe('messages search config', () => {
  it('declares searchable, hash-only, and excluded field policies', () => {
    const entity = getMessageEntity()
    expect(entity.fieldPolicy?.searchable).toEqual(['subject', 'body', 'external_name'])
    expect(entity.fieldPolicy?.hashOnly).toEqual(['external_email'])
    expect(entity.fieldPolicy?.excluded).toEqual(['action_data', 'action_result'])
  })

  it('builds an index source containing subject, body, and sender name lines', async () => {
    const entity = getMessageEntity()
    const ctx = {
      record: {
        id: 'msg-1',
        subject: 'Weekly update',
        body: 'Project shipped',
        external_name: 'Jane Doe',
      },
    } as never
    const source = await entity.buildSource?.(ctx)
    expect(source).not.toBeNull()
    expect(source?.text).toEqual(['Subject: Weekly update', 'Body: Project shipped', 'From name: Jane Doe'])
    expect(source?.presenter?.title).toBe('Weekly update')
    expect(source?.presenter?.badge).toBe('Message')
    expect(source?.checksumSource?.record).toMatchObject({
      subject: 'Weekly update',
      body: 'Project shipped',
      external_name: 'Jane Doe',
    })
  })

  it('returns null when no searchable text is present', async () => {
    const entity = getMessageEntity()
    const ctx = { record: {} } as never
    const source = await entity.buildSource?.(ctx)
    expect(source).toBeNull()
  })

  it('resolves URL from record id', async () => {
    const entity = getMessageEntity()
    const result = await entity.resolveUrl?.({ record: { id: 'msg-123' } } as never)
    expect(result).toBe('/backend/messages/msg-123')
  })

  it('wires filterVisibleMessages as the entity filterResults hook', () => {
    const entity = getMessageEntity()
    expect(entity.filterResults).toBe(filterVisibleMessages)
  })
})

describe('filterVisibleMessages', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111'
  const ORG_ID = '22222222-2222-4222-8222-222222222222'
  const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222299'
  const USER_A = '33333333-3333-4333-8333-333333333331'
  const USER_B = '33333333-3333-4333-8333-333333333332'
  const MSG_SENT = '44444444-4444-4444-8444-444444444401'
  const MSG_RECEIVED = '44444444-4444-4444-8444-444444444402'
  const MSG_PRIVATE = '44444444-4444-4444-8444-444444444403'
  const MSG_DRAFT = '44444444-4444-4444-8444-444444444404'
  const MSG_CHANNEL_PUBLIC = '44444444-4444-4444-8444-444444444405'
  const MSG_CHANNEL_INTERNAL = '44444444-4444-4444-8444-444444444406'
  const MSG_OTHER_ORG = '44444444-4444-4444-8444-444444444407'
  const THREAD_ID = '55555555-5555-4555-8555-555555555501'

  const mockedFindWithDecryption = findWithDecryption as jest.Mock

  function makeResult(recordId: string, organizationId: string | null = ORG_ID): SearchResult {
    return { entityId: 'messages:message', recordId, score: 1, source: 'fulltext', organizationId }
  }

  function makeCtx(options: {
    results: SearchResult[]
    messages?: Array<Record<string, unknown>>
    recipientRows?: Array<{ messageId: string }>
    userHasAllFeatures?: jest.Mock
    channelAccessResolver?: jest.Mock
    authOverrides?: Partial<SearchResultVisibilityContext['viewer']['auth']>
    organizationId?: string | null
    organizationIds?: string[] | null
    omitContainer?: boolean
  }) {
    mockedFindWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === Message) return options.messages ?? []
      if (entity === MessageRecipient) return options.recipientRows ?? []
      return []
    })
    const userHasAllFeatures = options.userHasAllFeatures ?? jest.fn().mockResolvedValue(false)
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'rbacService') return { userHasAllFeatures }
        if (name === 'communicationChannelsResolveChannelThreadAccess') {
          if (options.channelAccessResolver) return options.channelAccessResolver
          throw new Error('not registered')
        }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    }
    const ctx: SearchResultVisibilityContext = {
      entityId: 'messages:message',
      results: options.results,
      tenantId: TENANT_ID,
      organizationId: options.organizationId !== undefined ? options.organizationId : ORG_ID,
      organizationIds: options.organizationIds !== undefined ? options.organizationIds : [ORG_ID],
      viewer: {
        auth: {
          sub: USER_A,
          userId: USER_A,
          tenantId: TENANT_ID,
          orgId: ORG_ID,
          isSuperAdmin: false,
          ...options.authOverrides,
        },
        container: options.omitContainer ? undefined : container,
      },
    }
    return { ctx, userHasAllFeatures }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps sender and active-recipient messages and drops non-participant and other-user draft messages', async () => {
    const rSent = makeResult(MSG_SENT)
    const rReceived = makeResult(MSG_RECEIVED)
    const rPrivate = makeResult(MSG_PRIVATE)
    const rDraft = makeResult(MSG_DRAFT)
    const { ctx } = makeCtx({
      results: [rSent, rReceived, rPrivate, rDraft],
      messages: [
        { id: MSG_SENT, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_A, isDraft: true, visibility: 'internal' },
        { id: MSG_RECEIVED, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_B, isDraft: false, visibility: 'internal' },
        { id: MSG_PRIVATE, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_B, isDraft: false, visibility: 'internal' },
        { id: MSG_DRAFT, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_B, isDraft: true, visibility: 'internal' },
      ],
      recipientRows: [{ messageId: MSG_RECEIVED }, { messageId: MSG_DRAFT }],
    })

    const visible = await filterVisibleMessages(ctx)

    expect(visible).toEqual([rSent, rReceived])
    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      Message,
      { id: { $in: [MSG_SENT, MSG_RECEIVED, MSG_PRIVATE, MSG_DRAFT] }, tenantId: TENANT_ID, deletedAt: null },
      expect.objectContaining({ fields: expect.any(Array) }),
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      MessageRecipient,
      {
        messageId: { $in: [MSG_RECEIVED, MSG_PRIVATE] },
        recipientUserId: USER_A,
        deletedAt: null,
      },
      { fields: ['messageId'] },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('allows public channel-linked messages for authorized operators while keeping internal notes participant-only', async () => {
    const rPublic = makeResult(MSG_CHANNEL_PUBLIC)
    const rInternal = makeResult(MSG_CHANNEL_INTERNAL)
    const userHasAllFeatures = jest.fn().mockResolvedValue(true)
    const channelAccessResolver = jest.fn().mockResolvedValue({ canAccess: true })
    const { ctx } = makeCtx({
      results: [rPublic, rInternal],
      messages: [
        {
          id: MSG_CHANNEL_PUBLIC,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          senderUserId: USER_B,
          isDraft: false,
          visibility: 'public',
          threadId: THREAD_ID,
          sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
        },
        {
          id: MSG_CHANNEL_INTERNAL,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          senderUserId: USER_B,
          isDraft: false,
          visibility: 'internal',
          threadId: THREAD_ID,
          sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
        },
      ],
      userHasAllFeatures,
      channelAccessResolver,
    })

    const visible = await filterVisibleMessages(ctx)

    expect(visible).toEqual([rPublic])
    expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
    expect(channelAccessResolver).toHaveBeenCalledTimes(1)
  })

  it('isolates channel-hub errors so participant messages stay visible while failing closed for the errored thread', async () => {
    const rSent = makeResult(MSG_SENT)
    const rChannel = makeResult(MSG_CHANNEL_PUBLIC)
    const { ctx } = makeCtx({
      results: [rSent, rChannel],
      messages: [
        { id: MSG_SENT, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_A, isDraft: false, visibility: 'internal' },
        {
          id: MSG_CHANNEL_PUBLIC,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          senderUserId: USER_B,
          isDraft: false,
          visibility: 'public',
          threadId: THREAD_ID,
          sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
        },
      ],
      userHasAllFeatures: jest.fn().mockResolvedValue(true),
      channelAccessResolver: jest.fn().mockRejectedValue(new Error('hub unavailable')),
    })

    const visible = await filterVisibleMessages(ctx)

    expect(visible).toEqual([rSent])
  })

  it('denies non-participant private messages even for a superadmin', async () => {
    const rPrivate = makeResult(MSG_PRIVATE)
    const { ctx } = makeCtx({
      results: [rPrivate],
      messages: [
        { id: MSG_PRIVATE, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_B, isDraft: false, visibility: 'internal' },
      ],
      authOverrides: { isSuperAdmin: true },
    })

    expect(await filterVisibleMessages(ctx)).toEqual([])
  })

  it('fails closed for API-key callers and non-UUID subjects without querying DB', async () => {
    const apiKeyCtx = makeCtx({
      results: [makeResult(MSG_SENT)],
      authOverrides: { sub: 'api_key:key-1', userId: undefined, isApiKey: true, keyId: 'key-1' },
    })
    expect(await filterVisibleMessages(apiKeyCtx.ctx)).toEqual([])
    expect(mockedFindWithDecryption).not.toHaveBeenCalled()

    const badSubCtx = makeCtx({
      results: [makeResult(MSG_SENT)],
      authOverrides: { sub: 'not-a-uuid', userId: undefined },
    })
    expect(await filterVisibleMessages(badSubCtx.ctx)).toEqual([])
    expect(mockedFindWithDecryption).not.toHaveBeenCalled()
  })

  it('sanitizes non-UUID recordIds and enforces DB-row organization scope and empty organizationIds', async () => {
    const rValid = makeResult(MSG_SENT)
    const rBadId = makeResult('stale-non-uuid-id')
    const rOtherOrg = makeResult(MSG_OTHER_ORG, ORG_ID)
    const { ctx } = makeCtx({
      results: [rValid, rBadId, rOtherOrg],
      messages: [
        { id: MSG_SENT, tenantId: TENANT_ID, organizationId: ORG_ID, senderUserId: USER_A, isDraft: false, visibility: 'internal' },
        { id: MSG_OTHER_ORG, tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, senderUserId: USER_A, isDraft: false, visibility: 'internal' },
      ],
    })

    const visible = await filterVisibleMessages(ctx)
    expect(visible).toEqual([rValid])
    expect(mockedFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      Message,
      { id: { $in: [MSG_SENT, MSG_OTHER_ORG] }, tenantId: TENANT_ID, deletedAt: null },
      expect.anything(),
      expect.anything(),
    )

    const emptyOrgCtx = makeCtx({
      results: [rValid],
      organizationId: null,
      organizationIds: [],
    })
    expect(await filterVisibleMessages(emptyOrgCtx.ctx)).toEqual([])
  })

  it('throws when the request container is missing so SearchService fails closed', async () => {
    const { ctx } = makeCtx({ results: [makeResult(MSG_SENT)], omitContainer: true })
    await expect(filterVisibleMessages(ctx)).rejects.toThrow(/requires a request container/)
  })
})
