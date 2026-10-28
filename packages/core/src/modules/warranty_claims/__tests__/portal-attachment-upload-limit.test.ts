/** @jest-environment node */

const MAX_UPLOAD_MB = 1
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
const CLAIM_ID = '123e4567-e89b-42d3-a456-426614174001'
const ATTACHMENT_ID = '123e4567-e89b-42d3-a456-426614174002'

const mockLoadPortalOwnedClaim = jest.fn()
const mockUpload = jest.fn()
const mockRemoveAttachmentRecord = jest.fn()
const mockEm = {}

jest.mock('../lib/portalAuthGuard', () => ({
  resolveLinkedCustomerAuth: jest.fn(async () => ({
    sub: 'customer-user-1',
    email: 'customer@example.com',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    customerEntityId: 'customer-1',
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn((token: string) => (token === 'em' ? mockEm : undefined)),
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(async () => ({ ok: true, runAfterSuccess: async () => undefined })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({
    id: '123e4567-e89b-42d3-a456-426614174002',
    recordId: '123e4567-e89b-42d3-a456-426614174001',
    partitionCode: 'privateAttachments',
    storagePath: null,
    storageMetadata: { tags: ['customer-visible'] },
  })),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/thumbnailCache', () => ({
  clearAttachmentThumbnailCache: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/storageReferences', () => ({
  removeAttachmentRecord: (...args: unknown[]) => mockRemoveAttachmentRecord(...args),
}))

jest.mock('../lib/portalClaimAccess', () => ({
  loadPortalOwnedClaim: (...args: unknown[]) => mockLoadPortalOwnedClaim(...args),
}))

jest.mock('../lib/portalAttachmentUpload', () => ({
  resolvePortalAttachmentUploadService: jest.fn(() => ({ upload: mockUpload })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    t: (_key: string, fallback?: string) => fallback ?? _key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

type RouteModule = typeof import('../api/portal/attachments/route')
let POST: RouteModule['POST']
let PUT: RouteModule['PUT']

const BOUNDARY = '----om-warranty-upload-limit'
const encoder = new TextEncoder()

function multipartHead(replacement: boolean, fileName: string): Uint8Array {
  const fields = [`--${BOUNDARY}\r\nContent-Disposition: form-data; name="claimId"\r\n\r\n${CLAIM_ID}\r\n`]
  if (replacement) {
    fields.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="attachmentId"\r\n\r\n${ATTACHMENT_ID}\r\n`)
  }
  fields.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`)
  return encoder.encode(fields.join(''))
}

function multipartBody(replacement: boolean, fileBytes: number): ReadableStream<Uint8Array> {
  const parts: Uint8Array[] = [multipartHead(replacement, 'evidence.bin')]
  const chunkBytes = 64 * 1024
  for (let sent = 0; sent < fileBytes; sent += chunkBytes) {
    parts.push(new Uint8Array(Math.min(chunkBytes, fileBytes - sent)).fill(0x41))
  }
  parts.push(encoder.encode(`\r\n--${BOUNDARY}--\r\n`))
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= parts.length) {
        controller.close()
        return
      }
      controller.enqueue(parts[index])
      index += 1
    },
  })
}

function uploadRequest(method: 'POST' | 'PUT', fileBytes: number): Request {
  return new Request('http://localhost/api/warranty_claims/portal/attachments', {
    method,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: multipartBody(method === 'PUT', fileBytes),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

describe('warranty portal attachment upload size limit', () => {
  const originalMaxUpload = process.env.OM_ATTACHMENT_MAX_UPLOAD_MB

  beforeAll(async () => {
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = String(MAX_UPLOAD_MB)
    const routeModule = await import('../api/portal/attachments/route')
    POST = routeModule.POST
    PUT = routeModule.PUT
  })

  afterAll(() => {
    if (originalMaxUpload === undefined) delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    else process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = originalMaxUpload
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadPortalOwnedClaim.mockResolvedValue({ id: CLAIM_ID })
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: true, releaseStorage: false })
    mockUpload.mockResolvedValue({
      id: 'attachment-1',
      url: '/api/attachments/file/attachment-1',
      fileName: 'evidence.bin',
      fileSize: 1024,
      mimeType: 'application/octet-stream',
      storageMetadata: { tags: ['customer-visible'] },
      createdAt: new Date('2026-10-13T00:00:00.000Z'),
    })
  })

  it.each(['POST', 'PUT'] as const)('%s answers 413 for a chunked multipart body over the limit before reading the claim', async (method) => {
    const handler = method === 'POST' ? POST : PUT
    const arrayBufferSpy = jest.spyOn(File.prototype, 'arrayBuffer')

    const response = await handler(uploadRequest(method, MAX_UPLOAD_BYTES * 3))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Attachment exceeds the maximum upload size.',
      code: 'max_upload_size',
    })
    expect(mockLoadPortalOwnedClaim).not.toHaveBeenCalled()
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT'] as const)('%s answers 413 for a file over the limit before copying it into memory', async (method) => {
    const handler = method === 'POST' ? POST : PUT
    const arrayBufferSpy = jest.spyOn(File.prototype, 'arrayBuffer')

    const response = await handler(uploadRequest(method, MAX_UPLOAD_BYTES + 1))

    expect(response.status).toBe(413)
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT'] as const)('%s still uploads a file within the limit with its exact bytes', async (method) => {
    const handler = method === 'POST' ? POST : PUT
    const fileBytes = MAX_UPLOAD_BYTES - 1024

    const response = await handler(uploadRequest(method, fileBytes))

    expect(response.status).toBe(200)
    expect(mockLoadPortalOwnedClaim).toHaveBeenCalled()
    expect(mockUpload).toHaveBeenCalledTimes(1)
    const uploaded = mockUpload.mock.calls[0][0] as { buffer: Buffer; recordId: string; fileName: string }
    expect(uploaded.recordId).toBe(CLAIM_ID)
    expect(uploaded.fileName).toBe('evidence.bin')
    expect(uploaded.buffer.length).toBe(fileBytes)
    expect(uploaded.buffer.every((byte) => byte === 0x41)).toBe(true)
  })
})
