/** @jest-environment node */

import handle, { metadata } from '../source-submission-requested'

const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

const mockSubmitSourceSubmission = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/source-submission-service', () => ({
  submitSourceSubmission: (...args: unknown[]) => mockSubmitSourceSubmission(...args),
}))

const mockEm = {
  fork: jest.fn(),
}

const mockCtx = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    throw new Error(`Unknown DI token: ${token}`)
  }),
}

describe('source-submission-requested subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockSubmitSourceSubmission.mockResolvedValue({
      created: true,
      submission: { id: 'submission-1' },
    })
  })

  it('registers as a persistent exact-match subscriber', () => {
    expect(metadata).toEqual({
      event: 'inbox_ops.source_submission.requested',
      persistent: true,
      id: 'inbox_ops:source-submission-requested',
    })
  })

  it('parses the payload and delegates persistence to the shared submission service', async () => {
    await handle({
      descriptor: {
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: '22222222-2222-4222-8222-222222222222',
        sourceVersion: 'version-1',
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      },
      legacyInboxEmailId: '22222222-2222-4222-8222-222222222222',
    }, mockCtx)

    expect(mockSubmitSourceSubmission).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        descriptor: expect.objectContaining({
          sourceEntityType: 'inbox_ops:inbox_email',
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
        }),
        legacyInboxEmailId: '22222222-2222-4222-8222-222222222222',
      }),
    )
  })

  it('rejects malformed request payloads', async () => {
    await expect(handle({ descriptor: {} }, mockCtx)).rejects.toThrow()
    expect(mockSubmitSourceSubmission).not.toHaveBeenCalled()
  })
})
