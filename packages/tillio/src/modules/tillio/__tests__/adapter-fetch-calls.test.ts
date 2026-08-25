import { createTillioAdapter } from '../lib/adapter'

const credentials = {
  apiUrl: 'https://x.example.com',
  apiKey: 'k',
  tenantSystemId: 'OM-abc',
  operator: {
    id: 'ringostat-1',
    plugin: 'Ringostat' as const,
    token: 'tok',
    tenantDomain: 'app.example.com/OM-abc-ringostat-1',
  },
}

const scope = { organizationId: 'org', tenantId: 'ten' }

function call(id: string) {
  return { id, date: '2026-04-11T12:47:28+0200', type: 'IN', caller: '48111', destination: '48222', status: 'ANSWERED', billSec: '5' }
}

function page(calls: unknown[], pageNumber: number, pages: number): Response {
  return new Response(
    JSON.stringify({ calls, pagination: { total: String(calls.length * pages), page: String(pageNumber), pages: String(pages) } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function queryOf(fetchCall: unknown[]): URLSearchParams {
  return new URL(fetchCall[0] as string).searchParams
}

describe('tillioAdapter.fetchCalls', () => {
  const fetchMock = jest.fn()
  // The client now validates and DNS-pins every outbound URL, so the test injects both
  // seams instead of stubbing the global fetch.
  const tillioAdapter = createTillioAdapter({
    fetchImpl: fetchMock as unknown as typeof fetch,
    lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
  })

  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('walks every page reported by pagination and reports no cursor at the end', async () => {
    fetchMock
      .mockResolvedValueOnce(page([call('a')], 1, 3))
      .mockResolvedValueOnce(page([call('b')], 2, 3))
      .mockResolvedValueOnce(page([call('c')], 3, 3))

    const batch = await tillioAdapter.fetchCalls({ credentials, scope })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(batch.calls.map((entry) => entry.externalCallId)).toEqual(['a', 'b', 'c'])
    expect(batch.nextCursor).toBeNull()
  })

  it('sends the Warsaw wall-clock window and the operator token', async () => {
    fetchMock.mockResolvedValue(page([call('a')], 1, 1))

    await tillioAdapter.fetchCalls({
      credentials,
      scope,
      from: new Date('2026-06-10T22:00:00.000Z'),
      to: new Date('2026-06-11T21:59:00.000Z'),
    })

    const query = queryOf(fetchMock.mock.calls[0])
    expect(query.get('from')).toBe('2026-06-11 00:00')
    expect(query.get('to')).toBe('2026-06-11 23:59')
    expect(query.get('page')).toBe('1')
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Token']).toBe('tok')
    expect(headers['X-Tenant-Domain']).toBe('app.example.com/OM-abc-ringostat-1')
  })

  it('sends the window in the configured zone instead of the default one', async () => {
    fetchMock.mockResolvedValue(page([call('a')], 1, 1))

    await tillioAdapter.fetchCalls({
      credentials: { ...credentials, timeZone: 'UTC' },
      scope,
      from: new Date('2026-06-10T22:00:00.000Z'),
      to: new Date('2026-06-11T21:59:00.000Z'),
    })

    const query = queryOf(fetchMock.mock.calls[0])
    expect(query.get('from')).toBe('2026-06-10 22:00')
    expect(query.get('to')).toBe('2026-06-11 21:59')
  })

  it('stops at the batch limit but drains the current page first', async () => {
    fetchMock
      .mockResolvedValueOnce(page([call('a'), call('b')], 1, 4))
      .mockResolvedValueOnce(page([call('c'), call('d')], 2, 4))

    const batch = await tillioAdapter.fetchCalls({ credentials, scope, limit: 3 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(batch.calls).toHaveLength(4)
    expect(batch.nextCursor).toBe('3')
  })

  it('resumes from the cursor', async () => {
    fetchMock.mockResolvedValueOnce(page([call('c')], 2, 2))

    const batch = await tillioAdapter.fetchCalls({ credentials, scope, cursor: '2' })

    expect(queryOf(fetchMock.mock.calls[0]).get('page')).toBe('2')
    expect(batch.calls.map((entry) => entry.externalCallId)).toEqual(['c'])
    expect(batch.nextCursor).toBeNull()
  })

  // These three exits used to be indistinguishable from reaching the last page, which let a
  // provider that ignores `page` pass off one page as the whole range.
  it('reports the anomaly when the server ignores the requested page', async () => {
    fetchMock.mockResolvedValue(page([call('a')], 1, 5))

    const batch = await tillioAdapter.fetchCalls({ credentials, scope, cursor: '3' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(batch.calls).toHaveLength(1)
    expect(batch.nextCursor).toBeNull()
    expect(batch.anomaly).toBe('page_not_echoed')
    expect(batch.anomalyCursor).toBe('3')
  })

  it('reports the anomaly on an empty page even when more pages are claimed', async () => {
    fetchMock.mockResolvedValueOnce(page([], 1, 9))

    const batch = await tillioAdapter.fetchCalls({ credentials, scope })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(batch.calls).toHaveLength(0)
    expect(batch.nextCursor).toBeNull()
    expect(batch.anomaly).toBe('empty_page')
  })

  it('reports the anomaly when pagination claims zero pages', async () => {
    fetchMock.mockResolvedValueOnce(page([call('a')], 1, 0))

    const batch = await tillioAdapter.fetchCalls({ credentials, scope })

    expect(batch.anomaly).toBe('invalid_page_count')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(batch.nextCursor).toBeNull()
  })
})
