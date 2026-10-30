import { buildEnvelope, createGusClient, escapeXml, GusTransportError, type GusRequest } from '../lib/client'
import { GUS_TEST_URL } from '../lib/config'
import { LOGIN_EMPTY, LOGIN_OK, LOGOUT_OK, SEARCH_FOUND_INNER, searchResponse } from './fixtures/bir'

type Call = { url: string; init: RequestInit & { timeoutMs?: number } }

function mockRequest(responses: Array<{ status?: number; body: string } | Error>) {
  const calls: Call[] = []
  const request: GusRequest = async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return new Response(next.body, { status: next.status ?? 200 })
  }
  return { request, calls }
}

const config = { environment: 'test' as const, baseUrl: GUS_TEST_URL, apiKey: 'abcde12345abcde12345' }

describe('buildEnvelope', () => {
  it('builds a SOAP 1.2 envelope with WS-Addressing headers', () => {
    const xml = buildEnvelope(GUS_TEST_URL, 'Zaloguj', '<x/>')
    expect(xml).toContain('xmlns:soap="http://www.w3.org/2003/05/soap-envelope"')
    expect(xml).toContain(`<wsa:To>${GUS_TEST_URL}</wsa:To>`)
    expect(xml).toContain('<wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action>')
    expect(xml).toContain('<soap:Body><x/></soap:Body>')
  })
})

describe('escapeXml', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;')
  })
})

describe('createGusClient', () => {
  it('logs in with the API key and returns the session id', async () => {
    const { request, calls } = mockRequest([{ body: LOGIN_OK }])
    const sid = await createGusClient(config, request).login()
    expect(sid).toBe('p0o9i8u7y6t5r4e3w2q1')
    expect(calls[0].url).toBe(GUS_TEST_URL)
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/soap+xml; charset=utf-8')
    expect((calls[0].init.headers as Record<string, string>).sid).toBeUndefined()
    expect(String(calls[0].init.body)).toContain('<pKluczUzytkownika>abcde12345abcde12345</pKluczUzytkownika>')
    expect(calls[0].init.timeoutMs).toBeGreaterThan(0)
  })

  it('fails when GUS returns no session id (invalid key)', async () => {
    const { request } = mockRequest([{ body: LOGIN_EMPTY }])
    await expect(createGusClient(config, request).login()).rejects.toThrow(GusTransportError)
  })

  it('sends the session id as a plain HTTP header when searching', async () => {
    const { request, calls } = mockRequest([{ body: searchResponse(SEARCH_FOUND_INNER) }])
    const inner = await createGusClient(config, request).searchByNip('SID123', '5252344078')
    expect(inner).toContain('<Regon>140182840</Regon>')
    expect((calls[0].init.headers as Record<string, string>).sid).toBe('SID123')
    expect(String(calls[0].init.body)).toContain('<dat:Nip>5252344078</dat:Nip>')
    expect(String(calls[0].init.body)).toContain('IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action>')
  })

  it('logs out with the session id', async () => {
    const { request, calls } = mockRequest([{ body: LOGOUT_OK }])
    await createGusClient(config, request).logout('SID123')
    expect(String(calls[0].init.body)).toContain('<pIdentyfikatorSesji>SID123</pIdentyfikatorSesji>')
  })

  it('times out and cancels the body stream when headers arrive but the body stalls', async () => {
    jest.useFakeTimers()
    try {
      const cancel = jest.fn()
      const stalledBody = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('<soap:Envelope>'))
        },
        cancel,
      })
      const request: GusRequest = async () => new Response(stalledBody, { status: 200 })
      const pending = createGusClient(config, request).login()
      const assertion = expect(pending).rejects.toThrow(/timed out/)
      await jest.advanceTimersByTimeAsync(10_000)
      await assertion
      expect(cancel).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('decodes a body split across chunks', async () => {
    const encoded = new TextEncoder().encode(searchResponse(SEARCH_FOUND_INNER))
    const middle = Math.floor(encoded.length / 2)
    const chunkedBody = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoded.slice(0, middle))
        streamController.enqueue(encoded.slice(middle))
        streamController.close()
      },
    })
    const request: GusRequest = async () => new Response(chunkedBody, { status: 200 })
    const whole = mockRequest([{ body: searchResponse(SEARCH_FOUND_INNER) }])
    const expected = await createGusClient(config, whole.request).searchByNip('SID123', '5252344078')
    await expect(createGusClient(config, request).searchByNip('SID123', '5252344078')).resolves.toBe(expected)
  })

  it('times out when the request itself never settles', async () => {
    jest.useFakeTimers()
    try {
      const request: GusRequest = () => new Promise<Response>(() => undefined)
      const pending = createGusClient(config, request).login()
      const assertion = expect(pending).rejects.toThrow(/timed out/)
      await jest.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      jest.useRealTimers()
    }
  })

  it('passes an abort signal to the request', async () => {
    const { request, calls } = mockRequest([{ body: LOGIN_OK }])
    await createGusClient(config, request).login()
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('wraps HTTP errors and network failures in GusTransportError', async () => {
    const http = mockRequest([{ status: 503, body: 'Service Unavailable' }])
    await expect(createGusClient(config, http.request).login()).rejects.toThrow(/HTTP 503/)

    const network = mockRequest([new Error('ECONNRESET')])
    await expect(createGusClient(config, network.request).login()).rejects.toThrow(/ECONNRESET/)
  })
})
