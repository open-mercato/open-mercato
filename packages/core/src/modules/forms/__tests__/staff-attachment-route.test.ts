/** @jest-environment node */

import { NextRequest } from 'next/server'
import { GET } from '../api/submissions/[submissionId]/attachments/[attachmentId]/route'

const mockGetAuth = jest.fn()
const mockCreateContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateContainer(...args),
}))

it('returns an authenticated staff download with sandboxed attachment headers', async () => {
  const auth = { sub: 'staff-user', orgId: 'org-1', tenantId: 'tenant-1' }
  const params = { submissionId: 'submission-1', attachmentId: 'attachment-1' }
  const bytes = Buffer.from('attachment contents')
  const readUpload = jest.fn().mockResolvedValue({
    bytes,
    filename: 'upload.txt',
    contentType: 'text/plain',
  })
  const services = {
    em: {},
    formsAttachmentService: { readUpload },
    formsAccessAuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
  }
  mockGetAuth.mockResolvedValue(auth)
  mockCreateContainer.mockResolvedValue({
    resolve: (key: keyof typeof services) => services[key],
  })

  const request = new NextRequest(
    `http://localhost/api/forms/submissions/${params.submissionId}/attachments/${params.attachmentId}`,
  )
  const response = await GET(request, { params: Promise.resolve(params) })

  expect(readUpload).toHaveBeenCalledWith({
    ...params,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="upload.txt"')
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
})
