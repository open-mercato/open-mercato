import { PUT } from '@open-mercato/core/modules/messages/api/[id]/conversation/archive/route'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

describe('messages /api/messages/[id]/conversation/archive', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    commandBus = {
      execute: jest.fn(async () => ({ result: { ok: true, affectedCount: 3 } })),
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

  it('archives conversation recipients for current actor', async () => {
    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.conversation.archive_for_actor',
      expect.objectContaining({
        input: expect.objectContaining({
          anchorMessageId: 'message-1',
          userId: 'user-1',
        }),
      }),
    )
    await expect(response.json()).resolves.toEqual({ ok: true, affectedCount: 3 })
  })
})
