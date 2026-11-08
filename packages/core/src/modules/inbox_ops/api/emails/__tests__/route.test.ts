/** @jest-environment node */

import { GET } from '../route'
import { InboxEmail, InboxEmailAttachment } from '../../../data/entities'

const mockFindAndCountWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockUserHasAllFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
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
    mockFindWithDecryption.mockResolvedValue([])
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

  describe('attachmentsRetryable', () => {
    const page = [
      { ...email, id: 'email-pending', attachmentsStatus: 'pending' },
      { ...email, id: 'email-processing', attachmentsStatus: 'processing' },
      { ...email, id: 'email-timed-out', attachmentsStatus: 'completed' },
      { ...email, id: 'email-completed', attachmentsStatus: 'completed' },
      { ...email, id: 'email-plain', attachmentsStatus: null },
    ]

    it('is true for open ingests and for finished ones with an operator-fixable failed part, from one ledger query', async () => {
      mockUserHasAllFeatures.mockResolvedValue(true)
      mockFindAndCountWithDecryption.mockResolvedValue([page, page.length])
      mockFindWithDecryption.mockResolvedValue([{ id: 'part-1', inboxEmailId: 'email-timed-out' }])

      const response = await GET(new Request('http://localhost/api/inbox_ops/emails'))
      const payload = await response.json()

      expect(payload.items.map((item: { id: string; attachmentsRetryable: unknown; attachmentsStatus: unknown }) => [item.id, item.attachmentsStatus, item.attachmentsRetryable])).toEqual([
        ['email-pending', 'pending', true],
        ['email-processing', 'processing', true],
        ['email-timed-out', 'completed', true],
        ['email-completed', 'completed', false],
        ['email-plain', null, false],
      ])
      expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
      expect(mockFindWithDecryption).toHaveBeenCalledWith(
        mockEm,
        InboxEmailAttachment,
        {
          inboxEmailId: { $in: ['email-timed-out', 'email-completed'] },
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          status: 'failed',
          reason: { $in: ['ingest_timeout', 'quota_exceeded', 'partition_unavailable'] },
          deletedAt: null,
        },
        { fields: ['id', 'inboxEmailId'] },
        { tenantId: 'tenant-1', organizationId: 'org-1' },
      )
    })

    it('runs no ledger query for a page without finished ingests', async () => {
      mockUserHasAllFeatures.mockResolvedValue(true)
      mockFindAndCountWithDecryption.mockResolvedValue([[page[0], page[4]], 2])

      const payload = await (await GET(new Request('http://localhost/api/inbox_ops/emails'))).json()

      expect(payload.items.map((item: { attachmentsRetryable: unknown }) => item.attachmentsRetryable)).toEqual([true, false])
      expect(mockFindWithDecryption).not.toHaveBeenCalled()
    })

    it('is redacted with attachmentsStatus for log-only viewers, without querying the ledger', async () => {
      mockUserHasAllFeatures.mockResolvedValue(false)
      mockFindAndCountWithDecryption.mockResolvedValue([page, page.length])

      const payload = await (await GET(new Request('http://localhost/api/inbox_ops/emails'))).json()

      for (const item of payload.items as Array<Record<string, unknown>>) {
        expect(item.attachmentsRetryable).toBeNull()
        expect(item.attachmentsStatus).toBeNull()
      }
      expect(mockFindWithDecryption).not.toHaveBeenCalled()
    })
  })
})
