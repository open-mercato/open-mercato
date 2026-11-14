/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const callerId = '33333333-3333-4333-8333-333333333333'
const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const reactionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const callOrder: string[] = []

const commandExecuteMock = jest.fn()
const findOneWithDecryptionMock = jest.fn(async () => {
  callOrder.push('lookup')
  return null
})
const afterSuccessMock = jest.fn(async () => undefined)
const validateRouteMutationGuardMock = jest.fn(async () => {
  callOrder.push('guard')
  return { result: null, afterSuccess: afterSuccessMock }
})

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
  validateRouteMutationGuard: (...args: unknown[]) => validateRouteMutationGuardMock(...args),
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
  findOneWithDecryptionMock.mockImplementationOnce(async () => {
    callOrder.push('lookup')
    return { id: reactionId, emoji: '👍' }
  })
  commandExecuteMock.mockResolvedValueOnce({ result })
  const response = await deleteReaction()
  return { status: response.status, body: await response.json() }
}

describe('DELETE /communication_channels/messages/[messageId]/reactions/[reactionId] existence masking (#3833)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    callOrder.length = 0
  })

  it('answers every refusal exactly like a missing reaction', async () => {
    findOneWithDecryptionMock.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      return null
    })
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
    findOneWithDecryptionMock.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      return { id: reactionId, emoji: '👍' }
    })
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'removed', messageId, emoji: '👍', enqueued: true, deleted: 1 },
    })
    const response = await deleteReaction()
    expect(response.status).toBe(204)
    expect(afterSuccessMock).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /communication_channels/messages/[messageId]/reactions/[reactionId] guard ordering (#7670)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    callOrder.length = 0
  })

  it('runs the mutation guard before looking up the reaction for an unknown reaction id', async () => {
    findOneWithDecryptionMock.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      return null
    })

    const response = await deleteReaction()

    expect(response.status).toBe(404)
    expect(callOrder).toEqual(['guard', 'lookup'])
    expect(validateRouteMutationGuardMock).toHaveBeenCalledTimes(1)
  })

  it('runs the mutation guard before looking up an existing-but-foreign reaction, producing the identical 404', async () => {
    // Scoped by tenant/org/message only — a reaction belonging to another
    // user's personal mailbox still matches here (ownership is enforced
    // downstream), so the lookup alone cannot distinguish "foreign" from
    // "unknown" without the guard having already run identically first.
    findOneWithDecryptionMock.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      return { id: reactionId, messageId, emoji: '👍' }
    })
    commandExecuteMock.mockResolvedValueOnce({
      result: { status: 'not_owner', reason: 'Not the reaction owner' },
    })

    const response = await deleteReaction()

    expect(response.status).toBe(404)
    expect(callOrder).toEqual(['guard', 'lookup'])
    expect(validateRouteMutationGuardMock).toHaveBeenCalledTimes(1)
  })

  it('passes mutationPayload without a reaction-derived emoji since the lookup has not run yet', async () => {
    findOneWithDecryptionMock.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      return null
    })

    await deleteReaction()

    expect(validateRouteMutationGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          resourceKind: 'communication_channels.message',
          resourceId: messageId,
          mutationPayload: { reactionId, action: 'remove' },
        }),
      }),
    )
  })

  it('short-circuits before touching the lookup when the guard blocks the request', async () => {
    const blockedResponse = new Response(JSON.stringify({ error: 'blocked' }), { status: 403 })
    validateRouteMutationGuardMock.mockImplementationOnce(async () => {
      callOrder.push('guard')
      return { response: blockedResponse }
    })

    const response = await deleteReaction()

    expect(response.status).toBe(403)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(callOrder).toEqual(['guard'])
  })
})
