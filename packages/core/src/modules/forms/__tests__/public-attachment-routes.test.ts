/** @jest-environment node */

const createRequestContainer = jest.fn()
const resolveRuntimePrincipal = jest.fn()
const parseUploadBody = jest.fn()
const enforcePublicRateLimit = jest.fn(async () => null)
const readUpload = jest.fn()
const storeUpload = jest.fn()
const emFindOne = jest.fn()
const ensureSnapshot = jest.fn()
const readSnapshotForViewer = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('../lib/runtime-principal', () => ({
  resolveRuntimePrincipal: (...args: unknown[]) => resolveRuntimePrincipal(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: { findOne: typeof emFindOne }, entity: unknown, where: unknown, options: unknown) =>
    em.findOne(entity, where, options),
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
import { FormAttachment, FormSubmission, FormVersion } from '../data/entities'
import { FormVersionCompiler } from '../services/form-version-compiler'
import { RolePolicyService } from '../services/role-policy-service'

const compiler = new FormVersionCompiler()
const rolePolicy = new RolePolicyService()
const pinnedVersion = {
  id: 'version-pinned',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  schema: {
    type: 'object',
    'x-om-roles': ['patient', 'clinician'],
    properties: {
      public_scan: {
        type: 'array',
        'x-om-type': 'file',
        'x-om-editable-by': ['patient', 'clinician'],
      },
      private_scan: {
        type: 'array',
        'x-om-type': 'file',
        'x-om-editable-by': ['clinician'],
        'x-om-visible-to': ['clinician'],
      },
      shared_scan: {
        type: 'array',
        'x-om-type': 'file',
        'x-om-editable-by': ['clinician'],
        'x-om-visible-to': ['patient', 'clinician'],
      },
    },
  },
  uiSchema: {},
}

function uploadRequest(): Request {
  return new Request('http://test/api/forms/public/submissions/sub-1/attachments', { method: 'POST' })
}

function downloadRequest(): Request {
  return new Request('http://test/api/forms/public/submissions/sub-1/attachments/attachment-1')
}

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
    resolveRuntimePrincipal.mockResolvedValue(principal)
    parseUploadBody.mockResolvedValue({
      fieldKey: 'public_scan',
      filename: 'scan.png',
      contentType: 'image/png',
      bytes: Buffer.from('scan'),
    })
    emFindOne.mockImplementation(async (entity: unknown) => {
      if (entity === FormSubmission) return { id: 'sub-1', formVersionId: pinnedVersion.id }
      if (entity === FormVersion) return pinnedVersion
      if (entity === FormAttachment) return { fieldKey: 'public_scan' }
      return null
    })
    storeUpload.mockResolvedValue({ id: 'attachment-1', filename: 'scan.png', contentType: 'image/png', sizeBytes: 4 })
    readUpload.mockResolvedValue({
      id: 'attachment-1', filename: 'scan.png', contentType: 'image/png', sizeBytes: 4, bytes: Buffer.from('scan'),
    })
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return { findOne: emFindOne }
        if (name === 'formVersionCompiler') return compiler
        if (name === 'formsRolePolicyService') return rolePolicy
        if (name === 'formsAttachmentService') return { readUpload, storeUpload }
        if (name === 'formsPdfSnapshotService') return { ensureSnapshot, readSnapshotForViewer }
        throw new Error(`[internal] unexpected dependency ${name}`)
      },
    })
  })

  it.each(['token', 'customer'])('denies hidden-field uploads and downloads for %s participants before storage or decryption', async (source) => {
    resolveRuntimePrincipal.mockResolvedValue({ ...principal, source })
    parseUploadBody.mockResolvedValue({ fieldKey: 'private_scan', bytes: Buffer.from('secret') })
    emFindOne.mockImplementation(async (entity: unknown) => {
      if (entity === FormSubmission) return { id: 'sub-1', formVersionId: pinnedVersion.id }
      if (entity === FormVersion) return pinnedVersion
      if (entity === FormAttachment) return { fieldKey: 'private_scan' }
      return null
    })

    const upload = await uploadAttachment(uploadRequest() as never, { params: { id: 'sub-1' } })
    const download = await downloadAttachment(downloadRequest() as never, {
      params: { id: 'sub-1', attachmentId: 'attachment-1' },
    })

    expect(upload.status).toBe(404)
    expect(await upload.json()).toEqual({ error: 'NOT_FOUND' })
    expect(download.status).toBe(404)
    expect(await download.json()).toEqual({ error: 'NOT_FOUND' })
    expect(storeUpload).not.toHaveBeenCalled()
    expect(readUpload).not.toHaveBeenCalled()
  })

  it('allows read-only field access without permitting uploads', async () => {
    parseUploadBody.mockResolvedValue({ fieldKey: 'shared_scan', bytes: Buffer.from('scan') })
    emFindOne.mockImplementation(async (entity: unknown) => {
      if (entity === FormSubmission) return { id: 'sub-1', formVersionId: pinnedVersion.id }
      if (entity === FormVersion) return pinnedVersion
      if (entity === FormAttachment) return { fieldKey: 'shared_scan' }
      return null
    })

    const upload = await uploadAttachment(uploadRequest() as never, { params: { id: 'sub-1' } })
    const download = await downloadAttachment(downloadRequest() as never, {
      params: { id: 'sub-1', attachmentId: 'attachment-1' },
    })

    expect(upload.status).toBe(404)
    expect(storeUpload).not.toHaveBeenCalled()
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from('scan'))
  })

  it.each([null, 'unknown'])('fails closed for a %s role', async (role) => {
    resolveRuntimePrincipal.mockResolvedValue({ ...principal, role })

    const upload = await uploadAttachment(uploadRequest() as never, { params: { id: 'sub-1' } })
    const download = await downloadAttachment(downloadRequest() as never, {
      params: { id: 'sub-1', attachmentId: 'attachment-1' },
    })

    expect(upload.status).toBe(404)
    expect(download.status).toBe(404)
    expect(storeUpload).not.toHaveBeenCalled()
    expect(readUpload).not.toHaveBeenCalled()
  })

  it.each([FormSubmission, FormVersion])('fails closed when the scoped %p is missing', async (missingEntity) => {
    emFindOne.mockImplementation(async (entity: unknown) => {
      if (entity === missingEntity) return null
      if (entity === FormSubmission) return { id: 'sub-1', formVersionId: pinnedVersion.id }
      return pinnedVersion
    })

    const upload = await uploadAttachment(uploadRequest() as never, { params: { id: 'sub-1' } })
    const download = await downloadAttachment(downloadRequest() as never, {
      params: { id: 'sub-1', attachmentId: 'attachment-1' },
    })

    expect(upload.status).toBe(404)
    expect(download.status).toBe(404)
    expect(storeUpload).not.toHaveBeenCalled()
    expect(readUpload).not.toHaveBeenCalled()
  })

  it('uses the pinned version and server scope for authorized requests', async () => {
    const compile = jest.spyOn(compiler, 'compile')

    const upload = await uploadAttachment(uploadRequest() as never, { params: { id: 'sub-1' } })
    const download = await downloadAttachment(downloadRequest() as never, {
      params: { id: 'sub-1', attachmentId: 'attachment-1' },
    })

    expect(upload.status).toBe(201)
    expect(await upload.json()).toEqual({ id: 'attachment-1', filename: 'scan.png', contentType: 'image/png', sizeBytes: 4 })
    expect(download.status).toBe(200)
    expect(compile).toHaveBeenCalledWith(pinnedVersion)
    expect(emFindOne).toHaveBeenCalledWith(FormSubmission, {
      id: 'sub-1', organizationId: principal.organizationId, tenantId: principal.tenantId, deletedAt: null,
    }, undefined)
    expect(emFindOne).toHaveBeenCalledWith(FormVersion, {
      id: pinnedVersion.id, organizationId: principal.organizationId, tenantId: principal.tenantId,
    }, undefined)
    expect(emFindOne).toHaveBeenCalledWith(FormAttachment, {
      id: 'attachment-1', submissionId: 'sub-1', organizationId: principal.organizationId, kind: 'user_upload', removedAt: null,
    }, { fields: ['fieldKey'] })
    expect(readUpload).toHaveBeenCalledWith({
      organizationId: principal.organizationId, tenantId: principal.tenantId, submissionId: 'sub-1', attachmentId: 'attachment-1',
    })
    compile.mockRestore()
  })

  it('returns the same download denial for missing attachments and hidden fields', async () => {
    emFindOne.mockImplementation(async (entity: unknown) => {
      if (entity === FormSubmission) return { id: 'sub-1', formVersionId: pinnedVersion.id }
      if (entity === FormVersion) return pinnedVersion
      return null
    })

    const response = await downloadAttachment(downloadRequest() as never, {
      params: { id: 'sub-1', attachmentId: 'attachment-1' },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'NOT_FOUND' })
    expect(readUpload).not.toHaveBeenCalled()
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
    readSnapshotForViewer.mockResolvedValue({
      attachmentId: null,
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
