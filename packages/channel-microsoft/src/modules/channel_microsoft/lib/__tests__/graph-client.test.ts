import {
  GraphApiError,
  getGraphApiClient,
  setGraphApiClient,
  type GraphAuth,
} from '../graph-client'

const auth: GraphAuth = { accessToken: 'access-token' }

type StubResponseInit = {
  status: number
  ok?: boolean
  statusText?: string
  json?: unknown
  text?: string
  buffer?: Buffer
  retryAfter?: string
}

function stubResponse(init: StubResponseInit): Response {
  const headers = new Map<string, string>()
  if (init.retryAfter !== undefined) headers.set('retry-after', init.retryAfter)
  const bodyText = init.text ?? (init.json !== undefined ? JSON.stringify(init.json) : '')
  return {
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    statusText: init.statusText ?? '',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
    arrayBuffer: async () => {
      const buf = init.buffer ?? Buffer.alloc(0)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    },
  } as unknown as Response
}

describe('GraphApiError', () => {
  it('captures status + detail for the adapter classification logic', () => {
    const error = new GraphApiError('Graph DELETE failed', 401, 'invalid_grant')
    expect(error.name).toBe('GraphApiError')
    expect(error.status).toBe(401)
    expect(error.detail).toBe('invalid_grant')
  })
})

describe('FetchGraphApiClient retry/backoff/classification', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: jest.Mock

  beforeEach(() => {
    // Force getGraphApiClient() to return a fresh real FetchGraphApiClient
    // rather than a mock another test may have installed.
    setGraphApiClient(null)
    fetchMock = jest.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setGraphApiClient(null)
  })

  it('honors Retry-After and retries a throttled 429, then returns the parsed body', async () => {
    fetchMock
      .mockResolvedValueOnce(stubResponse({ status: 429, retryAfter: '0' }))
      .mockResolvedValueOnce(stubResponse({ status: 200, json: { id: 'me', mail: 'a@b.com' } }))
    const profile = await getGraphApiClient().getProfile(auth)
    expect(profile.id).toBe('me')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a 5xx as transient and retries it', async () => {
    fetchMock
      .mockResolvedValueOnce(stubResponse({ status: 503, retryAfter: '0' }))
      .mockResolvedValueOnce(stubResponse({ status: 200, json: { id: 'me' } }))
    const profile = await getGraphApiClient().getProfile(auth)
    expect(profile.id).toBe('me')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('classifies a 4xx as fatal — no retry — and surfaces the parsed error detail', async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({ status: 400, json: { error: { message: 'Bad request', code: 'BadArgument' } } }),
    )
    await expect(getGraphApiClient().getProfile(auth)).rejects.toMatchObject({
      name: 'GraphApiError',
      status: 400,
      detail: 'Bad request',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies a 401 as fatal (reauth path) and does not retry', async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({ status: 401, json: { error: { code: 'InvalidAuthenticationToken' } } }),
    )
    await expect(getGraphApiClient().getProfile(auth)).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after GRAPH_MAX_RETRIES + 1 attempts on a persistent 503', async () => {
    fetchMock.mockResolvedValue(stubResponse({ status: 503, retryAfter: '0' }))
    await expect(getGraphApiClient().getProfile(auth)).rejects.toMatchObject({ status: 503 })
    // GRAPH_MAX_RETRIES = 3 → attempts 0,1,2,3 = 4 total fetches.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('falls back to capped exponential backoff when no Retry-After header is present', async () => {
    fetchMock
      .mockResolvedValueOnce(stubResponse({ status: 503 }))
      .mockResolvedValueOnce(stubResponse({ status: 200, json: { id: 'me' } }))
    const profile = await getGraphApiClient().getProfile(auth)
    expect(profile.id).toBe('me')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getMessageMime retries a 429 then returns the decoded MIME buffer', async () => {
    const mime = Buffer.from('From: a@b.com\r\nSubject: hi\r\n\r\nbody', 'utf8')
    fetchMock
      .mockResolvedValueOnce(stubResponse({ status: 429, retryAfter: '0' }))
      .mockResolvedValueOnce(stubResponse({ status: 200, buffer: mime }))
    const result = await getGraphApiClient().getMessageMime(auth, 'message-1')
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.toString('utf8')).toContain('Subject: hi')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getMessageMime throws a GraphApiError with status on a fatal 404', async () => {
    fetchMock.mockResolvedValueOnce(
      stubResponse({ status: 404, json: { error: { message: 'Not found' } } }),
    )
    await expect(getGraphApiClient().getMessageMime(auth, 'missing')).rejects.toMatchObject({
      name: 'GraphApiError',
      status: 404,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
