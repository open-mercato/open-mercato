import {
  GRAPH_MESSAGE_SELECT,
  GraphApiError,
  escapeODataString,
  getGraphMailClient,
  isResyncRequiredError,
  resolveGraphPageSize,
  setGraphMailClient,
} from '../graph-client'

type FakeResponseInit = {
  status: number
  statusText?: string
  body?: string | Buffer
  headers?: Record<string, string>
}

type RecordedRequest = { url: URL; method: string; headers: Record<string, string>; body?: string }

function fakeResponse(init: FakeResponseInit): Response {
  const headerMap = new Map(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
  const body = init.body ?? ''
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: init.statusText ?? '',
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    text: async () => (Buffer.isBuffer(body) ? body.toString('utf-8') : body),
    arrayBuffer: async () => {
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8')
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    },
  } as unknown as Response
}

function installFetch(responses: FakeResponseInit[]): RecordedRequest[] {
  const recorded: RecordedRequest[] = []
  const queue = [...responses]
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    recorded.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    const next = queue.shift()
    if (!next) throw new Error('no fake response queued')
    return fakeResponse(next)
  }) as typeof fetch
  return recorded
}

const originalFetch = globalThis.fetch
const auth = { accessToken: 'token' }

afterEach(() => {
  globalThis.fetch = originalFetch
  setGraphMailClient(null)
  delete process.env.OM_CHANNEL_MS365_DELTA_PAGE_SIZE
})

describe('helpers', () => {
  it('escapes OData string literals', () => {
    expect(escapeODataString("o'brien@example.com")).toBe("o''brien@example.com")
  })

  it('clamps the page size to 1..200 and honours the env default', () => {
    expect(resolveGraphPageSize()).toBe(50)
    expect(resolveGraphPageSize(5000)).toBe(200)
    expect(resolveGraphPageSize(0)).toBe(1)
    process.env.OM_CHANNEL_MS365_DELTA_PAGE_SIZE = '25'
    expect(resolveGraphPageSize()).toBe(25)
  })

  it('classifies resync errors by status or Graph code', () => {
    expect(isResyncRequiredError(new GraphApiError('gone', 410, 'gone'))).toBe(true)
    expect(isResyncRequiredError(new GraphApiError('bad', 400, 'bad', { code: 'SyncStateNotFound' }))).toBe(true)
    expect(isResyncRequiredError(new GraphApiError('bad', 400, 'bad', { code: 'InvalidRequest' }))).toBe(false)
    expect(isResyncRequiredError(new Error('gone'))).toBe(false)
  })

  it('marks 429/5xx/timeouts transient and everything else permanent', () => {
    expect(new GraphApiError('x', 429, 'x').transient).toBe(true)
    expect(new GraphApiError('x', 503, 'x').transient).toBe(true)
    expect(new GraphApiError('x', 599, 'x').transient).toBe(true)
    expect(new GraphApiError('x', 403, 'x').transient).toBe(false)
    expect(new GraphApiError('x', 401, 'x').transient).toBe(false)
  })
})

describe('FetchGraphMailClient', () => {
  it('starts an Inbox delta with the projection, filter, immutable ids and page size', async () => {
    const recorded = installFetch([
      {
        status: 200,
        body: JSON.stringify({
          value: [{ id: 'm1', receivedDateTime: '2026-09-04T10:00:00Z' }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
        }),
      },
    ])
    const page = await getGraphMailClient().startInboxDelta(auth, { receivedSince: new Date('2026-09-04T09:58:00.000Z'), pageSize: 20 })
    const request = recorded[0]
    expect(request.url.pathname).toBe('/v1.0/me/mailFolders/inbox/messages/delta')
    expect(request.url.searchParams.get('$select')).toBe(GRAPH_MESSAGE_SELECT)
    expect(request.url.searchParams.get('$filter')).toBe('receivedDateTime ge 2026-09-04T09:58:00.000Z')
    expect(request.headers.Authorization).toBe('Bearer token')
    expect(request.headers.Prefer).toBe('IdType="ImmutableId", odata.maxpagesize=20')
    expect(page.value).toHaveLength(1)
    expect(page.deltaLink).toContain('$deltatoken=abc')
    expect(page.nextLink).toBeUndefined()
  })

  it('refuses to follow a delta link that leaves the Graph origin', async () => {
    installFetch([])
    await expect(getGraphMailClient().continueDelta(auth, 'https://evil.example.com/v1.0/delta?x=1')).rejects.toMatchObject({
      name: 'GraphApiError',
      status: 400,
    })
  })

  it('follows a same-origin next link verbatim', async () => {
    const recorded = installFetch([{ status: 200, body: JSON.stringify({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skiptoken=2' }) }])
    const page = await getGraphMailClient().continueDelta(auth, 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=1')
    expect(recorded[0].url.toString()).toBe('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=1')
    expect(page.nextLink).toContain('$skiptoken=2')
  })

  it('returns raw MIME bytes for $value', async () => {
    const mime = Buffer.from('From: a@b.c\r\n\r\nhello', 'utf-8')
    const recorded = installFetch([{ status: 200, body: mime }])
    const result = await getGraphMailClient().getMessageMime(auth, 'AAMk=')
    expect(recorded[0].url.pathname).toBe('/v1.0/me/messages/AAMk%3D/$value')
    expect(result.equals(mime)).toBe(true)
  })

  it('creates a draft from base64 MIME with a text/plain body and sends it', async () => {
    const mime = Buffer.from('Subject: hi\r\n\r\nbody', 'utf-8')
    const recorded = installFetch([
      { status: 201, body: JSON.stringify({ id: 'draft-1', internetMessageId: '<abc@contoso.com>', conversationId: 'conv-1' }) },
      { status: 202 },
    ])
    const client = getGraphMailClient()
    const draft = await client.createDraftFromMime(auth, mime)
    await client.sendDraft(auth, draft.id)
    expect(recorded[0].method).toBe('POST')
    expect(recorded[0].url.pathname).toBe('/v1.0/me/messages')
    expect(recorded[0].headers['Content-Type']).toBe('text/plain')
    expect(recorded[0].body).toBe(mime.toString('base64'))
    expect(draft.internetMessageId).toBe('<abc@contoso.com>')
    expect(recorded[1].method).toBe('POST')
    expect(recorded[1].url.pathname).toBe('/v1.0/me/messages/draft-1/send')
  })

  it('looks a message up by internetMessageId with an escaped literal', async () => {
    const recorded = installFetch([{ status: 200, body: JSON.stringify({ value: [{ id: 'found' }] }) }, { status: 200, body: JSON.stringify({ value: [] }) }])
    const client = getGraphMailClient()
    expect(await client.findMessageIdByInternetMessageId(auth, "<o'brien@x.com>")).toBe('found')
    expect(recorded[0].url.searchParams.get('$filter')).toBe("internetMessageId eq '<o''brien@x.com>'")
    expect(await client.findMessageIdByInternetMessageId(auth, '<none@x.com>')).toBeNull()
  })

  it('moves and deletes messages', async () => {
    const recorded = installFetch([{ status: 201, body: JSON.stringify({ id: 'moved' }) }, { status: 204 }])
    const client = getGraphMailClient()
    await client.moveMessage(auth, 'm1', 'deleteditems')
    await client.deleteMessage(auth, 'd1')
    expect(recorded[0].url.pathname).toBe('/v1.0/me/messages/m1/move')
    expect(JSON.parse(recorded[0].body ?? '{}')).toEqual({ destinationId: 'deleteditems' })
    expect(recorded[1].method).toBe('DELETE')
    expect(recorded[1].url.pathname).toBe('/v1.0/me/messages/d1')
  })

  it('surfaces Graph error codes and never retries permanent failures', async () => {
    const recorded = installFetch([
      { status: 403, body: JSON.stringify({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }) },
    ])
    await expect(getGraphMailClient().startInboxDelta(auth, {})).rejects.toMatchObject({
      name: 'GraphApiError',
      status: 403,
      code: 'ErrorAccessDenied',
      detail: 'Access is denied.',
      transient: false,
    })
    expect(recorded).toHaveLength(1)
  })

  it('retries a 429 honouring Retry-After and then succeeds', async () => {
    const recorded = installFetch([
      { status: 429, body: JSON.stringify({ error: { code: 'TooManyRequests', message: 'slow down' } }), headers: { 'Retry-After': '0' } },
      { status: 200, body: JSON.stringify({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/d?$deltatoken=1' }) },
    ])
    const page = await getGraphMailClient().startInboxDelta(auth, {})
    expect(recorded).toHaveLength(2)
    expect(page.deltaLink).toContain('$deltatoken=1')
  })

  it('maps 410 Gone to a resync-required error', async () => {
    installFetch([{ status: 410, body: JSON.stringify({ error: { code: 'syncStateNotFound', message: 'The sync state is not found.' } }) }])
    let caught: unknown
    try {
      await getGraphMailClient().continueDelta(auth, 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=old')
    } catch (error) {
      caught = error
    }
    expect(isResyncRequiredError(caught)).toBe(true)
  })

  it('lists inbox messages with filter, orderby, top and optional count', async () => {
    const recorded = installFetch([{ status: 200, body: JSON.stringify({ value: [], '@odata.count': 7 }) }])
    const page = await getGraphMailClient().listInboxMessages(auth, {
      filter: 'receivedDateTime ge 2026-09-01T00:00:00.000Z',
      top: 10,
      orderBy: 'receivedDateTime desc',
      includeCount: true,
    })
    const url = recorded[0].url
    expect(url.pathname).toBe('/v1.0/me/mailFolders/inbox/messages')
    expect(url.searchParams.get('$filter')).toBe('receivedDateTime ge 2026-09-01T00:00:00.000Z')
    expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc')
    expect(url.searchParams.get('$top')).toBe('10')
    expect(url.searchParams.get('$count')).toBe('true')
    expect(recorded[0].headers.Prefer).toContain('ConsistencyLevel=eventual')
    expect(page.count).toBe(7)
  })
})
