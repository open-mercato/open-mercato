import { DELETE, GET, POST } from '@open-mercato/core/modules/messages/api/[id]/attachments/route'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()
const getMessageAttachmentsMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  getMessageAttachments: (...args: unknown[]) => getMessageAttachmentsMock(...args),
  linkAttachmentsToMessage: jest.fn(),
}))

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('messages /api/messages/[id]/attachments', () => {
  let em: { findOne: jest.Mock; fork: jest.Mock }
  let emFork: { findOne: jest.Mock }
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    emFork = { findOne: jest.fn() }
    em = {
      findOne: jest.fn(),
      fork: jest.fn(() => emFork),
    }
    commandBus = {
      execute: jest.fn(async () => ({ result: { ok: true }, logEntry: null })),
    }

    getMessageAttachmentsMock.mockResolvedValue([])

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            if (name === 'commandBus') return commandBus
            return null
          },
        },
        auth: null,
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })
  })

  describe('GET', () => {
    it('returns 404 when message does not exist', async () => {
      em.findOne.mockResolvedValue(null)

      const response = await GET(new Request('http://localhost'), { params: { id: 'msg-1' } })

      expect(response.status).toBe(404)
    })

    it('returns 403 when organization access is denied', async () => {
      em.findOne.mockImplementation(async (entity: unknown) => {
        if (entity === Message) return { id: 'msg-1', organizationId: 'other-org', senderUserId: 'user-2' }
        return null
      })

      const response = await GET(new Request('http://localhost'), { params: { id: 'msg-1' } })

      expect(response.status).toBe(403)
    })

    it('returns 403 when user is not the sender and not a recipient', async () => {
      em.findOne.mockImplementation(async (entity: unknown) => {
        if (entity === Message) return { id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-2' }
        if (entity === MessageRecipient) return null
        return null
      })

      const response = await GET(new Request('http://localhost'), { params: { id: 'msg-1' } })

      expect(response.status).toBe(403)
    })

    it('returns attachments when user is the message sender', async () => {
      const attachments = [{ id: 'att-1', filename: 'document.pdf' }]
      getMessageAttachmentsMock.mockResolvedValue(attachments)

      em.findOne.mockImplementation(async (entity: unknown) => {
        if (entity === Message) return { id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-1' }
        return null
      })

      const response = await GET(new Request('http://localhost'), { params: { id: 'msg-1' } })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ attachments })
    })

    it('returns attachments when user is a message recipient', async () => {
      const attachments = [{ id: 'att-2', filename: 'report.pdf' }]
      getMessageAttachmentsMock.mockResolvedValue(attachments)

      em.findOne.mockImplementation(async (entity: unknown) => {
        if (entity === Message) return { id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-2' }
        if (entity === MessageRecipient) return { messageId: 'msg-1', recipientUserId: 'user-1' }
        return null
      })

      const response = await GET(new Request('http://localhost'), { params: { id: 'msg-1' } })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ attachments })
    })
  })

  describe('POST', () => {
    it('returns 404 when message does not exist', async () => {
      emFork.findOne.mockResolvedValue(null)

      const response = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ attachmentIds: [VALID_UUID] }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(404)
    })

    it('returns 403 when organization access is denied', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'other-org', senderUserId: 'user-1', isDraft: true })

      const response = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ attachmentIds: [VALID_UUID] }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(403)
    })

    it('returns 403 when user is not the sender', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-2', isDraft: true })

      const response = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ attachmentIds: [VALID_UUID] }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(403)
    })

    it('returns 409 when message is not a draft', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-1', isDraft: false })

      const response = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ attachmentIds: [VALID_UUID] }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(409)
    })

    it('links attachments to draft and returns ok', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-1', isDraft: true })

      const response = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ attachmentIds: [VALID_UUID] }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(commandBus.execute).toHaveBeenCalledWith(
        'messages.attachments.link_to_draft',
        expect.objectContaining({
          input: expect.objectContaining({
            messageId: 'msg-1',
            attachmentIds: [VALID_UUID],
            userId: 'user-1',
          }),
        }),
      )
    })
  })

  describe('DELETE', () => {
    it('returns 404 when message does not exist', async () => {
      emFork.findOne.mockResolvedValue(null)

      const response = await DELETE(
        new Request('http://localhost', {
          method: 'DELETE',
          body: JSON.stringify({ attachmentId: VALID_UUID }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(404)
    })

    it('returns 403 when user is not the sender', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-2', isDraft: true })

      const response = await DELETE(
        new Request('http://localhost', {
          method: 'DELETE',
          body: JSON.stringify({ attachmentId: VALID_UUID }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(403)
    })

    it('returns 409 when message is not a draft', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-1', isDraft: false })

      const response = await DELETE(
        new Request('http://localhost', {
          method: 'DELETE',
          body: JSON.stringify({ attachmentId: VALID_UUID }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(409)
    })

    it('unlinks attachment from draft and returns ok', async () => {
      emFork.findOne.mockResolvedValue({ id: 'msg-1', organizationId: 'org-1', senderUserId: 'user-1', isDraft: true })

      const response = await DELETE(
        new Request('http://localhost', {
          method: 'DELETE',
          body: JSON.stringify({ attachmentId: VALID_UUID }),
        }),
        { params: { id: 'msg-1' } },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(commandBus.execute).toHaveBeenCalledWith(
        'messages.attachments.unlink_from_draft',
        expect.objectContaining({
          input: expect.objectContaining({
            messageId: 'msg-1',
            userId: 'user-1',
          }),
        }),
      )
    })
  })
})
