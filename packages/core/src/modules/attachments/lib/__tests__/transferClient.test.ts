/** @jest-environment node */

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { chunkAttachmentIds, transferAttachmentsInChunks } from '../transferClient'
import { ATTACHMENT_TRANSFER_MAX_IDS } from '../transferLimits'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

function buildIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
}

function sentIds(callIndex: number): string[] {
  const init = apiCallMock.mock.calls[callIndex]?.[1] as RequestInit | undefined
  return (JSON.parse(String(init?.body)) as { attachmentIds: string[] }).attachmentIds
}

function okResponse(updated: number) {
  return { ok: true, status: 200, result: { ok: true, updated }, response: {} as Response, cacheStatus: null } as never
}

function failedResponse(error: string) {
  return { ok: false, status: 400, result: { error }, response: {} as Response, cacheStatus: null } as never
}

describe('transferAttachmentsInChunks', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('splits ids into chunks no larger than the server limit', () => {
    const chunks = chunkAttachmentIds(buildIds(201))
    expect(chunks.map((chunk) => chunk.length)).toEqual([ATTACHMENT_TRANSFER_MAX_IDS, ATTACHMENT_TRANSFER_MAX_IDS, 1])
  })

  it('sends 101 ids as two requests that each respect the limit', async () => {
    apiCallMock.mockResolvedValueOnce(okResponse(100)).mockResolvedValueOnce(okResponse(1))
    const ids = buildIds(101)

    const result = await transferAttachmentsInChunks({
      entityId: 'catalog:catalog_product',
      attachmentIds: ids,
      fromRecordId: 'draft-1',
      toRecordId: 'product-1',
    })

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(sentIds(0)).toEqual(ids.slice(0, 100))
    expect(sentIds(1)).toEqual(ids.slice(100))
    expect(apiCallMock.mock.calls[0]?.[0]).toBe('/api/attachments/transfer')
    expect(result).toEqual({ transferredCount: 101, failedIds: [], unconfirmedCount: 0, errors: [] })
  })

  it('reports the ids of a failed chunk and still transfers the remaining chunks', async () => {
    apiCallMock.mockResolvedValueOnce(failedResponse('Invalid payload')).mockResolvedValueOnce(okResponse(1))
    const ids = buildIds(101)

    const result = await transferAttachmentsInChunks({
      entityId: 'catalog:catalog_product',
      attachmentIds: ids,
      fromRecordId: 'draft-1',
      toRecordId: 'product-1',
    })

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(result.transferredCount).toBe(1)
    expect(result.failedIds).toEqual(ids.slice(0, 100))
    expect(result.errors).toEqual(['Invalid payload'])
  })

  it('keeps transferring after a chunk request rejects with a network error', async () => {
    apiCallMock
      .mockResolvedValueOnce(okResponse(100))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(1))
    const ids = buildIds(201)

    const result = await transferAttachmentsInChunks({
      entityId: 'catalog:catalog_product',
      attachmentIds: ids,
      fromRecordId: 'draft-1',
      toRecordId: 'product-1',
    })

    expect(apiCallMock).toHaveBeenCalledTimes(3)
    expect(sentIds(2)).toEqual(ids.slice(200))
    expect(result).toEqual({
      transferredCount: 101,
      failedIds: ids.slice(100, 200),
      unconfirmedCount: 0,
      errors: ['Failed to fetch'],
    })
  })

  it.each([
    ['an expired session', Object.assign(new Error('Unauthorized'), { name: 'UnauthorizedError' })],
    ['a cancelled request', Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })],
  ])('stops sending chunks after %s and reports the remaining ids without throwing', async (_label, error) => {
    apiCallMock.mockResolvedValueOnce(okResponse(100)).mockRejectedValueOnce(error)
    const ids = buildIds(201)

    const result = await transferAttachmentsInChunks({
      entityId: 'catalog:catalog_product',
      attachmentIds: ids,
      fromRecordId: 'draft-1',
      toRecordId: 'product-1',
    })

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(result.transferredCount).toBe(100)
    expect(result.failedIds).toEqual(ids.slice(100))
    expect(result.errors).toEqual([error.message])
  })

  it('counts ids the server did not acknowledge as unconfirmed', async () => {
    apiCallMock
      .mockResolvedValueOnce(okResponse(99))
      .mockResolvedValueOnce(okResponse(100))
      .mockResolvedValueOnce({ ok: true, status: 200, result: null, response: {} as Response, cacheStatus: null } as never)
    const ids = buildIds(201)

    const result = await transferAttachmentsInChunks({
      entityId: 'catalog:catalog_product',
      attachmentIds: ids,
      fromRecordId: 'draft-1',
      toRecordId: 'product-1',
    })

    expect(result).toEqual({ transferredCount: 199, failedIds: [], unconfirmedCount: 2, errors: [] })
  })

  it('omits fromRecordId when it is not provided', async () => {
    apiCallMock.mockResolvedValueOnce(okResponse(1))

    await transferAttachmentsInChunks({ entityId: 'checkout:link', attachmentIds: buildIds(1), toRecordId: 'link-1' })

    const init = apiCallMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('fromRecordId')
  })
})
