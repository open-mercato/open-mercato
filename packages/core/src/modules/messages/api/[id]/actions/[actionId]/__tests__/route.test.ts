import { POST } from '@open-mercato/core/modules/messages/api/[id]/actions/[actionId]/route'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

describe('messages action execution route', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    commandBus = {
      execute: jest.fn(async () => ({
        result: {
          ok: true,
          actionId: 'approve',
          result: { ok: true },
          operationLogEntry: null,
        },
      })),
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })
  })

  it('delegates action execution to command and returns command result', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ amount: 10 }),
      }),
      { params: { id: 'message-1', actionId: 'approve' } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      actionId: 'approve',
      result: { ok: true },
    })

    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.actions.execute',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          actionId: 'approve',
          userId: 'user-1',
          payload: { amount: 10 },
        }),
      }),
    )
  })

  it('maps command errors to route status codes', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Actions have expired'))

    const response = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: { id: 'message-1', actionId: 'approve' },
    })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Actions have expired',
    })
  })
})
