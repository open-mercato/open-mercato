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

const email = {
  id: 'email-1',
  messageId: 'message-1',
  contentHash: 'content-hash',
  forwardedByAddress: 'sender@example.test',
  forwardedByName: 'Sender',
  toAddress: 'inbox@example.test',
  subject: 'Operational subject',
  replyTo: 'reply@example.test',
  inReplyTo: 'previous-message',
  emailReferences: ['previous-message'],
  rawText: 'sensitive plain body',
  rawHtml: '<p>sensitive html body</p>',
  cleanedText: 'sensitive cleaned body',
  threadMessages: [{ body: 'sensitive thread' }],
  detectedLanguage: 'en',
  attachmentIds: ['attachment-1'],
  receivedAt: new Date('2026-07-11T10:00:00.000Z'),
  status: 'processed',
  processingError: null,
  isActive: true,
  metadata: { sensitive: true },
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  createdAt: new Date('2026-07-11T10:00:00.000Z'),
  updatedAt: new Date('2026-07-11T10:00:00.000Z'),
  deletedAt: null,
}

describe('GET /api/inbox_ops/emails', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockFindAndCountWithDecryption.mockResolvedValue([[email], 1])
  })

  it('redacts correspondence fields from log-only viewers while preserving metadata and keys', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items[0]).toMatchObject({
      id: 'email-1',
      subject: 'Operational subject',
      forwardedByAddress: 'sender@example.test',
      forwardedByName: 'Sender',
      status: 'processed',
      processingError: null,
      receivedAt: '2026-07-11T10:00:00.000Z',
      rawText: null,
      rawHtml: null,
      cleanedText: null,
      threadMessages: null,
      toAddress: null,
      replyTo: null,
      metadata: null,
      organizationId: null,
      tenantId: null,
    })
    expect(JSON.stringify(payload)).not.toContain('sensitive')
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['inbox_ops.proposals.view'],
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxEmail,
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null }),
      expect.any(Object),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('preserves the full response for viewers allowed to read email threads', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails'))
    const payload = await response.json()

    expect(payload.items[0]).toMatchObject({
      rawText: 'sensitive plain body',
      rawHtml: '<p>sensitive html body</p>',
      cleanedText: 'sensitive cleaned body',
      threadMessages: [{ body: 'sensitive thread' }],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
