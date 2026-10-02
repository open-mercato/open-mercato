import {
  ASN_RECEIVING_LINES_PAGE_SIZE,
  loadAllAsnReceivingLines,
  type AsnReceivingLineRow,
} from '../asnReceivingLinesLoader'

function makeLine(id: string): AsnReceivingLineRow {
  return {
    id,
    expected_qty: 1,
    received_qty: 0,
    qc_status: 'pending',
  }
}

describe('loadAllAsnReceivingLines', () => {
  it('fetches every page until a short page (pageSize 100)', async () => {
    const page1 = Array.from({ length: ASN_RECEIVING_LINES_PAGE_SIZE }, (_, i) =>
      makeLine(`line-${i + 1}`),
    )
    const page2 = [makeLine('line-101'), makeLine('line-102')]
    const fetchPage = jest.fn(async (page: number, pageSize: number) => {
      expect(pageSize).toBe(ASN_RECEIVING_LINES_PAGE_SIZE)
      if (page === 1) {
        return {
          ok: true as const,
          response: new Response(null, { status: 200 }),
          result: { items: page1, total: 102, totalPages: 2 },
        }
      }
      return {
        ok: true as const,
        response: new Response(null, { status: 200 }),
        result: { items: page2, total: 102, totalPages: 2 },
      }
    })

    const result = await loadAllAsnReceivingLines('asn-1', { fetchPage })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(102)
    expect(result.items[0]?.id).toBe('line-1')
    expect(result.items[100]?.id).toBe('line-101')
    expect(result.items[101]?.id).toBe('line-102')
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1, ASN_RECEIVING_LINES_PAGE_SIZE)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, ASN_RECEIVING_LINES_PAGE_SIZE)
  })

  it('stops after a single short first page', async () => {
    const fetchPage = jest.fn(async () => ({
      ok: true as const,
      response: new Response(null, { status: 200 }),
      result: {
        items: [makeLine('only')],
        total: 1,
        totalPages: 1,
      },
    }))

    const result = await loadAllAsnReceivingLines('asn-1', { fetchPage })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toEqual([makeLine('only')])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('does not use totalPages as a loop bound when total is capped', async () => {
    const page1 = Array.from({ length: ASN_RECEIVING_LINES_PAGE_SIZE }, (_, i) =>
      makeLine(`capped-${i + 1}`),
    )
    const page2 = Array.from({ length: ASN_RECEIVING_LINES_PAGE_SIZE }, (_, i) =>
      makeLine(`capped-${i + 101}`),
    )
    const page3 = [makeLine('capped-201')]
    const fetchPage = jest.fn(async (page: number) => {
      // Misleading totalPages (OM_LIST_COUNT_CAP style) — loader must ignore it.
      const cappedEnvelope = { total: 100, totalPages: 1 }
      if (page === 1) {
        return {
          ok: true as const,
          response: new Response(null, { status: 200 }),
          result: { items: page1, ...cappedEnvelope },
        }
      }
      if (page === 2) {
        return {
          ok: true as const,
          response: new Response(null, { status: 200 }),
          result: { items: page2, ...cappedEnvelope },
        }
      }
      return {
        ok: true as const,
        response: new Response(null, { status: 200 }),
        result: { items: page3, ...cappedEnvelope },
      }
    })

    const result = await loadAllAsnReceivingLines('asn-1', { fetchPage })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(201)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('returns the failed response without truncating prior pages', async () => {
    const page1 = Array.from({ length: ASN_RECEIVING_LINES_PAGE_SIZE }, (_, i) =>
      makeLine(`ok-${i + 1}`),
    )
    const failed = new Response(null, { status: 500 })
    const fetchPage = jest.fn(async (page: number) => {
      if (page === 1) {
        return {
          ok: true as const,
          response: new Response(null, { status: 200 }),
          result: { items: page1, total: 150, totalPages: 2 },
        }
      }
      return { ok: false as const, response: failed }
    })

    const result = await loadAllAsnReceivingLines('asn-1', { fetchPage })

    expect(result).toEqual({ ok: false, response: failed })
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('clamps requested pageSize to the API max of 100', async () => {
    const fetchPage = jest.fn(async () => ({
      ok: true as const,
      response: new Response(null, { status: 200 }),
      result: { items: [makeLine('a')], total: 1, totalPages: 1 },
    }))

    await loadAllAsnReceivingLines('asn-1', { pageSize: 500, fetchPage })

    expect(fetchPage).toHaveBeenCalledWith(1, ASN_RECEIVING_LINES_PAGE_SIZE)
  })
})
