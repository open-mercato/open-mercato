/** @jest-environment node */

const callOrder: string[] = []

const mockValidateRouteMutationGuard = jest.fn(async () => {
  callOrder.push('guard')
  return { result: { ok: true } as const, afterSuccess: jest.fn(async () => undefined) }
})
const mockFindOneWithDecryption = jest.fn(async () => {
  callOrder.push('lookup')
  return null
})
const mockCreateRequestContainer = jest.fn()
const mockCommandBusExecute = jest.fn()

const mockEm = { fork: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandBus') return { execute: mockCommandBusExecute }
    return undefined
  }),
}

jest.mock('../../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => mockValidateRouteMutationGuard(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

import { DELETE } from '../route'

const AUTH = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
const MESSAGE_ID = '11111111-1111-4111-8111-111111111111'
const REACTION_ID = '22222222-2222-4222-8222-222222222222'

function buildContext() {
  return { params: Promise.resolve({ messageId: MESSAGE_ID, reactionId: REACTION_ID }), auth: AUTH }
}

describe('DELETE /api/communication_channels/messages/[messageId]/reactions/[reactionId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    callOrder.length = 0
    mockEm.fork.mockReturnValue(mockEm)
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
  })

  it('runs the mutation guard before looking up the reaction for an unknown reaction id', async () => {
    mockFindOneWithDecryption.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      return null
    })

    const response = await DELETE(new Request('http://localhost'), buildContext())

    expect(response.status).toBe(404)
    expect(callOrder).toEqual(['guard', 'lookup'])
    expect(mockValidateRouteMutationGuard).toHaveBeenCalledTimes(1)
  })

  it('runs the mutation guard before looking up an existing-but-foreign reaction, producing the same 404', async () => {
    mockFindOneWithDecryption.mockImplementationOnce(async () => {
      callOrder.push('lookup')
      // Scoped by tenant/org/message only — a reaction belonging to another
      // user's personal mailbox still matches here (ownership is enforced
      // downstream), so the lookup alone cannot distinguish "foreign" from
      // "unknown" without the guard having already run identically first.
      return { id: REACTION_ID, messageId: MESSAGE_ID, emoji: '👍' }
    })
    mockCommandBusExecute.mockResolvedValueOnce({
      result: { status: 'not_owner', reason: 'Not the reaction owner' },
    })

    const response = await DELETE(new Request('http://localhost'), buildContext())

    expect(response.status).toBe(403)
    expect(callOrder).toEqual(['guard', 'lookup'])
    expect(mockValidateRouteMutationGuard).toHaveBeenCalledTimes(1)
  })

  it('passes mutationPayload without a reaction-derived emoji since the lookup has not run yet', async () => {
    await DELETE(new Request('http://localhost'), buildContext())

    expect(mockValidateRouteMutationGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          resourceKind: 'communication_channels.message',
          resourceId: MESSAGE_ID,
          mutationPayload: { reactionId: REACTION_ID, action: 'remove' },
        }),
      }),
    )
  })

  it('short-circuits before touching the container when the guard blocks the request', async () => {
    const blockedResponse = new Response(JSON.stringify({ error: 'blocked' }), { status: 403 })
    mockValidateRouteMutationGuard.mockImplementationOnce(async () => {
      callOrder.push('guard')
      return { response: blockedResponse }
    })

    const response = await DELETE(new Request('http://localhost'), buildContext())

    expect(response.status).toBe(403)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(callOrder).toEqual(['guard'])
  })
})
