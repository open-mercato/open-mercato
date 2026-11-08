/** @jest-environment node */

const mockNativeUpdate = jest.fn()
const mockRelease = jest.fn()
const mockReportError = jest.fn()
const mockAttachmentService = { releaseScoped: jest.fn(), releaseOwnedScoped: jest.fn() }
const mockEncryptionService = { encryptEntityPayload: jest.fn() }
const mockGuardAfterSuccess = jest.fn()

const mockCtx = {
  auth: { sub: 'user-1', tenantId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222' },
  userId: 'user-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  scope: {},
  em: { nativeUpdate: (...args: unknown[]) => mockNativeUpdate(...args) },
  container: {
    resolve: (name: string) => {
      if (name === 'attachmentService') return mockAttachmentService
      if (name === 'tenantEncryptionService') return mockEncryptionService
      throw new Error(`unregistered ${name}`)
    },
  },
  eventBus: null,
}

jest.mock('../../../routeHelpers', () => ({
  resolveRequestContext: jest.fn(async () => mockCtx),
  extractPathSegment: (url: URL, after: string) => {
    const segments = url.pathname.split('/')
    return segments[segments.indexOf(after) + 1] ?? null
  },
  UnauthorizedError: class UnauthorizedError extends Error {},
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: null })),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockGuardAfterSuccess(...args),
}))
jest.mock('../../../../lib/inboundAttachmentRelease', () => ({
  ...jest.requireActual('../../../../lib/inboundAttachmentRelease'),
  releaseInboundEmailAttachments: (...args: unknown[]) => mockRelease(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

import { DELETE } from '../route'
import { InboxEmail } from '../../../../data/entities'

const EMAIL_ID = '33333333-3333-4333-8333-333333333333'

function request() {
  return new Request(`http://localhost/api/inbox_ops/emails/${EMAIL_ID}`, { method: 'DELETE' })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockNativeUpdate.mockResolvedValue(1)
  mockRelease.mockResolvedValue({ fullyReleased: true })
})

describe('DELETE /api/inbox_ops/emails/[id]', () => {
  it('soft-deletes, requests release and invalidates the claim in one update, then releases after it', async () => {
    const response = await DELETE(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mockNativeUpdate).toHaveBeenCalledTimes(1)
    const [entity, where, data] = mockNativeUpdate.mock.calls[0] as [unknown, Record<string, unknown>, Record<string, unknown>]
    expect(entity).toBe(InboxEmail)
    expect(where).toEqual({ id: EMAIL_ID, organizationId: mockCtx.organizationId, tenantId: mockCtx.tenantId, deletedAt: null })
    expect(data.deletedAt).toBeInstanceOf(Date)
    expect(data.attachmentsReleaseRequestedAt).toBe(data.deletedAt)
    expect(data.attachmentsClaimToken).toBeNull()
    expect((data.attachmentsStatus as { sql: string }).sql).toContain(`case when "attachments_status" is null then null else 'completed' end`)
    expect('updatedAt' in data).toBe(false)
    expect(mockRelease).toHaveBeenCalledWith({
      em: mockCtx.em,
      email: { id: EMAIL_ID, tenantId: mockCtx.tenantId, organizationId: mockCtx.organizationId },
      attachmentService: mockAttachmentService,
      encryptionService: mockEncryptionService,
    })
    expect(mockNativeUpdate.mock.invocationCallOrder[0]).toBeLessThan(mockRelease.mock.invocationCallOrder[0])
    expect(mockGuardAfterSuccess).toHaveBeenCalled()
  })

  it('keeps answering 200 when the release fails, and reports it for the sweep', async () => {
    mockRelease.mockRejectedValue(new Error('storage down'))
    const response = await DELETE(request())
    expect(response.status).toBe(200)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'inbox_ops.attachment_release_failed' }))
  })

  it('answers 404 and releases nothing for a missing or already deleted email', async () => {
    mockNativeUpdate.mockResolvedValue(0)
    const response = await DELETE(request())
    expect(response.status).toBe(404)
    expect(mockRelease).not.toHaveBeenCalled()
  })
})
