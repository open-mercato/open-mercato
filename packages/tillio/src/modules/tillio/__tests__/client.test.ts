import { createTillioClient, redactTillioUrl, type TillioClientDeps } from '../lib/client'

const env = { apiUrl: 'https://x.example.com', apiKey: 'k', tenantSystemId: 'OM-abc' }

const publicLookupHost: TillioClientDeps['lookupHost'] = async () => [{ address: '93.184.216.34', family: 4 }]

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function redirectResponse(status: number, location?: string): Response {
  return new Response(null, {
    status,
    headers: location ? { location } : {},
  })
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>
}

describe('createTillioClient', () => {
  const fetchMock = jest.fn()

  function client(deps: TillioClientDeps = {}) {
    return createTillioClient(env, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      lookupHost: publicLookupHost,
      ...deps,
    })
  }

  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('sends the environment identity headers on getPlugins', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ plugins: [] }))
    await client().getPlugins('test_connection')
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
    await expect(client().getPlugins('test_connection')).rejects.toMatchObject({ name: 'TillioApiError', detail: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on 503 then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ plugins: [] }))
    await client().getPlugins('test_connection')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails fast on a network error without retrying', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(client().getPlugins('test_connection')).rejects.toMatchObject({ detail: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('addConfig posts plugin+config with the operator tenant-domain and returns the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: 'tok' }))
    const res = await client().addConfig('Ringostat', { key: 'rk' }, 'x.example.com/OM-abc-ringostat')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://x.example.com/api/config')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ plugin: 'Ringostat', config: { key: 'rk' } })
    expect(headersOf(fetchMock.mock.calls[0])['X-Tenant-Domain']).toBe('x.example.com/OM-abc-ringostat')
    expect(res.token).toBe('tok')
  })

  describe('outbound URL safety', () => {
    it('refuses to build a client for a private API URL', () => {
      expect(() => createTillioClient({ ...env, apiUrl: 'http://169.254.169.254' })).toThrow()
      expect(() => createTillioClient({ ...env, apiUrl: 'http://10.0.0.5' })).toThrow()
      expect(() => createTillioClient({ ...env, apiUrl: 'http://localhost:9000' })).toThrow()
    })

    it('blocks a public hostname that resolves to a private address', async () => {
      const lookupHost = jest.fn(async () => [{ address: '10.0.0.5', family: 4 }])
      await expect(client({ lookupHost }).getPlugins('test_connection')).rejects.toMatchObject({
        name: 'TillioApiError',
        detail: 'private_ip_resolved',
      })
      expect(lookupHost).toHaveBeenCalledWith('x.example.com')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('revalidates DNS on every request, so a rebind between calls is caught', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ plugins: [] }))
      const lookupHost = jest.fn()
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
        .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      const tillio = client({ lookupHost })

      await tillio.getPlugins('test_connection')
      await expect(tillio.getPlugins('test_connection')).rejects.toMatchObject({ detail: 'private_ip_resolved' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('follows a same-host redirect and revalidates the target', async () => {
      const lookupHost = jest.fn(publicLookupHost)
      fetchMock
        .mockResolvedValueOnce(redirectResponse(302, 'https://x.example.com/api/plugins/v2'))
        .mockResolvedValueOnce(jsonResponse({ plugins: [] }))

      await client({ lookupHost }).getPlugins('test_connection')

      expect(fetchMock.mock.calls[1][0]).toBe('https://x.example.com/api/plugins/v2')
      expect(lookupHost).toHaveBeenCalledTimes(2)
    })

    it('refuses a redirect that leaves the configured host', async () => {
      fetchMock.mockResolvedValueOnce(redirectResponse(302, 'https://attacker.example.net/api/plugins'))
      await expect(client().getPlugins('test_connection')).rejects.toMatchObject({ detail: 'redirect' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('refuses a redirect that downgrades https to http', async () => {
      fetchMock.mockResolvedValueOnce(redirectResponse(301, 'http://x.example.com/api/plugins'))
      await expect(client().getPlugins('test_connection')).rejects.toMatchObject({ detail: 'redirect' })
    })

    it('refuses a redirect without a Location header', async () => {
      fetchMock.mockResolvedValueOnce(redirectResponse(302))
      await expect(client().getPlugins('test_connection')).rejects.toMatchObject({ detail: 'redirect' })
    })

    it('stops after too many redirects', async () => {
      fetchMock.mockResolvedValue(redirectResponse(302, 'https://x.example.com/api/loop'))
      await expect(client().getPlugins('test_connection')).rejects.toMatchObject({ detail: 'redirect' })
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('drops the body when a 303 turns the request into a GET', async () => {
      fetchMock
        .mockResolvedValueOnce(redirectResponse(303, 'https://x.example.com/api/config/result'))
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))

      await client().addConfig('Ringostat', { key: 'rk' }, 'x.example.com/OM-abc-ringostat')

      const [, followUpInit] = fetchMock.mock.calls[1]
      expect((followUpInit as RequestInit).method).toBe('GET')
      expect((followUpInit as RequestInit).body).toBeUndefined()
    })
  })

  describe('token redaction', () => {
    it('keeps the token out of a network failure message', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'))
      const promise = client().deleteConfig('Ringostat', 'super-secret-token', 'x.example.com/OM-abc-ringostat')
      await expect(promise).rejects.toMatchObject({ detail: 'network' })
      await expect(promise).rejects.toThrow(/token=\*\*\*/)
      await expect(promise).rejects.not.toThrow(/super-secret-token/)
    })

    it('masks only the token parameter', () => {
      expect(redactTillioUrl('https://x.example.com/api/config?plugin=Ringostat&token=abc')).toBe(
        'https://x.example.com/api/config?plugin=Ringostat&token=***',
      )
      expect(redactTillioUrl('https://x.example.com/api/call?page=2')).toBe('https://x.example.com/api/call?page=2')
    })

    it('drops the whole query when the URL cannot be parsed', () => {
      expect(redactTillioUrl('not a url?token=abc')).toBe('not a url')
    })
  })
})
