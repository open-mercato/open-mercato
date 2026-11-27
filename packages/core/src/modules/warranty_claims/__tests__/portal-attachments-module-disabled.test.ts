/** @jest-environment node */

import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const CLAIM_ID = '123e4567-e89b-42d3-a456-426614174001'
const ATTACHMENT_ID = '123e4567-e89b-42d3-a456-426614174002'
const MISSING_METADATA = '[internal] Metadata for entity Attachment not found'

const mockLoadPortalOwnedClaim = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockUpload = jest.fn()
const mockEmFind = jest.fn()
let mockUploadService: { upload: jest.Mock } | null = null

jest.mock('#generated/entities.ids.generated', () => ({
  E: { warranty_claims: { warranty_claim: 'warranty_claims:warranty_claim' } },
}))

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
    resolve: jest.fn((token: string) => (token === 'em' ? { find: mockEmFind } : undefined)),
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(async () => ({ ok: true, runAfterSuccess: async () => undefined })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../lib/portalClaimAccess', () => ({
  loadPortalOwnedClaim: (...args: unknown[]) => mockLoadPortalOwnedClaim(...args),
}))

jest.mock('../lib/portalAttachmentUpload', () => ({
  resolvePortalAttachmentUploadService: jest.fn(() => mockUploadService),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

type RouteModule = typeof import('../api/portal/attachments/route')
let route: RouteModule

function uploadRequest(method: 'POST' | 'PUT'): Request {
  const form = new FormData()
  form.set('claimId', CLAIM_ID)
  if (method === 'PUT') form.set('attachmentId', ATTACHMENT_ID)
  form.set('file', new File([new Uint8Array([0x41, 0x42])], 'evidence.bin', { type: 'application/octet-stream' }))
  return new Request('http://localhost/api/warranty_claims/portal/attachments', { method, body: form })
}

describe('warranty portal attachments when the attachments module is disabled', () => {
  let previousEntityIds: EntityIds

  beforeAll(async () => {
    route = await import('../api/portal/attachments/route')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    previousEntityIds = getEntityIds(false)
    registerEntityIds({ warranty_claims: { warranty_claim: 'warranty_claims:warranty_claim' } })
    mockLoadPortalOwnedClaim.mockResolvedValue({ id: CLAIM_ID })
    mockFindWithDecryption.mockRejectedValue(new Error(MISSING_METADATA))
    mockFindOneWithDecryption.mockRejectedValue(new Error(MISSING_METADATA))
    mockEmFind.mockRejectedValue(new Error(MISSING_METADATA))
    mockUploadService = null
  })

  afterEach(() => {
    registerEntityIds(previousEntityIds)
  })

  it('lists no attachments for an owned claim instead of failing', async () => {
    const response = await route.GET(new Request(`http://localhost/api/warranty_claims/portal/attachments?claimId=${CLAIM_ID}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 1 })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('still answers 404 for a claim the customer does not own', async () => {
    mockLoadPortalOwnedClaim.mockResolvedValue(null)

    const response = await route.GET(new Request(`http://localhost/api/warranty_claims/portal/attachments?claimId=${CLAIM_ID}`))

    expect(response.status).toBe(404)
  })

  it('answers 404 when streaming an attachment', async () => {
    const response = await route.GET(new Request(`http://localhost/api/warranty_claims/portal/attachments?attachmentId=${ATTACHMENT_ID}`))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Claim not found.' })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 404 when deleting an attachment', async () => {
    const response = await route.DELETE(new Request(
      `http://localhost/api/warranty_claims/portal/attachments?attachmentId=${ATTACHMENT_ID}`,
      { method: 'DELETE' },
    ))

    expect(response.status).toBe(404)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 503 when uploading an attachment', async () => {
    const response = await route.POST(uploadRequest('POST'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Attachment upload failed.' })
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('answers 503 when replacing an attachment', async () => {
    mockUploadService = { upload: mockUpload }

    const response = await route.PUT(uploadRequest('PUT'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Attachment upload failed.' })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('still queries attachments when the module is enabled', async () => {
    registerEntityIds({ attachments: { attachment: 'attachments:attachment' } })
    mockFindWithDecryption.mockResolvedValue([])

    const response = await route.GET(new Request(`http://localhost/api/warranty_claims/portal/attachments?claimId=${CLAIM_ID}`))

    expect(response.status).toBe(200)
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })
})
