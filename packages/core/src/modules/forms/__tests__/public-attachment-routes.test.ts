/** @jest-environment node */

const createRequestContainer = jest.fn()
const resolveRuntimePrincipal = jest.fn()
const parseUploadBody = jest.fn()
const enforcePublicRateLimit = jest.fn(async () => null)
const readUpload = jest.fn()
const ensureSnapshot = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('../lib/runtime-principal', () => ({
  resolveRuntimePrincipal: (...args: unknown[]) => resolveRuntimePrincipal(...args),
}))

jest.mock('../api/attachment-helpers', () => {
  const actual = jest.requireActual('../api/attachment-helpers')
  return {
    ...actual,
    parseUploadBody: (...args: unknown[]) => parseUploadBody(...args),
  }
})

jest.mock('../api/public/rate-limit', () => ({
  buildPublicRateLimitKey: (namespace: string, ...identifiers: string[]) =>
    `${namespace}:${identifiers.join(':')}`,
  enforcePublicRateLimit: (...args: unknown[]) => enforcePublicRateLimit(...args),
}))

jest.mock('../services/pdf-snapshot-service', () => ({
  PdfSnapshotService: class PdfSnapshotService {},
  PdfSnapshotServiceError: class PdfSnapshotServiceError extends Error {
    code = 'NOT_FOUND'
  },
}))

import { POST as uploadAttachment } from '../api/public/submissions/[id]/attachments/route'
import { GET as downloadAttachment } from '../api/public/submissions/[id]/attachments/[attachmentId]/route'
import { GET as downloadPdf } from '../api/public/submissions/[id]/pdf/route'

const principal = {
  source: 'token',
  principal: '00000000-0000-0000-0000-000000000004',
  role: 'patient',
  organizationId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
}

describe('Forms public attachment routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enforcePublicRateLimit.mockResolvedValue(null)
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'formsAttachmentService') return { readUpload, storeUpload: jest.fn() }
        if (name === 'formsPdfSnapshotService') return { ensureSnapshot }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    })
  })

  it('authenticates an upload before parsing or buffering multipart bytes', async () => {
    resolveRuntimePrincipal.mockResolvedValue(null)
    const request = new Request('http://test/api/forms/public/submissions/sub-1/attachments', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: '--test\r\nlarge-body-that-must-not-be-read',
    })

    const response = await uploadAttachment(request as never, { params: { id: 'sub-1' } })

    expect(response.status).toBe(401)
    expect(parseUploadBody).not.toHaveBeenCalled()
  })

  it('sets a sandbox CSP and nosniff on participant attachment downloads', async () => {
    resolveRuntimePrincipal.mockResolvedValue(principal)
    readUpload.mockResolvedValue({
      id: 'attachment-1',
      filename: 'participant.html',
      contentType: 'text/html',
      sizeBytes: 13,
      bytes: Buffer.from('<h1>unsafe</h1>'),
    })

    const response = await downloadAttachment(
      new Request('http://test/api/forms/public/submissions/sub-1/attachments/attachment-1') as never,
      { params: { id: 'sub-1', attachmentId: 'attachment-1' } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('sets the same download policy on generated PDF snapshots', async () => {
    resolveRuntimePrincipal.mockResolvedValue(principal)
    ensureSnapshot.mockResolvedValue({
      filename: 'submission.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF-test'),
    })

    const response = await downloadPdf(
      new Request('http://test/api/forms/public/submissions/sub-1/pdf') as never,
      { params: { id: 'sub-1' } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
