/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const callerId = '33333333-3333-4333-8333-333333333333'
const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const reactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const commandExecuteMock = jest.fn()
const afterSuccessMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'commandBus') return { execute: commandExecuteMock }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string) => `translated:${key}`,
  }),
}))

jest.mock('../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: jest.fn(async () => ({ result: null, afterSuccess: afterSuccessMock })),
}))

import { POST } from '../route'

const auth = { sub: callerId, tenantId, orgId: organizationId }

function postReaction() {
  return POST(
    new Request(`http://localhost/api/communication_channels/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emoji: '👍' }),
    }),
    { params: { messageId }, auth },
  )
}

describe('POST /communication_channels/messages/[messageId]/reactions existence masking (#3833)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('answers a message in another user\'s personal mailbox exactly like an unknown message', async () => {
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'not_owner', reason: 'channel is owned by another user' },
    })
    const foreign = await postReaction()
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'not_found', reason: 'message not found' },
    })
    const unknown = await postReaction()

    expect(foreign.status).toBe(404)
    expect(unknown.status).toBe(404)
    const foreignBody = await foreign.json()
    expect(foreignBody).toEqual({ error: 'translated:communication_channels.errors.messageNotFound' })
    expect(await unknown.json()).toEqual(foreignBody)
    expect(afterSuccessMock).not.toHaveBeenCalled()
  })

  it('keeps 409 for an accessible message that is not channel-linked', async () => {
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'no_channel_link', reason: 'message is not channel-linked' },
    })
    const response = await postReaction()
    expect(response.status).toBe(409)
    expect(afterSuccessMock).not.toHaveBeenCalled()
  })

  it('keeps 409 for a duplicate reaction', async () => {
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'noop', reason: 'duplicate reaction from same user with same emoji' },
    })
    const response = await postReaction()
    expect(response.status).toBe(409)
  })

  it('still lets the owner add a reaction', async () => {
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'added', reactionId, messageId, emoji: '👍', replaced: 0, enqueued: true },
    })
    const response = await postReaction()
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      id: reactionId,
      messageId,
      emoji: '👍',
      replaced: 0,
      enqueued: true,
    })
    expect(afterSuccessMock).toHaveBeenCalledTimes(1)
  })
})
