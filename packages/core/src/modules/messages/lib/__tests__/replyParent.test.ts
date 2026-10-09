jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const resolveMessageChannelThreadAccessMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/channelThreadAccess', () => ({
  ...jest.requireActual('@open-mercato/core/modules/messages/lib/channelThreadAccess'),
  resolveMessageChannelThreadAccess: (...args: unknown[]) => resolveMessageChannelThreadAccessMock(...args),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from '@open-mercato/core/modules/messages/lib/channelThreadAccess'
import {
  resolveMessageReadAccess,
  resolveReplyParentMessage,
} from '@open-mercato/core/modules/messages/lib/routeHelpers'

const findOne = findOneWithDecryption as unknown as jest.Mock

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const CALLER = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const PARENT = '55555555-5555-4555-8555-555555555555'
const THREAD = '66666666-6666-4666-8666-666666666666'

type Fixture = {
  recipient?: Record<string, unknown> | null
  hasFallbackFeature?: boolean
}

function makeCtx(fixture: Fixture = {}) {
  const em = { findOne: jest.fn(async () => fixture.recipient ?? null) }
  const rbac = { userHasAllFeatures: jest.fn(async () => fixture.hasFallbackFeature ?? true) }
  return {
    ctx: {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'rbacService') return rbac
          return null
        },
      },
      auth: null,
    } as never,
    em,
  }
}

const scope = { tenantId: TENANT, organizationId: ORG, userId: CALLER }

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: PARENT,
    senderUserId: OTHER,
    visibility: 'internal',
    threadId: THREAD,
    sourceEntityType: null,
    ...overrides,
  }
}

describe('resolveMessageReadAccess', () => {
  beforeEach(() => {
    resolveMessageChannelThreadAccessMock.mockReset()
    resolveMessageChannelThreadAccessMock.mockResolvedValue(null)
  })

  it('lets the sender read', async () => {
    const { ctx } = makeCtx()
    const access = await resolveMessageReadAccess(ctx, scope, message({ senderUserId: CALLER }) as never)
    expect(access).toMatchObject({ isSender: true, canRead: true })
  })

  it('lets a live recipient read, looking only at undeleted recipient rows of the caller', async () => {
    const { ctx, em } = makeCtx({ recipient: { id: 'r1', status: 'unread' } })
    const access = await resolveMessageReadAccess(ctx, scope, message() as never)
    expect(access.canRead).toBe(true)
    expect(em.findOne).toHaveBeenCalledWith(MessageRecipient, {
      messageId: PARENT,
      recipientUserId: CALLER,
      deletedAt: null,
    })
  })

  it('denies a non-participant on an internal thread', async () => {
    const { ctx } = makeCtx()
    const access = await resolveMessageReadAccess(ctx, scope, message() as never)
    expect(access).toMatchObject({ isSender: false, recipient: null, hasChannelThreadAccess: false, canRead: false })
  })

  it('lets a channel operator read a public channel message through the hub rule', async () => {
    resolveMessageChannelThreadAccessMock.mockResolvedValue({ messageThreadId: THREAD, canAccess: true })
    const { ctx } = makeCtx()
    const access = await resolveMessageReadAccess(
      ctx,
      scope,
      message({ visibility: 'public', sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }) as never,
    )
    expect(access).toMatchObject({ hasChannelThreadAccess: true, canRead: true })
  })

  it('never opens an internal note through channel access', async () => {
    resolveMessageChannelThreadAccessMock.mockResolvedValue({ messageThreadId: THREAD, canAccess: true })
    const { ctx } = makeCtx()
    const access = await resolveMessageReadAccess(
      ctx,
      scope,
      message({ visibility: 'internal', sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }) as never,
    )
    expect(access).toMatchObject({ hasChannelThreadAccess: true, canRead: false })
  })

  it('denies channel access without the fallback feature', async () => {
    resolveMessageChannelThreadAccessMock.mockResolvedValue({ messageThreadId: THREAD, canAccess: true })
    const { ctx } = makeCtx({ hasFallbackFeature: false })
    const access = await resolveMessageReadAccess(
      ctx,
      scope,
      message({ visibility: 'public', sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }) as never,
    )
    expect(access.canRead).toBe(false)
  })

  it('denies a public channel message the hub refuses', async () => {
    resolveMessageChannelThreadAccessMock.mockResolvedValue({ messageThreadId: THREAD, canAccess: false })
    const { ctx } = makeCtx()
    const access = await resolveMessageReadAccess(
      ctx,
      scope,
      message({ visibility: 'public', sourceEntityType: EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }) as never,
    )
    expect(access.canRead).toBe(false)
  })
})

describe('resolveReplyParentMessage', () => {
  beforeEach(() => {
    findOne.mockReset()
    resolveMessageChannelThreadAccessMock.mockReset()
    resolveMessageChannelThreadAccessMock.mockResolvedValue(null)
  })

  it('looks the parent up in exactly the caller tenant and organization, excluding deleted rows', async () => {
    findOne.mockResolvedValue(null)
    const { ctx } = makeCtx()

    const resolution = await resolveReplyParentMessage(ctx, scope, PARENT)

    expect(resolution).toEqual({ status: 'not_found' })
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      Message,
      { id: PARENT, tenantId: TENANT, organizationId: ORG, deletedAt: null },
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
  })

  it('binds a caller without an organization to messages without one', async () => {
    findOne.mockResolvedValue(null)
    const { ctx } = makeCtx()

    await resolveReplyParentMessage(ctx, { ...scope, organizationId: null }, PARENT)

    expect(findOne.mock.calls[0][2]).toEqual({ id: PARENT, tenantId: TENANT, organizationId: null, deletedAt: null })
  })

  it('answers forbidden for a parent in scope the caller cannot read', async () => {
    findOne.mockResolvedValue(message())
    const { ctx } = makeCtx()

    expect(await resolveReplyParentMessage(ctx, scope, PARENT)).toEqual({ status: 'forbidden' })
  })

  it('returns the parent when the caller can read it', async () => {
    const parent = message()
    findOne.mockResolvedValue(parent)
    const { ctx } = makeCtx({ recipient: { id: 'r1' } })

    expect(await resolveReplyParentMessage(ctx, scope, PARENT)).toEqual({ status: 'readable', message: parent })
  })
})
