/** @jest-environment node */
// Regression coverage for #7672: POST /api/attachments/transfer caps attachmentIds at ATTACHMENT_TRANSFER_MAX_IDS.

import { randomUUID } from 'crypto'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ATTACHMENT_TRANSFER_MAX_IDS } from '@open-mercato/core/modules/attachments/lib/transferLimits'
import { transferAttachmentsRequestSchema } from '@open-mercato/core/modules/attachments/api/openapi'

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'u1', tenantId: 'tenantA', orgId: 'orgA' })),
}))

type AttachmentRow = {
  id: string
  entityId: string
  recordId: string
  storageMetadata: Record<string, unknown> | null
}

const mockTx = {
  flush: jest.fn(async () => {}),
}

const mockEm = {
  transactional: jest.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx)),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(
    async (_em: unknown, _entity: unknown, filter: { id: { $in: string[] } }): Promise<AttachmentRow[]> =>
      filter.id.$in.map((id) => ({ id, entityId: 'catalog:catalog_product', recordId: 'draft-1', storageMetadata: null })),
  ),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/access-mutation', () => ({
  prepareAttachmentMutation: jest.fn(async () => ({ modifiedPayload: undefined, runAfterSuccess: async () => {} })),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/access-runner', () => ({
  createAttachmentAccessContext: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/access-query', () => ({
  assertAttachmentOwnerAccess: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => (key === 'em' ? mockEm : null),
  }),
}))

function buildRequest(attachmentIds: string[]): Request {
  return new Request('http://test.local/api/attachments/transfer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entityId: 'catalog:catalog_product',
      attachmentIds,
      fromRecordId: 'draft-1',
      toRecordId: 'product-1',
    }),
  })
}

function buildIds(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID())
}

describe('POST /api/attachments/transfer attachmentIds limit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps the shared limit at 100, the attachment list pageSize ceiling', () => {
    expect(ATTACHMENT_TRANSFER_MAX_IDS).toBe(100)
  })

  it('rejects more than ATTACHMENT_TRANSFER_MAX_IDS attachmentIds without loading any attachment', async () => {
    const { POST } = await import('@open-mercato/core/modules/attachments/api/transfer/route')
    const response = await POST(buildRequest(buildIds(ATTACHMENT_TRANSFER_MAX_IDS + 1)))
    expect(response.status).toBe(400)
    expect(mockEm.transactional).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('transfers exactly ATTACHMENT_TRANSFER_MAX_IDS attachmentIds', async () => {
    const { POST } = await import('@open-mercato/core/modules/attachments/api/transfer/route')
    const response = await POST(buildRequest(buildIds(ATTACHMENT_TRANSFER_MAX_IDS)))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, updated: ATTACHMENT_TRANSFER_MAX_IDS })
  })

  it('documents the same limit in the OpenAPI request schema', () => {
    const payload = (count: number) => ({ entityId: 'catalog:catalog_product', attachmentIds: buildIds(count), toRecordId: 'product-1' })
    expect(transferAttachmentsRequestSchema.safeParse(payload(ATTACHMENT_TRANSFER_MAX_IDS)).success).toBe(true)
    expect(transferAttachmentsRequestSchema.safeParse(payload(ATTACHMENT_TRANSFER_MAX_IDS + 1)).success).toBe(false)
  })
})
