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
  let requestTimeouts: number[]

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
    requestTimeouts = []
    globalThis.setTimeout = ((callback: () => void, ms?: number) => {
      if (ms !== undefined && ms > 8_000) {
        requestTimeouts.push(ms)
        return originalSetTimeout(callback, ms)
      }
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

  it('uploads the message bytes it is given instead of decoding the base64url copy', async () => {
    stubFetch(() => jsonResponse(200, { id: 'm5', threadId: 't5' }))
    const rawMessage = Buffer.concat([Buffer.from('Subject: bytes\r\n\r\n'), Buffer.alloc(GMAIL_SIMPLE_SEND_MAX_RAW_CHARS, 0x42)])
    const decoyBase64Url = encodeBase64Url(Buffer.alloc(rawMessage.byteLength, 0x43))

    await getGmailApiClient().sendRawMessage({ accessToken: 'token' }, { rawBase64Url: decoyBase64Url, rawMessage })

    const headers = calls[0].init.headers as Record<string, string>
    const boundary = /^multipart\/related; boundary=(.+)$/.exec(headers['Content-Type'])?.[1]
    const body = Buffer.from(calls[0].init.body as Uint8Array)
    const text = body.toString('latin1')
    const rawStart = text.indexOf('Content-Type: message/rfc822\r\n\r\n') + 'Content-Type: message/rfc822\r\n\r\n'.length
    const rawEnd = text.lastIndexOf(`\r\n--${boundary}--`)
    expect(body.subarray(rawStart, rawEnd).equals(rawMessage)).toBe(true)
  })

  it('gives a media upload more time than a simple send', async () => {
    stubFetch(() => jsonResponse(200, { id: 'm4', threadId: 't4' }))
    const client = getGmailApiClient()
    await client.sendRawMessage({ accessToken: 'token' }, { rawBase64Url: encodeBase64Url(Buffer.from('x')) })
    const large = Buffer.alloc(GMAIL_SIMPLE_SEND_MAX_RAW_CHARS, 0x41)
    await client.sendRawMessage({ accessToken: 'token' }, { rawBase64Url: encodeBase64Url(large) })

    expect(calls[1].url).toContain('/upload/')
    expect(requestTimeouts).toHaveLength(2)
    expect(requestTimeouts[1]).toBeGreaterThan(requestTimeouts[0])
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
