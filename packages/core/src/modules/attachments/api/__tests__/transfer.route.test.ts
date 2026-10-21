/** @jest-environment node */
// Regression coverage for #7672: POST /api/attachments/transfer caps attachmentIds at 100.

import { randomUUID } from 'crypto'

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'u1', tenantId: 'tenantA', orgId: 'orgA' })),
}))

type AttachmentRow = {
  id: string
  recordId: string
  storageMetadata: Record<string, unknown> | null
}

const mockEm = {
  find: jest.fn(async (_entity: unknown, filter: { id: { $in: string[] } }): Promise<AttachmentRow[]> =>
    filter.id.$in.map((id) => ({ id, recordId: 'draft-1', storageMetadata: null })),
  ),
  persist: jest.fn(function persist(this: unknown) {
    return this
  }),
  flush: jest.fn(async () => {}),
}

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

  it('rejects more than 100 attachmentIds without loading any attachment', async () => {
    const { POST } = await import('@open-mercato/core/modules/attachments/api/transfer/route')
    const response = await POST(buildRequest(buildIds(101)))
    expect(response.status).toBe(400)
    expect(mockEm.find).not.toHaveBeenCalled()
  })

  it('transfers exactly 100 attachmentIds', async () => {
    const { POST } = await import('@open-mercato/core/modules/attachments/api/transfer/route')
    const response = await POST(buildRequest(buildIds(100)))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, updated: 100 })
  })
})
