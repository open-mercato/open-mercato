import {
  EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
  composeSourceHintSchema,
  resolveComposeSourceChannelType,
} from '../composeSourceChannelType'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440050'
const PARENT_MESSAGE_ID = '550e8400-e29b-41d4-a716-446655440051'

function containerWith(resolveChannelType: unknown) {
  return {
    resolve: (name: string) => {
      if (name === 'communicationChannelsResolveChannelType') return resolveChannelType
      throw new Error(`unexpected resolve: ${name}`)
    },
  }
}

describe('resolveComposeSourceChannelType (#4975)', () => {
  it('resolves the channel type from the conversation the message is composed on', async () => {
    const service = jest.fn(async () => 'discord')

    const result = await resolveComposeSourceChannelType(containerWith(service), SCOPE, {
      sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
      sourceEntityId: CONVERSATION_ID,
    })

    expect(result).toBe('discord')
    expect(service).toHaveBeenCalledWith(expect.anything(), SCOPE, {
      externalConversationId: CONVERSATION_ID,
      messageId: null,
    })
  })

  it('falls back to the parent message when no conversation is referenced', async () => {
    const service = jest.fn(async () => 'discord')

    const result = await resolveComposeSourceChannelType(containerWith(service), SCOPE, {
      parentMessageId: PARENT_MESSAGE_ID,
    })

    expect(result).toBe('discord')
    expect(service).toHaveBeenCalledWith(expect.anything(), SCOPE, {
      externalConversationId: null,
      messageId: PARENT_MESSAGE_ID,
    })
  })

  it('ignores a source entity id that does not name a channel conversation', async () => {
    const service = jest.fn(async () => 'discord')

    const result = await resolveComposeSourceChannelType(containerWith(service), SCOPE, {
      sourceEntityType: 'customers.person',
      sourceEntityId: CONVERSATION_ID,
    })

    expect(result).toBeUndefined()
    expect(service).not.toHaveBeenCalled()
  })

  it('returns undefined when nothing identifies a source', async () => {
    const service = jest.fn(async () => 'discord')

    expect(await resolveComposeSourceChannelType(containerWith(service), SCOPE, {})).toBeUndefined()
    expect(service).not.toHaveBeenCalled()
  })

  it('returns undefined when the communication_channels module is absent', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError')
      },
    }

    const result = await resolveComposeSourceChannelType(container, SCOPE, {
      sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
      sourceEntityId: CONVERSATION_ID,
    })

    expect(result).toBeUndefined()
  })

  it('reports an unresolved channel as unknown rather than a value', async () => {
    const result = await resolveComposeSourceChannelType(
      containerWith(jest.fn(async () => null)),
      SCOPE,
      { sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE, sourceEntityId: CONVERSATION_ID },
    )

    expect(result).toBeUndefined()
  })
})

describe('composeSourceHintSchema', () => {
  it('reads only the fields the resolution needs and tolerates the rest', () => {
    const parsed = composeSourceHintSchema.safeParse({
      sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
      sourceEntityId: CONVERSATION_ID,
      subject: 'Subject',
      body: 'Body',
      sourceChannelType: 'discord',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
      sourceEntityId: CONVERSATION_ID,
    })
  })
})
