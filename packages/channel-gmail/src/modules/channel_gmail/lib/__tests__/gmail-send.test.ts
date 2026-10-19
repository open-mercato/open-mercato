import { FetchTimeoutError } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import {
  encodeBase64Url,
  getGmailApiClient,
  GMAIL_SIMPLE_SEND_MAX_RAW_CHARS,
  GmailApiError,
  setGmailApiClient,
} from '../gmail-client'

type FetchCall = { url: string; init: RequestInit }

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response
}

describe('FetchGmailApiClient.sendRawMessage', () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  let calls: FetchCall[]

  function stubFetch(responder: (call: FetchCall, index: number) => Response | Promise<Response>) {
    globalThis.fetch = ((url: string | URL, init: RequestInit) => {
      const call = { url: String(url), init }
      calls.push(call)
      return Promise.resolve(responder(call, calls.length - 1))
    }) as unknown as typeof globalThis.fetch
  }

  beforeEach(() => {
    setGmailApiClient(null)
    calls = []
    globalThis.setTimeout = ((callback: () => void, ms?: number) => {
      if (ms === 30_000) return originalSetTimeout(callback, ms)
      callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof globalThis.setTimeout
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    setGmailApiClient(null)
  })

  it('uses the simple JSON endpoint for a small message', async () => {
    stubFetch(() => jsonResponse(200, { id: 'm1', threadId: 't1' }))
    const rawBase64Url = encodeBase64Url(Buffer.from('Subject: hi\r\n\r\nbody'))

    const response = await getGmailApiClient().sendRawMessage({ accessToken: 'token' }, { rawBase64Url, threadId: 't1' })

    expect(response.id).toBe('m1')
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ raw: rawBase64Url, threadId: 't1' })
  })

  it('uploads a large message as multipart/related with the thread id and the raw RFC 822 bytes', async () => {
    stubFetch(() => jsonResponse(200, { id: 'm2', threadId: 't2' }))
    const raw = Buffer.concat([Buffer.from('Subject: big\r\n\r\n'), Buffer.alloc(GMAIL_SIMPLE_SEND_MAX_RAW_CHARS, 0x41)])

    await getGmailApiClient().sendRawMessage({ accessToken: 'token' }, { rawBase64Url: encodeBase64Url(raw), threadId: 't2' })

    expect(calls[0].url).toBe('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart')
    const headers = calls[0].init.headers as Record<string, string>
    const boundary = /^multipart\/related; boundary=(.+)$/.exec(headers['Content-Type'])?.[1]
    expect(boundary).toBeTruthy()
    const body = Buffer.from(calls[0].init.body as Uint8Array)
    const text = body.toString('latin1')
    expect(text.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"threadId":"t2"}\r\n`)).toBe(true)
    const rawStart = text.indexOf('Content-Type: message/rfc822\r\n\r\n') + 'Content-Type: message/rfc822\r\n\r\n'.length
    const rawEnd = text.lastIndexOf(`\r\n--${boundary}--`)
    expect(body.subarray(rawStart, rawEnd).equals(raw)).toBe(true)
  })

  it('does not retry the send after a 5xx, which may follow an accepted message', async () => {
    stubFetch(() => jsonResponse(503, { error: { message: 'backend error' } }))

    const error = await getGmailApiClient()
      .sendRawMessage({ accessToken: 'token' }, { rawBase64Url: encodeBase64Url(Buffer.from('x')) })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(GmailApiError)
    expect((error as GmailApiError).status).toBe(503)
    expect(calls).toHaveLength(1)
  })

  it('does not retry the send after a timeout', async () => {
    globalThis.fetch = ((url: string | URL) => {
      calls.push({ url: String(url), init: {} })
      return Promise.reject(new FetchTimeoutError(String(url), 30_000))
    }) as unknown as typeof globalThis.fetch

    const error = await getGmailApiClient()
      .sendRawMessage({ accessToken: 'token' }, { rawBase64Url: encodeBase64Url(Buffer.from('x')) })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(GmailApiError)
    expect(calls).toHaveLength(1)
  })

  it('retries a 429, which Gmail returns before accepting the message', async () => {
    stubFetch((_call, index) => (index === 0 ? jsonResponse(429, '') : jsonResponse(200, { id: 'm3', threadId: 't3' })))

    const response = await getGmailApiClient().sendRawMessage(
      { accessToken: 'token' },
      { rawBase64Url: encodeBase64Url(Buffer.from('x')) },
    )

    expect(response.id).toBe('m3')
    expect(calls).toHaveLength(2)
  })

  it('reports an oversized message as message_too_large', async () => {
    stubFetch(() => jsonResponse(413, { error: { message: 'Request Entity Too Large' } }))

    const error = await getGmailApiClient()
      .sendRawMessage({ accessToken: 'token' }, { rawBase64Url: encodeBase64Url(Buffer.from('x')) })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(GmailApiError)
    expect((error as GmailApiError).detail).toBe('message_too_large')
    expect((error as GmailApiError).message).toContain('message_too_large')
  })
})
