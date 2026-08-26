jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOutboundReplyExternalId } from '../outbound-reply-ref'
import { ExternalMessage, MessageChannelLink } from '../../data/entities'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

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
})

describe('resolveOutboundReplyExternalId', () => {
  it('resolves the provider-native id of the message a reply answers', async () => {
    mockFindOne.mockResolvedValueOnce(parentLink()).mockResolvedValueOnce(parentExternalMessage())

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBe(PARENT_SNOWFLAKE)

    // The link is looked up by the parent hub message id, under the caller's
    // tenant/org scope — never unscoped.
    const [, linkEntity, linkWhere] = mockFindOne.mock.calls[0]
    expect(linkEntity).toBe(MessageChannelLink)
    expect(linkWhere).toEqual({
      messageId: PARENT_MESSAGE,
      tenantId: TENANT,
      organizationId: ORG,
    })

    const [, externalEntity, externalWhere] = mockFindOne.mock.calls[1]
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
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('returns null when the message is not a reply', async () => {
    await expect(
      resolveOutboundReplyExternalId(em(), baseInput({ parentMessageId: null })),
    ).resolves.toBeNull()
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('returns null when the parent never reached this channel', async () => {
    mockFindOne.mockResolvedValueOnce(null as never)
    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()

    // A link exists but delivery never produced an ExternalMessage row (e.g. the
    // parent is still `pending` or `failed`).
    mockFindOne.mockReset()
    mockFindOne.mockResolvedValueOnce(parentLink({ externalMessageId: null }))
    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
    expect(mockFindOne).toHaveBeenCalledTimes(1)
  })

  it('refuses a parent that belongs to a different conversation', async () => {
    // Discord answers `400 Unknown message` for a cross-channel reference, so an
    // unthreaded reply is the better degradation.
    mockFindOne.mockResolvedValueOnce(
      parentLink({ externalConversationId: OTHER_CONVERSATION }),
    )

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
    expect(mockFindOne).toHaveBeenCalledTimes(1)
  })

  it('re-checks the conversation on the row that carries the provider id', async () => {
    // The link and the ExternalMessage are written together, so they cannot
    // disagree today; the guard holds independently of that coupling.
    mockFindOne
      .mockResolvedValueOnce(parentLink())
      .mockResolvedValueOnce(parentExternalMessage({ conversationId: OTHER_CONVERSATION }))

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
  })

  it('returns null when the external row carries no usable provider id', async () => {
    mockFindOne
      .mockResolvedValueOnce(parentLink())
      .mockResolvedValueOnce(parentExternalMessage({ externalMessageId: '' }))

    await expect(resolveOutboundReplyExternalId(em(), baseInput())).resolves.toBeNull()
  })
})
