/** @jest-environment node */

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { transferDraftMedia } from '../mediaTransfer'
import type { ProductMediaItem } from '../ProductMediaManager'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

function buildMediaItems(count: number): ProductMediaItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    url: `/api/attachments/file/${index}`,
    fileName: `image-${index}.png`,
    fileSize: 1024,
  }))
}

function response(ok: boolean, body: Record<string, unknown>) {
  return { ok, status: ok ? 200 : 500, result: body, response: {} as Response, cacheStatus: null } as never
}

describe('transferDraftMedia', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('moves 101 uploaded media items to the new record in batches of at most 100', async () => {
    apiCallMock
      .mockResolvedValueOnce(response(true, { ok: true, updated: 100 }))
      .mockResolvedValueOnce(response(true, { ok: true, updated: 1 }))

    const result = await transferDraftMedia({
      entityId: 'catalog:catalog_product',
      draftId: 'draft-1',
      recordId: 'product-1',
      mediaItems: buildMediaItems(101),
    })

    const batchSizes = apiCallMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { attachmentIds: string[]; toRecordId: string }
      expect(body.toRecordId).toBe('product-1')
      return body.attachmentIds.length
    })
    expect(batchSizes).toEqual([100, 1])
    expect(result).toEqual({ requestedCount: 101, failedCount: 0, errors: [] })
  })

  it('reports how many media items were left on the draft when a batch fails', async () => {
    apiCallMock
      .mockResolvedValueOnce(response(true, { ok: true, updated: 100 }))
      .mockResolvedValueOnce(response(false, { error: 'Failed to transfer attachments' }))

    const result = await transferDraftMedia({
      entityId: 'catalog:catalog_product_variant',
      draftId: 'draft-1',
      recordId: 'variant-1',
      mediaItems: buildMediaItems(101),
    })

    expect(result).toEqual({ requestedCount: 101, failedCount: 1, errors: ['Failed to transfer attachments'] })
  })

  it('skips the request when there is no draft or no media', async () => {
    await expect(
      transferDraftMedia({ entityId: 'catalog:catalog_product', draftId: null, recordId: 'product-1', mediaItems: buildMediaItems(2) }),
    ).resolves.toEqual({ requestedCount: 0, failedCount: 0, errors: [] })
    await expect(
      transferDraftMedia({ entityId: 'catalog:catalog_product', draftId: 'draft-1', recordId: 'product-1', mediaItems: [] }),
    ).resolves.toEqual({ requestedCount: 0, failedCount: 0, errors: [] })
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
