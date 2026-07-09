import { createTillioClient } from '../lib/client'

const env = { apiUrl: 'https://x.example.com', apiKey: 'k', tenantSystemId: 'OM-abc' }

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>
}

describe('createTillioClient', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  })

  it('sends the environment identity headers on getPlugins', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ plugins: [] }))
    const client = createTillioClient(env)
    await client.getPlugins('test_connection')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://x.example.com/api/plugins')
    const headers = headersOf(fetchMock.mock.calls[0])
    expect(headers['X-Api-Key']).toBe('k')
    expect(headers['X-System']).toBe('OM-abc')
    expect(headers['X-Tenant']).toBe('OM-abc')
    expect(headers['X-Tenant-Domain']).toBe('test_connection')
  })

  it('throws TillioApiError on an error-in-200 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized', message: 'Bad key' }))
    const client = createTillioClient(env)
    await expect(client.getPlugins('test_connection')).rejects.toMatchObject({ name: 'TillioApiError', detail: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on 503 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ plugins: [] }))
    const client = createTillioClient(env)
    await client.getPlugins('test_connection')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails fast on a network error without retrying', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createTillioClient(env)
    await expect(client.getPlugins('test_connection')).rejects.toMatchObject({ detail: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('addConfig posts plugin+config with the operator tenant-domain and returns the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: 'tok' }))
    const client = createTillioClient(env)
    const res = await client.addConfig('Ringostat', { key: 'rk' }, 'x.example.com/OM-abc-ringostat')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://x.example.com/api/config')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ plugin: 'Ringostat', config: { key: 'rk' } })
    expect(headersOf(fetchMock.mock.calls[0])['X-Tenant-Domain']).toBe('x.example.com/OM-abc-ringostat')
    expect(res.token).toBe('tok')
  })
})
