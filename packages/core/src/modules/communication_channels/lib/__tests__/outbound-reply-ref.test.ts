jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOutboundReplyExternalId, stripCallerReplyTargeting } from '../outbound-reply-ref'
import { ExternalMessage, MessageChannelLink } from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const PARENT_MESSAGE = '33333333-3333-3333-3333-333333333333'
const CONVERSATION = '44444444-4444-4444-4444-444444444444'
const OTHER_CONVERSATION = '55555555-5555-5555-5555-555555555555'
const PARENT_EXTERNAL_ROW = '66666666-6666-6666-6666-666666666666'

const PARENT_SNOWFLAKE = '1541185400817852538'

function em() {
  return {} as never
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    parentMessageId: PARENT_MESSAGE,
    externalConversationId: CONVERSATION,
    capabilities: { threading: true } as never,
    scope: { tenantId: TENANT, organizationId: ORG },
    ...overrides,
  } as Parameters<typeof resolveOutboundReplyExternalId>[1]
}

/** The parent's link row, as `ingest-inbound-message` writes it for an inbound message. */
function parentLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-parent',
    messageId: PARENT_MESSAGE,
    externalMessageId: PARENT_EXTERNAL_ROW,
    externalConversationId: CONVERSATION,
    ...overrides,
  } as never
}

function parentExternalMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: PARENT_EXTERNAL_ROW,
    externalMessageId: PARENT_SNOWFLAKE,
    conversationId: CONVERSATION,
    ...overrides,
  } as never
}

beforeEach(() => {
  mockFindOne.mockReset()
  mockFind.mockReset()
  mockFind.mockResolvedValue([])
})

describe('resolveOutboundReplyExternalId', () => {
  it('resolves the provider-native id of the message a reply answers', async () => {
    mockFind.mockResolvedValueOnce([parentLink()])
    mockFindOne.mockResolvedValueOnce(parentExternalMessage())

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBe(PARENT_SNOWFLAKE)

    // The links are looked up by the parent hub message id, under the caller's
    // tenant/org scope — never unscoped.
    const [, linkEntity, linkWhere] = mockFind.mock.calls[0]
    expect(linkEntity).toBe(MessageChannelLink)
    expect(linkWhere).toEqual({
      messageId: PARENT_MESSAGE,
      tenantId: TENANT,
      organizationId: ORG,
    })

    const [, externalEntity, externalWhere] = mockFindOne.mock.calls[0]
    expect(externalEntity).toBe(ExternalMessage)
    expect(externalWhere).toEqual({
      id: PARENT_EXTERNAL_ROW,
      tenantId: TENANT,
      organizationId: ORG,
    })
  })

  it('returns null for a provider that does not declare threading, without querying', async () => {
    // The regression #5541 guards against in the other direction: the hub must
    // not hand a provider a reply reference it will silently drop.
    await expect(
      resolveOutboundReplyExternalId(em(), baseInput({ capabilities: { threading: false } })),
    ).resolves.toBeNull()
    await expect(
      resolveOutboundReplyExternalId(em(), baseInput({ capabilities: null })),
    ).resolves.toBeNull()
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('returns null when the message is not a reply', async () => {
    await expect(
      resolveOutboundReplyExternalId(em(), baseInput({ parentMessageId: null })),
    ).resolves.toBeNull()
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('returns null when the parent never reached this channel', async () => {
    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()

    // A link exists but delivery never produced an ExternalMessage row (e.g. the
    // parent is still `pending` or `failed`).
    mockFind.mockResolvedValueOnce([parentLink({ externalMessageId: null })])
    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('refuses a parent that belongs to a different conversation', async () => {
    // Discord answers `400 Unknown message` for a cross-channel reference, so an
    // unthreaded reply is the better degradation.
    mockFind.mockResolvedValueOnce([parentLink({ externalConversationId: OTHER_CONVERSATION })])

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('picks the delivered link in this conversation when the parent was sent separately', async () => {
    mockFind.mockResolvedValueOnce([
      parentLink({ id: 'link-pending', externalMessageId: null }),
      parentLink({ id: 'link-other', externalConversationId: OTHER_CONVERSATION }),
      parentLink({ id: 'link-sent' }),
    ])
    mockFindOne.mockResolvedValueOnce(parentExternalMessage())

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBe(PARENT_SNOWFLAKE)
    expect(mockFindOne).toHaveBeenCalledTimes(1)
  })

  it('re-checks the conversation on the row that carries the provider id', async () => {
    // The link and the ExternalMessage are written together, so they cannot
    // disagree today; the guard holds independently of that coupling.
    mockFind.mockResolvedValueOnce([parentLink()])
    mockFindOne.mockResolvedValueOnce(parentExternalMessage({ conversationId: OTHER_CONVERSATION }))

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
  })

  it('returns null when the external row carries no usable provider id', async () => {
    mockFind.mockResolvedValueOnce([parentLink()])
    mockFindOne.mockResolvedValueOnce(parentExternalMessage({ externalMessageId: '' }))

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
  })
})

describe('stripCallerReplyTargeting', () => {
  it('removes both reply-targeting keys and keeps everything else', () => {
    const cleaned = stripCallerReplyTargeting({
      replyToExternalId: 'caller-1',
      messageReferenceId: 'caller-2',
      to: ['someone@example.com'],
      subject: 'hi',
    })

    expect(cleaned).toEqual({ to: ['someone@example.com'], subject: 'hi' })
  })

  it('does not mutate the caller-supplied object', () => {
    // The input is the live `MessageChannelLink.channelMetadata` row value, which
    // the delivery command still persists to on the success path.
    const stored = { messageReferenceId: 'caller-2', subject: 'hi' }

    stripCallerReplyTargeting(stored)

    expect(stored).toEqual({ messageReferenceId: 'caller-2', subject: 'hi' })
  })
})
