/** @jest-environment node */

import { GET } from '../route'
import { InboxEmail } from '../../../data/entities'

const mockFindAndCountWithDecryption = jest.fn()
const mockUserHasAllFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
  })),
}))

const mockEm = { fork: jest.fn() }
const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

const logEmail = {
  id: 'email-1',
  subject: 'Operational subject',
  forwardedByAddress: 'sender@example.test',
  forwardedByName: 'Sender',
  status: 'processed',
  processingError: null,
  receivedAt: new Date('2026-07-11T10:00:00.000Z'),
  organizationId: 'org-1',
  tenantId: 'tenant-1',
}

const email = {
  ...logEmail,
  messageId: 'message-1',
  contentHash: 'content-hash',
  toAddress: 'inbox@example.test',
  replyTo: 'reply@example.test',
  inReplyTo: 'previous-message',
  emailReferences: ['previous-message'],
  rawText: 'sensitive plain body',
  rawHtml: '<p>sensitive html body</p>',
  cleanedText: 'sensitive cleaned body',
  threadMessages: [{ body: 'sensitive thread' }],
  detectedLanguage: 'en',
  attachmentIds: ['attachment-1'],
  isActive: true,
  metadata: { sensitive: true },
  createdAt: new Date('2026-07-11T10:00:00.000Z'),
  updatedAt: new Date('2026-07-11T10:00:00.000Z'),
  deletedAt: null,
}

describe('GET /api/inbox_ops/emails', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
  })

  it('loads only scoped log fields and preserves redacted response keys', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)
    mockFindAndCountWithDecryption.mockResolvedValue([[logEmail], 3])

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails?status=processed&page=2&pageSize=2'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      items: [{
        ...logEmail,
        receivedAt: '2026-07-11T10:00:00.000Z',
        messageId: null,
        contentHash: null,
        toAddress: null,
        replyTo: null,
        inReplyTo: null,
        emailReferences: null,
        rawText: null,
        rawHtml: null,
        cleanedText: null,
        threadMessages: null,
        detectedLanguage: null,
        attachmentIds: null,
        isActive: null,
        metadata: null,
        organizationId: null,
        tenantId: null,
        createdAt: null,
        updatedAt: null,
        deletedAt: null,
      }],
      total: 3,
      page: 2,
      pageSize: 2,
      totalPages: 2,
    })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['inbox_ops.proposals.view'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxEmail,
      { tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null, status: 'processed' },
      {
        fields: Object.keys(logEmail),
        limit: 2,
        offset: 2,
        orderBy: { receivedAt: 'DESC' },
      },
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('preserves the full response for viewers allowed to read email threads', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockFindAndCountWithDecryption.mockResolvedValue([[email], 1])

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails'))
    const payload = await response.json()

    expect(payload.items[0]).toEqual({
      ...email,
      receivedAt: email.receivedAt.toISOString(),
      createdAt: email.createdAt.toISOString(),
      updatedAt: email.updatedAt.toISOString(),
    })
    const [, , , options] = mockFindAndCountWithDecryption.mock.calls[0]
    expect(options).not.toHaveProperty('fields')
  })
})
