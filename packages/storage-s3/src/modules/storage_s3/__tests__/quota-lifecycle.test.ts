/** @jest-environment node */

const mockPutObject = jest.fn(async () => {})
const mockDelete = jest.fn(async () => {})
const mockGetSignedUrl = jest.fn(async () => 'https://s3.test/signed')
const mockListObjects = jest.fn(async () => ({ files: [], truncated: false }))

jest.mock('../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    delete: mockDelete,
    deleteStrict: mockDelete,
    getSignedUrl: mockGetSignedUrl,
    listObjects: mockListObjects,
    getBucket: () => 'bucket',
  })),
}))

const mockQuotaService = {
  reconcileStandaloneObjects: jest.fn(async () => {}),
  reserve: jest.fn(async () => ({ id: 'reservation-1', leaseToken: 'lease-1', expiresAt: new Date(Date.now() + 60_000) })),
  claimPendingByUploadTokenHash: jest.fn(async () => null as Record<string, unknown> | null),
  beginStorage: jest.fn(async () => {}),
  markStored: jest.fn(async () => {}),
  completeStandalone: jest.fn(async () => {}),
  release: jest.fn(async () => {}),
  releaseCommittedByPath: jest.fn(async () => {}),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'integrationCredentialsService') {
        return { resolve: jest.fn(async () => ({ bucket: 'bucket', region: 'us-east-1' })) }
      }
      if (key === 'attachmentQuotaService') return mockQuotaService
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId: 'tenant-1', orgId: 'org-1' })),
}))

function multipartRequest() {
  const form = new FormData()
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'safe.pdf', { type: 'application/pdf' }))
  return new Request('http://localhost/api/storage-providers/s3/upload', { method: 'POST', body: form })
}

describe('storage_s3 quota lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '5'
    process.env.OM_ATTACHMENT_TENANT_QUOTA_MB = '10'
  })

  afterEach(() => {
    delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    delete process.env.OM_ATTACHMENT_TENANT_QUOTA_MB
  })

  it('routes multipart uploads through the shared reservation service', async () => {
    const { POST } = await import('../api/post/storage-providers/s3/upload')
    const response = await POST(multipartRequest())

    expect(response.status).toBe(200)
    expect(mockQuotaService.reserve).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      bytes: 3,
      source: 'storage_s3_upload',
    }))
    expect(mockQuotaService.completeStandalone).toHaveBeenCalledWith(
      'reservation-1',
      'lease-1',
      3,
    )
  })

  it('reserves exact bytes before generating a signed upload URL', async () => {
    const { POST } = await import('../api/post/storage-providers/s3/signed-url')
    const key = 'uploads/org_org-1/tenant_tenant-1/safe.pdf'
    const response = await POST(new Request('http://localhost/api/storage-providers/s3/signed-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, operation: 'upload', contentType: 'application/pdf', size: 3 }),
    }))

    expect(response.status).toBe(200)
    expect(mockQuotaService.reserve).toHaveBeenCalledWith(expect.objectContaining({
      storagePath: key,
      bytes: 3,
      source: 'storage_s3_signed',
    }))
    expect(mockQuotaService.reconcileStandaloneObjects).toHaveBeenCalled()
    expect(await response.json()).toEqual(expect.objectContaining({
      reservationId: 'reservation-1',
      url: expect.stringContaining('/api/storage-providers/s3/signed-upload/'),
    }))
  })

  it('atomically consumes a compatibility token so replay cannot delete the winning object', async () => {
    mockQuotaService.claimPendingByUploadTokenHash
      .mockResolvedValueOnce({
        id: 'reservation-1',
        leaseToken: 'lease-claimed',
        source: 'storage_s3_signed',
        reservedBytes: 3,
        storagePath: 'uploads/org_org-1/tenant_tenant-1/safe.pdf',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
      .mockResolvedValueOnce(null)
    const { PUT } = await import('../api/put/storage-providers/s3/signed-upload/[token]')
    const request = () => new Request('http://localhost/api/storage-providers/s3/signed-upload/token', {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array([1, 2, 3]),
    })

    const first = await PUT(request(), { params: { token: 'token' } })
    const replay = await PUT(request(), { params: { token: 'token' } })

    expect(first.status).toBe(200)
    expect(replay.status).toBe(410)
    expect(mockPutObject).toHaveBeenCalledTimes(1)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('stops a chunked compatibility upload as soon as it crosses the reserved bound', async () => {
    mockQuotaService.claimPendingByUploadTokenHash.mockResolvedValueOnce({
      id: 'reservation-1',
      leaseToken: 'lease-claimed',
      source: 'storage_s3_signed',
      reservedBytes: 3,
      storagePath: 'uploads/org_org-1/tenant_tenant-1/safe.pdf',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    })
    const { PUT } = await import('../api/put/storage-providers/s3/signed-upload/[token]')
    const response = await PUT(new Request('http://localhost/api/storage-providers/s3/signed-upload/token', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }), { params: { token: 'token' } })

    expect(response.status).toBe(413)
    expect(mockPutObject).not.toHaveBeenCalled()
    expect(mockQuotaService.release).toHaveBeenCalledWith('reservation-1', 'lease-claimed')
  })

  it('removes committed quota only after standalone object deletion succeeds', async () => {
    const { DELETE } = await import('../api/delete/storage-providers/s3/delete')
    const key = 'uploads/org_org-1/tenant_tenant-1/safe.pdf'
    const response = await DELETE(new Request('http://localhost/api/storage-providers/s3/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    }))

    expect(response.status).toBe(204)
    expect(mockDelete).toHaveBeenCalled()
    expect(mockQuotaService.releaseCommittedByPath).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      storageDriver: 's3',
      storagePath: key,
    }))
  })

  it('releases a programmatic signed-url reservation when recovery scheduling fails', async () => {
    const { createStorageService } = await import('../lib/storage-service')
    const service = createStorageService({
      bucket: 'bucket',
      region: 'us-east-1',
      quotaService: mockQuotaService as never,
      quotaRecoveryScheduler: jest.fn(async () => {
        throw new Error('queue unavailable')
      }),
    })

    await expect(service.getSignedUrl({
      key: 'uploads/org_org-1/tenant_tenant-1/safe.pdf',
      operation: 'upload',
      size: 3,
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
    })).rejects.toThrow('queue unavailable')
    expect(mockQuotaService.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
  })
})
