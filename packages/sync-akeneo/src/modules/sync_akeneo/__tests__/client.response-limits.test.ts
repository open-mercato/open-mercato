import { createAkeneoClient, type AkeneoClientDeps } from '../lib/client'

const validCredentials = {
  apiUrl: 'https://tenant.cloud.akeneo.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'api-user',
  password: 'api-password',
}

const publicAkeneoLookupHost: AkeneoClientDeps['lookupHost'] = async () => [{ address: '93.184.216.34', family: 4 }]

const MIB = 1024 * 1024
const DEFAULT_MEDIA_MAX_BYTES = 25 * MIB
const OVERSIZED_MEDIA_BYTES = 26 * MIB
const STREAMED_OVERSIZED_MEDIA_BYTES = 40 * MIB
const DOWNLOAD_PATH = '/api/rest/v1/media-files/asset-1/download'
const DOWNLOAD_URL = `https://tenant.cloud.akeneo.com${DOWNLOAD_PATH}`
const TOKEN_PATH = '/api/oauth/v1/token'
const PRODUCTS_PATH = '/api/rest/v1/products-uuid'
const ENV_KEYS = [
  'OM_INTEGRATION_AKENEO_REQUEST_TIMEOUT_MS',
  'OM_INTEGRATION_AKENEO_MAX_RESPONSE_BYTES',
  'OM_ATTACHMENT_MAX_UPLOAD_MB',
] as const

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: 'token-123', expires_in: 3600 })
}

function meteredBody(totalBytes: number, chunkBytes = MIB, fill = 0) {
  const meter = { pulledBytes: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (meter.pulledBytes >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunkBytes, totalBytes - meter.pulledBytes)
      meter.pulledBytes += size
      controller.enqueue(new Uint8Array(size).fill(fill))
    },
    cancel() {
      meter.cancelled = true
    },
  }, { highWaterMark: 0 })
  return { stream, meter }
}

function stalledBody(prefix: Uint8Array = new Uint8Array(16)) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix)
    },
    pull() {
      return new Promise<void>(() => undefined)
    },
  }, { highWaterMark: 0 })
}

function jsonPayloadOfSize(totalBytes: number): string {
  const skeleton = JSON.stringify({ items_count: 0, padding: '' })
  return JSON.stringify({ items_count: 0, padding: 'x'.repeat(totalBytes - skeleton.length) })
}

function createClientServing(routes: Record<string, () => Response>) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === TOKEN_PATH && !routes[TOKEN_PATH]) return tokenResponse()
    const route = routes[url.pathname]
    if (route) return route()
    return new Response('unexpected', { status: 500 })
  })
  const client = createAkeneoClient(validCredentials, {
    lookupHost: publicAkeneoLookupHost,
    fetchImpl: fetchMock as unknown as typeof fetch,
  })
  return { client, fetchMock }
}

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<'resolved' | 'timed-out' | 'rejected' | 'still-reading'> {
  return Promise.race([
    promise.then(
      () => 'resolved' as const,
      (error: unknown) => (error instanceof Error && error.name === 'FetchTimeoutError' ? 'timed-out' as const : 'rejected' as const),
    ),
    new Promise<'still-reading'>((resolve) => setTimeout(() => resolve('still-reading'), ms).unref()),
  ])
}

describe('akeneo client response limits (issues #7233, #7242)', () => {
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('media downloads (#7233)', () => {
    it('accepts a chunked media body below the cap and reports its real byte length', async () => {
      const { stream } = meteredBody(3 * MIB)
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } }),
      })

      const binary = await client.downloadMediaFile(DOWNLOAD_URL)

      expect(binary.buffer.byteLength).toBe(3 * MIB)
      expect(binary.contentLength).toBe(3 * MIB)
      expect(binary.contentType).toBe('image/png')
    })

    it('accepts a media body of exactly the attachment upload limit', async () => {
      const { stream } = meteredBody(DEFAULT_MEDIA_MAX_BYTES)
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } }),
      })

      const binary = await client.downloadMediaFile(DOWNLOAD_URL)

      expect(binary.buffer.byteLength).toBe(DEFAULT_MEDIA_MAX_BYTES)
    })

    it('aborts a chunked media body without Content-Length once it passes the cap, without buffering the rest', async () => {
      const { stream, meter } = meteredBody(STREAMED_OVERSIZED_MEDIA_BYTES)
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } }),
      })

      await expect(client.downloadMediaFile(DOWNLOAD_URL)).rejects.toMatchObject({
        name: 'AkeneoResponseTooLargeError',
        limitBytes: DEFAULT_MEDIA_MAX_BYTES,
      })

      expect(meter.pulledBytes).toBeLessThanOrEqual(DEFAULT_MEDIA_MAX_BYTES + MIB)
      expect(meter.pulledBytes).toBeLessThan(STREAMED_OVERSIZED_MEDIA_BYTES)
      expect(meter.cancelled).toBe(true)
    })

    it('rejects a declared Content-Length above the cap before reading the body', async () => {
      const { stream, meter } = meteredBody(OVERSIZED_MEDIA_BYTES)
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(stream, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(OVERSIZED_MEDIA_BYTES) },
        }),
      })

      await expect(client.downloadMediaFile(DOWNLOAD_URL)).rejects.toMatchObject({ name: 'AkeneoResponseTooLargeError' })

      expect(meter.pulledBytes).toBeLessThanOrEqual(MIB)
    })

    it('follows OM_ATTACHMENT_MAX_UPLOAD_MB for the media cap', async () => {
      process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '1'
      const { stream, meter } = meteredBody(3 * MIB, 256 * 1024)
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } }),
      })

      await expect(client.downloadMediaFile(DOWNLOAD_URL)).rejects.toMatchObject({ limitBytes: MIB })

      expect(meter.pulledBytes).toBeLessThanOrEqual(MIB + 256 * 1024)
    })

    it('reports the bytes actually received, not a misleading Content-Length header', async () => {
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(new Uint8Array(5), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '1' },
        }),
      })

      const binary = await client.downloadMediaFile(DOWNLOAD_URL)

      expect(binary.buffer.byteLength).toBe(5)
      expect(binary.contentLength).toBe(5)
    })

    it('keeps the request deadline running while the media body is consumed', async () => {
      process.env.OM_INTEGRATION_AKENEO_REQUEST_TIMEOUT_MS = '100'
      const { client } = createClientServing({
        [DOWNLOAD_PATH]: () => new Response(stalledBody(), { status: 200, headers: { 'content-type': 'image/png' } }),
      })

      await expect(settleWithin(client.downloadMediaFile(DOWNLOAD_URL), 1_500)).resolves.toBe('timed-out')
    })
  })

  describe('JSON and error bodies (#7242)', () => {
    it('reads an ordinary multi-page product listing', async () => {
      const { client, fetchMock } = createClientServing({
        [PRODUCTS_PATH]: () => {
          const pageCalls = fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === PRODUCTS_PATH)
          const isSecondPage = new URL(String(pageCalls[pageCalls.length - 1]?.[0])).searchParams.get('page') === '2'
          return jsonResponse({
            _embedded: { items: [{ uuid: isSecondPage ? 'uuid-2' : 'uuid-1' }] },
            _links: isSecondPage ? {} : { next: { href: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2` } },
          })
        },
      })

      const first = await client.listProducts({ batchSize: 1 })
      const second = await client.listProducts({ batchSize: 1, nextUrl: first.nextUrl })

      expect(first.items.map((item) => item.uuid)).toEqual(['uuid-1'])
      expect(first.nextUrl).toBe(`https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2`)
      expect(second.items.map((item) => item.uuid)).toEqual(['uuid-2'])
      expect(second.nextUrl).toBeNull()
    })

    it('accepts a JSON body of exactly the configured response limit', async () => {
      process.env.OM_INTEGRATION_AKENEO_MAX_RESPONSE_BYTES = String(64 * 1024)
      const payload = jsonPayloadOfSize(64 * 1024)
      const { client } = createClientServing({
        '/api/rest/v1/system-information': () => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }),
      })

      expect(Buffer.byteLength(payload)).toBe(64 * 1024)
      await expect(client.getSystemProbe()).resolves.toEqual({ version: null })
    })

    it('aborts a chunked JSON body without Content-Length once it passes the configured limit', async () => {
      process.env.OM_INTEGRATION_AKENEO_MAX_RESPONSE_BYTES = String(MIB)
      const { stream, meter } = meteredBody(8 * MIB, 256 * 1024, 0x20)
      const { client } = createClientServing({
        [PRODUCTS_PATH]: () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
      })

      await expect(client.listProducts({ batchSize: 10, nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2` }))
        .rejects.toMatchObject({ name: 'AkeneoResponseTooLargeError', limitBytes: MIB })

      expect(meter.pulledBytes).toBeLessThanOrEqual(MIB + 256 * 1024)
      expect(meter.cancelled).toBe(true)
    })

    it('rejects a JSON body whose declared Content-Length is above the limit before reading it', async () => {
      process.env.OM_INTEGRATION_AKENEO_MAX_RESPONSE_BYTES = String(MIB)
      const { stream, meter } = meteredBody(8 * MIB, 256 * 1024, 0x20)
      const { client } = createClientServing({
        [PRODUCTS_PATH]: () => new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': String(8 * MIB) },
        }),
      })

      await expect(client.listProducts({ batchSize: 10, nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2` }))
        .rejects.toMatchObject({ name: 'AkeneoResponseTooLargeError' })

      expect(meter.pulledBytes).toBe(0)
    })

    it('bounds the OAuth token response body', async () => {
      process.env.OM_INTEGRATION_AKENEO_MAX_RESPONSE_BYTES = String(MIB)
      const { stream, meter } = meteredBody(8 * MIB, 256 * 1024, 0x20)
      const { client } = createClientServing({
        [TOKEN_PATH]: () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
      })

      await expect(client.listProducts({ batchSize: 10, nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2` }))
        .rejects.toMatchObject({ name: 'AkeneoResponseTooLargeError' })

      expect(meter.pulledBytes).toBeLessThanOrEqual(MIB + 256 * 1024)
    })

    it('keeps the request deadline running while a JSON page drips', async () => {
      process.env.OM_INTEGRATION_AKENEO_REQUEST_TIMEOUT_MS = '100'
      const { client } = createClientServing({
        [PRODUCTS_PATH]: () => new Response(stalledBody(new TextEncoder().encode('{"_embedded":{"items":[')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      })

      const outcome = await settleWithin(
        client.listProducts({ batchSize: 10, nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2` }),
        1_500,
      )

      expect(outcome).toBe('timed-out')
    })

    it('keeps the request deadline running while the OAuth token body drips', async () => {
      process.env.OM_INTEGRATION_AKENEO_REQUEST_TIMEOUT_MS = '100'
      const { client } = createClientServing({
        [TOKEN_PATH]: () => new Response(stalledBody(new TextEncoder().encode('{"access_token":')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      })

      const outcome = await settleWithin(
        client.listProducts({ batchSize: 10, nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2` }),
        1_500,
      )

      expect(outcome).toBe('timed-out')
    })

    it('truncates a huge error body instead of buffering all of it', async () => {
      const { stream, meter } = meteredBody(8 * MIB, 256 * 1024, 0x61)
      const { client } = createClientServing({
        [PRODUCTS_PATH]: () => new Response(stream, { status: 500, headers: { 'content-type': 'text/plain' } }),
      })

      const error = await client.listProducts({
        batchSize: 10,
        nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2`,
      }).catch((err: unknown) => err as Error)

      expect(error).toBeInstanceOf(Error)
      expect(error.message.startsWith('Akeneo request failed (500): aaaa')).toBe(true)
      expect(error.message.length).toBeLessThanOrEqual(64 * 1024 + 64)
      expect(meter.pulledBytes).toBeLessThanOrEqual(64 * 1024 + 256 * 1024)
    })

    it('keeps short error bodies intact in the thrown message', async () => {
      const { client } = createClientServing({
        [PRODUCTS_PATH]: () => new Response('{"message":"Forbidden"}', { status: 403 }),
      })

      await expect(client.listProducts({
        batchSize: 10,
        nextUrl: `https://tenant.cloud.akeneo.com${PRODUCTS_PATH}?page=2`,
      })).rejects.toThrow('Akeneo request failed (403): {"message":"Forbidden"}')
    })
  })
})
