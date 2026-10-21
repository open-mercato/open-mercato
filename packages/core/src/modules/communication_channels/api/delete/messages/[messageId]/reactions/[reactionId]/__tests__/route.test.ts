/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const callerId = '33333333-3333-4333-8333-333333333333'
const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const reactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const commandExecuteMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const afterSuccessMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'commandBus') return { execute: commandExecuteMock }
      if (name === 'em') return { fork: () => ({}) }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string) => `translated:${key}`,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: jest.fn(async () => ({ result: null, afterSuccess: afterSuccessMock })),
}))

import { DELETE } from '../route'

const auth = { sub: callerId, tenantId, orgId: organizationId }

function deleteReaction() {
  return DELETE(
    new Request(
      `http://localhost/api/communication_channels/messages/${messageId}/reactions/${reactionId}`,
      { method: 'DELETE' },
    ),
    { params: { messageId, reactionId }, auth },
  )
}

async function bodyForCommandResult(result: Record<string, unknown>) {
  findOneWithDecryptionMock.mockResolvedValueOnce({ id: reactionId, emoji: '👍' })
  commandExecuteMock.mockResolvedValueOnce({ result })
  const response = await deleteReaction()
  return { status: response.status, body: await response.json() }
}

describe('DELETE /communication_channels/messages/[messageId]/reactions/[reactionId] existence masking (#3833)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('answers every refusal exactly like a missing reaction', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    const missing = await deleteReaction()
    expect(missing.status).toBe(404)
    const missingBody = await missing.json()
    expect(missingBody).toEqual({ error: 'translated:communication_channels.errors.reactionNotFound' })

    const refusals = [
      { status: 'not_owner', reason: 'channel is owned by another user' },
      { status: 'not_found', reason: 'message not found' },
      { status: 'noop', reason: 'reaction not owned by current user' },
    ]
    for (const refusal of refusals) {
      expect(await bodyForCommandResult(refusal)).toEqual({ status: 404, body: missingBody })
    }
    expect(afterSuccessMock).not.toHaveBeenCalled()
  })

  it('keeps 409 for a message that is not channel-linked', async () => {
    const outcome = await bodyForCommandResult({
      status: 'no_channel_link',
      reason: 'message is not channel-linked',
    })
    expect(outcome.status).toBe(409)
    expect(afterSuccessMock).not.toHaveBeenCalled()
  })

  it('still lets the owner remove their reaction', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce({ id: reactionId, emoji: '👍' })
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'removed', messageId, emoji: '👍', enqueued: true, deleted: 1 },
    })
    const response = await deleteReaction()
    expect(response.status).toBe(204)
    expect(afterSuccessMock).toHaveBeenCalledTimes(1)
  })
})
