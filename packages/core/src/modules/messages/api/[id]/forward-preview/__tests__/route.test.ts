import { GET } from '@open-mercato/core/modules/messages/api/[id]/forward-preview/route'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()
const buildForwardPreviewMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  hasOrganizationAccess: (scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined) => (
    scopeOrganizationId ? messageOrganizationId === scopeOrganizationId : messageOrganizationId == null
  ),
}))

jest.mock('@open-mercato/core/modules/messages/lib/forwarding', () => ({
  buildForwardPreview: (...args: unknown[]) => buildForwardPreviewMock(...args),
}))

describe('messages /api/messages/[id]/forward-preview', () => {
  let em: { fork: jest.Mock; findOne: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    em = {
      fork: jest.fn(),
      findOne: jest.fn(),
    }
    em.fork.mockReturnValue(em)

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
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

    buildForwardPreviewMock.mockResolvedValue({
      subject: 'Fwd: Subject',
      body: 'forward-body',
    })
  })

  it('returns preview for sender with 200', async () => {
    em.findOne
      .mockResolvedValueOnce({
        id: 'message-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        senderUserId: 'user-1',
      })

    const response = await GET(new Request('http://localhost'), { params: { id: 'message-1' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      subject: 'Fwd: Subject',
      body: 'forward-body',
    })
    expect(buildForwardPreviewMock).toHaveBeenCalled()
  })

  it('returns 404 when message is missing', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost'), { params: { id: 'missing' } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Message not found' })
  })

  it('returns 403 when actor has no access to message', async () => {
    em.findOne
      .mockResolvedValueOnce({
        id: 'message-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        senderUserId: 'user-2',
      })
      .mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost'), { params: { id: 'message-1' } })

    expect(em.findOne).toHaveBeenCalledWith(MessageRecipient, {
      messageId: 'message-1',
      recipientUserId: 'user-1',
      deletedAt: null,
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
  })

  it('returns 413 when generated preview exceeds length limit', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'message-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      senderUserId: 'user-1',
    })
    buildForwardPreviewMock.mockRejectedValueOnce(new Error('Forward body exceeds maximum length'))

    const response = await GET(new Request('http://localhost'), { params: { id: 'message-1' } })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Forward body exceeds maximum length' })
  })

  it('checks recipient access when actor is not sender', async () => {
    em.findOne
      .mockResolvedValueOnce({
        id: 'message-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        senderUserId: 'user-2',
      })
      .mockResolvedValueOnce({
        id: 'recipient-1',
        messageId: 'message-1',
        recipientUserId: 'user-1',
      })

    const response = await GET(new Request('http://localhost'), { params: { id: 'message-1' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      subject: 'Fwd: Subject',
      body: 'forward-body',
    })
    expect(em.findOne).toHaveBeenNthCalledWith(1, Message, {
      id: 'message-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    })
    expect(em.findOne).toHaveBeenNthCalledWith(2, MessageRecipient, {
      messageId: 'message-1',
      recipientUserId: 'user-1',
      deletedAt: null,
    })
  })
})
