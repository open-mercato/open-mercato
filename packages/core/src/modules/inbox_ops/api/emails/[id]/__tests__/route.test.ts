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

const email = {
  id: 'email-1',
  subject: 'Operational subject',
  forwardedByAddress: 'sender@example.test',
  status: 'processed',
  receivedAt: new Date('2026-07-11T10:00:00.000Z'),
  rawText: 'sensitive plain body',
  rawHtml: '<p>sensitive html body</p>',
  cleanedText: 'sensitive cleaned body',
  threadMessages: [{ body: 'sensitive thread' }],
  metadata: { sensitive: true },
  organizationId: 'org-1',
  tenantId: 'tenant-1',
}

describe('GET /api/inbox_ops/emails/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockFindOneWithDecryption.mockResolvedValue(email)
  })

  it('redacts correspondence fields from log-only viewers', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails/email-1'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.email).toMatchObject({
      id: 'email-1',
      subject: 'Operational subject',
      forwardedByAddress: 'sender@example.test',
      status: 'processed',
      rawText: null,
      rawHtml: null,
      cleanedText: null,
      threadMessages: null,
      metadata: null,
      organizationId: null,
      tenantId: null,
    })
    expect(JSON.stringify(payload)).not.toContain('sensitive')
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxEmail,
      expect.objectContaining({
        id: 'email-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        deletedAt: null,
      }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('preserves the full response for viewers allowed to read email threads', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)

    const response = await GET(new Request('http://localhost/api/inbox_ops/emails/email-1'))
    const payload = await response.json()

    expect(payload.email).toMatchObject({
      rawText: 'sensitive plain body',
      rawHtml: '<p>sensitive html body</p>',
      cleanedText: 'sensitive cleaned body',
      threadMessages: [{ body: 'sensitive thread' }],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
