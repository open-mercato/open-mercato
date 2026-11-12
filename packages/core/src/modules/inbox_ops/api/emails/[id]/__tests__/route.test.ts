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

const mockTranslate = jest.fn((key: string, fallback?: string) => `${key}|${fallback}`)
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: mockTranslate })),
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

const EMAIL_ID = '44444444-4444-4444-8444-444444444444'

const email = {
  id: EMAIL_ID,
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

    const response = await GET(new Request(`http://localhost/api/inbox_ops/emails/${EMAIL_ID}`))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.email).toMatchObject({
      id: EMAIL_ID,
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
        id: EMAIL_ID,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        deletedAt: null,
      }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it.each([true, false])('never returns the internal attachment-ingest columns (content viewer: %s)', async (canView) => {
    mockUserHasAllFeatures.mockResolvedValue(canView)
    mockFindOneWithDecryption.mockResolvedValueOnce({
      ...email,
      attachmentsStatus: 'pending',
      attachmentsClaimToken: '99999999-9999-4999-8999-999999999999',
      attachmentsClaimedAt: new Date('2026-11-08T10:01:00.000Z'),
      attachmentsFirstFailureAt: null,
      attachmentsReleaseRequestedAt: null,
      attachmentsReleasedAt: null,
      attachmentsIngestGeneration: 1,
      attachmentsCurrentGeneration: 1,
      attachmentsNextRunAt: new Date('2026-11-08T10:00:00.000Z'),
    })

    const response = await GET(new Request(`http://localhost/api/inbox_ops/emails/${EMAIL_ID}`))
    const payload = await response.json()

    expect(Object.keys(payload.email).filter((key) => key.startsWith('attachments'))).toEqual(['attachmentsStatus'])
    expect(payload.email.attachmentsStatus).toBe(canView ? 'pending' : null)
  })

  it('preserves the full response for viewers allowed to read email threads', async () => {
    mockUserHasAllFeatures.mockResolvedValue(true)

    const response = await GET(new Request(`http://localhost/api/inbox_ops/emails/${EMAIL_ID}`))
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

  it('answers 404 for a non-uuid id without querying', async () => {
    const response = await GET(new Request('http://localhost/api/inbox_ops/emails/not-a-uuid'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'inbox_ops.errors.emailNotFound|Email not found' })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('answers translated errors for a missing email and a failed load', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const missing = await GET(new Request(`http://localhost/api/inbox_ops/emails/${EMAIL_ID}`))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'inbox_ops.errors.emailNotFound|Email not found' })

    mockFindOneWithDecryption.mockRejectedValueOnce(new Error('db down'))
    const failed = await GET(new Request(`http://localhost/api/inbox_ops/emails/${EMAIL_ID}`))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'inbox_ops.errors.emailLoadFailed|Failed to load email' })
  })
})
