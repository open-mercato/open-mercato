/** @jest-environment node */

import {
  acquireInboundPartBytes,
  classifyResendSdkError,
  downloadWithSizeCap,
  listInboundAttachmentDescriptors,
  type ResendInboundAttachmentsApi,
} from '../resendInboundAttachments'

const NOW = new Date('2026-11-08T10:00:00.000Z')

function descriptor(id: string, expiresInMs = 3_600_000) {
  return { id, download_url: `https://files.example.test/${id}`, expires_at: new Date(NOW.getTime() + expiresInMs).toISOString() }
}

function streamOf(chunks: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size))
      controller.close()
    },
  })
}

describe('classifyResendSdkError', () => {
  it.each([
    [{ statusCode: 404, name: 'not_found' }, { kind: 'not_found' }],
    [{ statusCode: undefined, name: 'not_found' }, { kind: 'not_found' }],
    [{ statusCode: 401, name: 'invalid_api_key' }, { kind: 'transient', code: 'http_401' }],
    [{ statusCode: 403, name: 'restricted_api_key' }, { kind: 'transient', code: 'http_403' }],
    [{ statusCode: 429, name: 'rate_limit_exceeded' }, { kind: 'transient', code: 'http_429' }],
    [{ statusCode: 500, name: 'internal_server_error' }, { kind: 'transient', code: 'http_500' }],
    [{ statusCode: null, name: 'application_error' }, { kind: 'transient', code: 'network' }],
    [{ statusCode: null, name: 'not_found' }, { kind: 'transient', code: 'network' }],
  ])('classifies %o', (error, expected) => {
    expect(classifyResendSdkError(error as never)).toEqual(expected)
  })
})

describe('listInboundAttachmentDescriptors', () => {
  it('reports the email gone on a first-page 404 and a plain failure otherwise', async () => {
    const api = {
      list: jest.fn()
        .mockResolvedValueOnce({ data: null, error: { statusCode: 404, name: 'not_found', message: '' } }),
      get: jest.fn(),
    }
    expect(await listInboundAttachmentDescriptors(api as unknown as ResendInboundAttachmentsApi, 'e', 1000)).toMatchObject({ emailNotFound: true, failed: true })

    api.list
      .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('a')] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { statusCode: 404, name: 'not_found', message: '' } })
    const partial = await listInboundAttachmentDescriptors(api as unknown as ResendInboundAttachmentsApi, 'e', 1000)
    expect(partial).toMatchObject({ emailNotFound: false, failed: true })
    expect([...partial.byId.keys()]).toEqual(['a'])
  })

  it('stops paging when has_more is false or the cursor does not move', async () => {
    const api = {
      list: jest.fn()
        .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('a')] }, error: null })
        .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('a')] }, error: null }),
      get: jest.fn(),
    }
    const listed = await listInboundAttachmentDescriptors(api as unknown as ResendInboundAttachmentsApi, 'e', 1000)
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(listed.failed).toBe(false)
  })

  it('stops paging once every wanted id is listed and runs beforeNextPage before each further page', async () => {
    const api = {
      list: jest.fn()
        .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('a'), descriptor('b')] }, error: null })
        .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('c')] }, error: null })
        .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('d')] }, error: null }),
      get: jest.fn(),
    }
    const beforeNextPage = jest.fn(async () => true)
    const listed = await listInboundAttachmentDescriptors(api as unknown as ResendInboundAttachmentsApi, 'e', 1000, {
      wantedIds: new Set(['a', 'c']),
      beforeNextPage,
    })
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(beforeNextPage).toHaveBeenCalledTimes(1)
    expect(listed).toMatchObject({ failed: false, aborted: false, emailNotFound: false })
    expect([...listed.byId.keys()]).toEqual(['a', 'b', 'c'])
  })

  it('stops listing with aborted when beforeNextPage reports a lost claim', async () => {
    const api = {
      list: jest.fn().mockResolvedValue({ data: { has_more: true, data: [descriptor('a')] }, error: null }),
      get: jest.fn(),
    }
    const listed = await listInboundAttachmentDescriptors(api as unknown as ResendInboundAttachmentsApi, 'e', 1000, {
      wantedIds: new Set(['z']),
      beforeNextPage: async () => false,
    })
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(listed).toMatchObject({ aborted: true, failed: false })
  })
})

describe('downloadWithSizeCap', () => {
  it('refuses a declared length above the cap without reading the body', async () => {
    const fetchImpl = jest.fn(async () => new Response(streamOf([10]), { status: 200, headers: { 'content-length': '999' } }))
    expect(await downloadWithSizeCap('https://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl })).toEqual({ kind: 'too_large' })
  })

  it('stops streaming once the cap is exceeded', async () => {
    const fetchImpl = jest.fn(async () => new Response(streamOf([60, 60, 60]), { status: 200 }))
    expect(await downloadWithSizeCap('https://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl })).toEqual({ kind: 'too_large' })
  })

  it('returns the bytes within the cap', async () => {
    const fetchImpl = jest.fn(async () => new Response(streamOf([40, 40]), { status: 200 }))
    const result = await downloadWithSizeCap('https://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl })
    expect(result.kind).toBe('ok')
    expect(result.kind === 'ok' ? result.buffer.length : 0).toBe(80)
  })

  it('refuses non-http URLs and reports HTTP statuses', async () => {
    const fetchImpl = jest.fn(async () => new Response('nope', { status: 404 }))
    expect(await downloadWithSizeCap('file:///etc/passwd', { timeoutMs: 1000, maxBytes: 100, fetchImpl })).toEqual({ kind: 'transient', code: 'invalid_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await downloadWithSizeCap('https://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl })).toEqual({ kind: 'http', status: 404 })
  })

  it('refuses http: download URLs unless the Resend stub allows them', async () => {
    const fetchImpl = jest.fn(async () => new Response(streamOf([10]), { status: 200 }))
    expect(await downloadWithSizeCap('http://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl })).toEqual({ kind: 'transient', code: 'invalid_url' })
    expect(await downloadWithSizeCap('http://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl, allowHttp: false })).toEqual({ kind: 'transient', code: 'invalid_url' })
    expect(fetchImpl).not.toHaveBeenCalled()
    const allowed = await downloadWithSizeCap('http://localhost:3000/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl, allowHttp: true })
    expect(allowed.kind).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await downloadWithSizeCap('ftp://files.example.test/a', { timeoutMs: 1000, maxBytes: 100, fetchImpl, allowHttp: true })).toEqual({ kind: 'transient', code: 'invalid_url' })
  })

  it('times out the whole transfer', async () => {
    const fetchImpl = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    expect(await downloadWithSizeCap('https://files.example.test/a', { timeoutMs: 20, maxBytes: 100, fetchImpl })).toEqual({ kind: 'transient', code: 'timeout' })
  })
})

describe('acquireInboundPartBytes', () => {
  it('refreshes once after a 404 from the download URL, then gives up transiently', async () => {
    const api = { list: jest.fn(), get: jest.fn(async () => ({ data: descriptor('a'), error: null })) }
    const fetchImpl = jest.fn(async () => new Response('expired', { status: 404 }))
    const result = await acquireInboundPartBytes({
      api: api as unknown as ResendInboundAttachmentsApi,
      providerEmailId: 'e',
      providerAttachmentId: 'a',
      listed: descriptor('a'),
      timeoutMs: 1000,
      maxBytes: 100,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toEqual({ kind: 'transient', code: 'download_http_404' })
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not refresh after a 5xx from the download URL', async () => {
    const api = { list: jest.fn(), get: jest.fn() }
    const fetchImpl = jest.fn(async () => new Response('down', { status: 502 }))
    const result = await acquireInboundPartBytes({
      api: api as unknown as ResendInboundAttachmentsApi,
      providerEmailId: 'e',
      providerAttachmentId: 'a',
      listed: descriptor('a'),
      timeoutMs: 1000,
      maxBytes: 100,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toEqual({ kind: 'transient', code: 'download_http_502' })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('maps a 404 from get to a permanent not_found', async () => {
    const api = { list: jest.fn(), get: jest.fn(async () => ({ data: null, error: { statusCode: 404, name: 'not_found', message: '' } })) }
    const result = await acquireInboundPartBytes({
      api: api as unknown as ResendInboundAttachmentsApi,
      providerEmailId: 'e',
      providerAttachmentId: 'a',
      timeoutMs: 1000,
      maxBytes: 100,
      fetchImpl: jest.fn(),
      now: () => NOW,
    })
    expect(result).toEqual({ kind: 'not_found' })
  })
})
