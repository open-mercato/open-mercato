/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveSyncExcelConcreteScope = jest.fn()
const mockCreateSyncExcelUploadAttachment = jest.fn()
const mockEntityManager = {
  create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => payload),
  persist: jest.fn(),
  flush: jest.fn(),
}
const mockContainer = {
  resolve: jest.fn(() => mockEntityManager),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('../../../lib/scope', () => ({
  resolveSyncExcelConcreteScope: jest.fn((params: unknown) => mockResolveSyncExcelConcreteScope(params)),
}))

jest.mock('../../../lib/upload-storage', () => ({
  createSyncExcelUploadAttachment: jest.fn((params: unknown) => mockCreateSyncExcelUploadAttachment(params)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  const routeModule = await import('../route')
  postHandler = routeModule.POST
})

describe('sync_excel upload route limits', () => {
  const maxUploadEnv = 'OM_ATTACHMENT_MAX_UPLOAD_MB'
  const originalMaxUploadMb = process.env[maxUploadEnv]

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env[maxUploadEnv]
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockResolveSyncExcelConcreteScope.mockResolvedValue({
      ok: true,
      scope: {
        organizationId: '33333333-3333-4333-8333-333333333333',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    })
    mockCreateSyncExcelUploadAttachment.mockResolvedValue({ id: 'attachment-1' })
    mockEntityManager.flush.mockResolvedValue(undefined)
  })

  afterAll(() => {
    if (originalMaxUploadMb === undefined) delete process.env[maxUploadEnv]
    else process.env[maxUploadEnv] = originalMaxUploadMb
  })

  it('rejects All organizations scope before parsing form data', async () => {
    mockResolveSyncExcelConcreteScope.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: 'Select a concrete organization before importing CSV.',
    })

    const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
      method: 'POST',
      headers: {
        cookie: 'om_selected_org=__all__',
      },
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Select a concrete organization before importing CSV.' })
  })

  it('rejects multipart payloads over the content-length guard before parsing form data', async () => {
    process.env[maxUploadEnv] = '0.000001'

    const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=too-large',
        'content-length': String(2 * 1024 * 1024),
      },
      body: '--too-large--',
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'CSV upload exceeds the maximum upload size.' })
  })

  it.each([null, 'invalid', '1'])(
    'rejects an oversized streamed multipart body when content-length is %p',
    async (contentLength) => {
      process.env[maxUploadEnv] = '0.000001'
      const boundary = 'sync-excel-upload-limit'
      const body = new TextEncoder().encode([
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="metadata"\r\n\r\n',
        'x'.repeat(1024 * 1024),
        `\r\n--${boundary}--\r\n`,
      ].join(''))
      const headers = new Headers({ 'content-type': `multipart/form-data; boundary=${boundary}` })
      if (contentLength !== null) headers.set('content-length', contentLength)

      const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
        method: 'POST',
        headers,
        body,
      }))

      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toEqual({ error: 'CSV upload exceeds the maximum upload size.' })
      expect(mockCreateSyncExcelUploadAttachment).not.toHaveBeenCalled()
    },
  )

  it('rejects CSV files larger than the attachment upload limit before reading the buffer', async () => {
    process.env[maxUploadEnv] = String(5 / (1024 * 1024))
    const formData = new FormData()
    formData.set('entityType', 'customers.person')
    formData.set('file', new File([Buffer.from('123456')], 'leads.csv', { type: 'text/csv' }))

    const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'CSV upload exceeds the maximum upload size.' })
  })

  it('accepts a valid CSV exactly at the configured file-size limit', async () => {
    const maxUploadBytes = 128
    process.env[maxUploadEnv] = String(maxUploadBytes / (1024 * 1024))
    const header = 'firstName\n'
    const csv = Buffer.from(`${header}${'x'.repeat(maxUploadBytes - Buffer.byteLength(header))}`)
    const formData = new FormData()
    formData.set('entityType', 'customers.person')
    formData.set('file', new File([csv], 'leads.csv', { type: 'text/csv' }))

    const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      filename: 'leads.csv',
      fileSize: maxUploadBytes,
      entityType: 'customers.person',
    })
    expect(mockCreateSyncExcelUploadAttachment).toHaveBeenCalled()
  })
})
