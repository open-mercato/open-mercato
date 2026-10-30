/** @jest-environment node */

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444'

type AttachmentRow = {
  id: string
  tenantId: string
  organizationId: string
  partitionCode: string
  storagePath: string
  fileName: string
  entityId: string
  recordId: string
  storageMetadata: Record<string, unknown>
}

let mockIndexedSectionIds: string[] = []
const mockPurgeDocumentStructure = jest.fn(async () => ({
  extractionCount: 1,
  sectionCount: 2,
  indexedSectionIds: mockIndexedSectionIds,
}))
const mockEnqueueDocumentSectionSearch = jest.fn(async () => 'job-1')
const mockReportError = jest.fn()
const mockStorageDelete = jest.fn(async () => undefined)
let mockLockedReferenceIds: string[] = []
let mockAttachment: AttachmentRow

function buildAttachment(): AttachmentRow {
  return {
    id: ATTACHMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    partitionCode: 'privateAttachments',
    storagePath: 'tenant/org/rules.pdf',
    fileName: 'rules.pdf',
    entityId: 'warranty_claims:warranty_claim',
    recordId: CLAIM_ID,
    storageMetadata: { tags: ['customer-visible'] },
  }
}

type LockQuery = {
  select: jest.Mock
  where: jest.Mock
  orderBy: jest.Mock
  forUpdate: jest.Mock
  execute: jest.Mock
}

function createFakeEm() {
  let inTransaction = false
  const query: LockQuery = {
    select: jest.fn(() => query),
    where: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    forUpdate: jest.fn(() => query),
    execute: jest.fn(async () => mockLockedReferenceIds.map((id) => ({ id }))),
  }
  const em = {
    getKysely: jest.fn(() => ({ selectFrom: jest.fn(() => query) })),
    findOne: jest.fn(async () => mockAttachment),
    find: jest.fn(async () => [mockAttachment]),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => {
      inTransaction = true
    }),
    commit: jest.fn(async () => {
      inTransaction = false
    }),
    rollback: jest.fn(async () => {
      inTransaction = false
    }),
    isInTransaction: jest.fn(() => inTransaction),
  }
  return em
}

let mockEm = createFakeEm()

jest.mock('#generated/entities.ids.generated', () => ({
  E: { attachments: { attachment: 'attachments:attachment' } },
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('@open-mercato/core/modules/attachments/lib/documentStructure/purge', () => ({
  ...jest.requireActual('@open-mercato/core/modules/attachments/lib/documentStructure/purge'),
  purgeDocumentStructure: (...args: unknown[]) => mockPurgeDocumentStructure(...(args as [])),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/documentStructure/queue', () => ({
  ...jest.requireActual('@open-mercato/core/modules/attachments/lib/documentStructure/queue'),
  enqueueDocumentSectionSearch: (...args: unknown[]) => mockEnqueueDocumentSectionSearch(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/telemetry/runtime'),
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/thumbnailCache', () => ({
  clearAttachmentThumbnailCache: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'storageDriverFactory') {
        return { resolveForPartition: jest.fn(async () => ({ delete: mockStorageDelete })) }
      }
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => mockAttachment),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: jest.fn(async () => ({ ok: true, runAfterSuccess: async () => undefined })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    t: (_key: string, fallback?: string) => fallback ?? _key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('../../warranty_claims/lib/portalAuthGuard', () => ({
  resolveLinkedCustomerAuth: jest.fn(async () => ({
    sub: 'customer-user-1',
    email: 'customer@example.com',
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    customerEntityId: 'customer-1',
  })),
}))

jest.mock('../../warranty_claims/lib/portalClaimAccess', () => ({
  loadPortalOwnedClaim: jest.fn(async () => ({ id: CLAIM_ID })),
}))

const expectedPurgeInput = { attachmentId: ATTACHMENT_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

function expectStructurePurgedInsideDeleteTransaction() {
  expect(mockPurgeDocumentStructure).toHaveBeenCalledTimes(1)
  expect(mockPurgeDocumentStructure).toHaveBeenCalledWith(mockEm, expectedPurgeInput, { flush: false })
  const purgeOrder = mockPurgeDocumentStructure.mock.invocationCallOrder[0]
  expect(purgeOrder).toBeGreaterThan(mockEm.begin.mock.invocationCallOrder[0])
  expect(purgeOrder).toBeLessThan(mockEm.commit.mock.invocationCallOrder[0])
  expect(mockEm.remove).toHaveBeenCalledWith(mockAttachment)
}

describe('attachment delete paths purge document structure', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = createFakeEm()
    mockAttachment = buildAttachment()
    mockLockedReferenceIds = [ATTACHMENT_ID]
    mockIndexedSectionIds = []
  })

  it('purges through DELETE /api/attachments/library/:id', async () => {
    const { DELETE } = await import('../api/library/[id]/route')
    const request = new Request(`http://localhost/api/attachments/library/${ATTACHMENT_ID}`, { method: 'DELETE' })

    const response = await DELETE(request as Parameters<typeof DELETE>[0], { params: Promise.resolve({ id: ATTACHMENT_ID }) } as Parameters<typeof DELETE>[1])

    expect(response.status).toBe(200)
    expectStructurePurgedInsideDeleteTransaction()
    expect(mockStorageDelete).toHaveBeenCalledWith('privateAttachments', 'tenant/org/rules.pdf')
  })

  it('purges through the attachments delete CLI command', async () => {
    const { default: attachmentsCli } = await import('../cli')
    const deleteCli = attachmentsCli.find((entry) => entry.command === 'delete')
    jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await deleteCli?.run(['--id', ATTACHMENT_ID, '--tenant', TENANT_ID, '--org', ORG_ID])

    expectStructurePurgedInsideDeleteTransaction()
  })

  it('purges through the warranty claims portal DELETE', async () => {
    const { DELETE } = await import('../../warranty_claims/api/portal/attachments/route')
    const request = new Request(
      `http://localhost/api/warranty_claims/portal/attachments?attachmentId=${ATTACHMENT_ID}`,
      { method: 'DELETE' },
    )

    const response = await DELETE(request)

    expect(response.status).toBe(200)
    expectStructurePurgedInsideDeleteTransaction()
  })

  it('skips the purge when a concurrent delete already removed the row', async () => {
    mockLockedReferenceIds = []
    const { DELETE } = await import('../api/library/[id]/route')
    const request = new Request(`http://localhost/api/attachments/library/${ATTACHMENT_ID}`, { method: 'DELETE' })

    const response = await DELETE(request as Parameters<typeof DELETE>[0], { params: Promise.resolve({ id: ATTACHMENT_ID }) } as Parameters<typeof DELETE>[1])

    expect(response.status).toBe(404)
    expect(mockPurgeDocumentStructure).not.toHaveBeenCalled()
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(mockEnqueueDocumentSectionSearch).not.toHaveBeenCalled()
  })

  describe('section search cleanup', () => {
    async function deleteThroughLibrary() {
      const { DELETE } = await import('../api/library/[id]/route')
      const request = new Request(`http://localhost/api/attachments/library/${ATTACHMENT_ID}`, { method: 'DELETE' })
      return DELETE(request as Parameters<typeof DELETE>[0], { params: Promise.resolve({ id: ATTACHMENT_ID }) } as Parameters<typeof DELETE>[1])
    }

    function sectionIds(count: number): string[] {
      return Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    }

    it('enqueues the delete of indexed section records only after the delete commits', async () => {
      mockIndexedSectionIds = sectionIds(2)

      const response = await deleteThroughLibrary()

      expect(response.status).toBe(200)
      expect(mockEnqueueDocumentSectionSearch).toHaveBeenCalledTimes(1)
      expect(mockEnqueueDocumentSectionSearch).toHaveBeenCalledWith(null, {
        mode: 'delete',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        sectionIds: mockIndexedSectionIds,
      })
      expect(mockEm.commit.mock.invocationCallOrder[0]).toBeLessThan(
        mockEnqueueDocumentSectionSearch.mock.invocationCallOrder[0],
      )
    })

    it('splits large section sets into chunks of at most 500 ids', async () => {
      mockIndexedSectionIds = sectionIds(1201)

      await deleteThroughLibrary()

      const chunks = mockEnqueueDocumentSectionSearch.mock.calls.map(
        (call) => (call as unknown as [unknown, { sectionIds: string[] }])[1].sectionIds,
      )
      expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 201])
      expect(chunks.flat()).toEqual(mockIndexedSectionIds)
    })

    it('enqueues nothing when no section was search-indexed', async () => {
      await deleteThroughLibrary()

      expect(mockPurgeDocumentStructure).toHaveBeenCalledTimes(1)
      expect(mockEnqueueDocumentSectionSearch).not.toHaveBeenCalled()
    })

    it('enqueues nothing when the delete transaction rolls back', async () => {
      mockIndexedSectionIds = sectionIds(2)
      mockEm.flush.mockRejectedValueOnce(new Error('flush failed'))

      const response = await deleteThroughLibrary().catch(() => null)

      expect(response?.status ?? 500).toBeGreaterThanOrEqual(500)
      expect(mockEm.rollback).toHaveBeenCalled()
      expect(mockEm.commit).not.toHaveBeenCalled()
      expect(mockEnqueueDocumentSectionSearch).not.toHaveBeenCalled()
      expect(mockStorageDelete).not.toHaveBeenCalled()
    })

    it('keeps the delete successful when enqueueing the cleanup fails', async () => {
      mockIndexedSectionIds = sectionIds(2)
      mockEnqueueDocumentSectionSearch.mockRejectedValueOnce(new Error('queue down'))

      const response = await deleteThroughLibrary()

      expect(response.status).toBe(200)
      expect(mockStorageDelete).toHaveBeenCalledWith('privateAttachments', 'tenant/org/rules.pdf')
      expect(mockReportError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ code: 'attachments.section_search_delete_enqueue_failed' }),
      )
    })
  })
})
