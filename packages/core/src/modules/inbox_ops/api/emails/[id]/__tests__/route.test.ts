/** @jest-environment node */

import { GET } from '../route'
import { InboxEmail } from '../../../../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockUserHasAllFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
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
  rawText: 'sensitive plain body',
  rawHtml: '<p>sensitive html body</p>',
  cleanedText: 'sensitive cleaned body',
  threadMessages: [{ body: 'sensitive thread' }],
  metadata: { sensitive: true },
}

describe('GET /api/inbox_ops/emails/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
  })

  it.each(['denied', 'unavailable'] as const)('loads only log fields when content access is %s', async (access) => {
    if (access === 'denied') {
      mockUserHasAllFeatures.mockResolvedValue(false)
    } else {
      mockUserHasAllFeatures.mockRejectedValue(new Error('[internal] RBAC unavailable'))
    }
    mockFindOneWithDecryption.mockResolvedValue(logEmail)

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails/email-1'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.email).toEqual({
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
    })
    expect(mockUserHasAllFeatures.mock.invocationCallOrder[0]).toBeLessThan(
      mockFindOneWithDecryption.mock.invocationCallOrder[0],
    )
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxEmail,
      {
        id: 'email-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        deletedAt: null,
      },
      { fields: Object.keys(logEmail) },
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('preserves the full response for viewers allowed to read email threads', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockFindOneWithDecryption.mockResolvedValue(email)

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails/email-1'))
    const payload = await response.json()

    expect(payload.email).toEqual({
      ...email,
      receivedAt: email.receivedAt.toISOString(),
    })
    const [, , , options] = mockFindOneWithDecryption.mock.calls[0]
    expect(options).toBeUndefined()
  })
})
