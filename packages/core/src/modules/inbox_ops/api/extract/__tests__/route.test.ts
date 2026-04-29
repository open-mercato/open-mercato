/** @jest-environment node */

import { createHash } from 'node:crypto'
import { POST } from '../route'

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '55555555-5555-4555-8555-555555555555'

jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto')
  return {
    ...actual,
    randomUUID: () => SUBMISSION_ID,
  }
})

const expectedSourceVersion = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 32)

const mockEmitSourceSubmissionRequested = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/source-submission-request', () => ({
  emitSourceSubmissionRequested: (...args: unknown[]) => mockEmitSourceSubmissionRequested(...args),
}))

const mockResolveRequestContext = jest.fn()
const mockHandleRouteError = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/api/routeHelpers', () => ({
  resolveRequestContext: (...args: unknown[]) => mockResolveRequestContext(...args),
  handleRouteError: (...args: unknown[]) => mockHandleRouteError(...args),
}))

describe('POST /api/inbox_ops/extract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveRequestContext.mockResolvedValue({
      em: { id: 'em' },
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
    })
    mockEmitSourceSubmissionRequested.mockResolvedValue(undefined)
    mockHandleRouteError.mockImplementation(() => new Response('error', { status: 500 }))
  })

  it('queues a manual source submission request and returns the deprecated emailId alias', async () => {
    const text = 'Please create an order for 10 widgets.'
    const request = new Request('http://localhost/api/inbox_ops/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        title: 'Manual extract',
        metadata: { sourceLabel: 'clipboard' },
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    const sourceVersion = expectedSourceVersion(text)
    expect(response.status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      sourceSubmissionId: SUBMISSION_ID,
      emailId: SUBMISSION_ID,
    })
    expect(mockEmitSourceSubmissionRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        descriptor: expect.objectContaining({
          sourceEntityType: 'inbox_ops:source_submission',
          sourceEntityId: SUBMISSION_ID,
          sourceVersion,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          requestedByUserId: USER_ID,
        }),
        metadata: expect.objectContaining({
          source: 'text_extract',
          sourceLabel: 'clipboard',
          submittedByUserId: USER_ID,
        }),
        initialNormalizedInput: expect.objectContaining({
          sourceEntityType: 'inbox_ops:source_submission',
          sourceEntityId: SUBMISSION_ID,
          sourceVersion,
          title: 'Manual extract',
          body: text,
          bodyFormat: 'text',
        }),
      }),
    )
  })

  it('produces the same content-addressed sourceVersion for identical submissions', async () => {
    const text = 'Identical body for dedup hashing.'
    const buildRequest = () => new Request('http://localhost/api/inbox_ops/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    await POST(buildRequest())
    await POST(buildRequest())

    expect(mockEmitSourceSubmissionRequested).toHaveBeenCalledTimes(2)
    const firstCall = mockEmitSourceSubmissionRequested.mock.calls[0][0]
    const secondCall = mockEmitSourceSubmissionRequested.mock.calls[1][0]
    expect(firstCall.descriptor.sourceVersion).toBe(secondCall.descriptor.sourceVersion)
    expect(firstCall.descriptor.sourceVersion).toBe(expectedSourceVersion(text))
  })

  it('produces a different sourceVersion when the body text changes', async () => {
    const buildRequest = (text: string) => new Request('http://localhost/api/inbox_ops/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    await POST(buildRequest('Body A'))
    await POST(buildRequest('Body B'))

    const firstCall = mockEmitSourceSubmissionRequested.mock.calls[0][0]
    const secondCall = mockEmitSourceSubmissionRequested.mock.calls[1][0]
    expect(firstCall.descriptor.sourceVersion).not.toBe(secondCall.descriptor.sourceVersion)
  })

  it('rejects invalid request bodies before calling the submission service', async () => {
    const request = new Request('http://localhost/api/inbox_ops/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('Text is required')
    expect(mockEmitSourceSubmissionRequested).not.toHaveBeenCalled()
  })
})
