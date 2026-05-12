/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockIsMultipartRequestWithinUploadLimit = jest.fn()
const mockResolveDefaultAttachmentMaxUploadBytes = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('../../../../attachments/lib/upload-limits', () => ({
  isMultipartRequestWithinUploadLimit: jest.fn((contentLength: string | null) => mockIsMultipartRequestWithinUploadLimit(contentLength)),
  resolveDefaultAttachmentMaxUploadBytes: jest.fn(() => mockResolveDefaultAttachmentMaxUploadBytes()),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => {
    throw new Error('createRequestContainer should not be called for rejected uploads')
  }),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  const routeModule = await import('../route')
  postHandler = routeModule.POST
})

describe('sync_excel upload route limits', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: '22222222-2222-4222-8222-222222222222',
      orgId: '33333333-3333-4333-8333-333333333333',
    })
    mockIsMultipartRequestWithinUploadLimit.mockReturnValue(true)
    mockResolveDefaultAttachmentMaxUploadBytes.mockReturnValue(5)
  })

  it('rejects multipart payloads over the content-length guard before parsing form data', async () => {
    mockIsMultipartRequestWithinUploadLimit.mockReturnValueOnce(false)

    const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=too-large',
        'content-length': '100000',
      },
      body: '--too-large--',
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'CSV upload exceeds the maximum upload size.' })
  })

  it('rejects CSV files larger than the attachment upload limit before reading the buffer', async () => {
    const formData = new FormData()
    formData.set('entityType', 'customers.person')
    formData.set('file', new File([Buffer.from('123456')], 'leads.csv', { type: 'text/csv' }))

    const response = await postHandler(new Request('http://localhost/api/sync_excel/upload', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'CSV upload exceeds the maximum upload size.' })
    expect(mockResolveDefaultAttachmentMaxUploadBytes).toHaveBeenCalled()
  })
})
