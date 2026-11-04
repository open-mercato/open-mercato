/** @jest-environment node */
import {
  DEFAULT_WEBHOOK_BODY_LIMIT_BYTES,
  readBoundedRequestBody,
  readBoundedRequestBytes,
  resolveWebhookBodyLimitBytes,
  WebhookBodyTooLargeError,
} from '../body'

function makeStreamingRequest(chunks: Uint8Array[], headers?: HeadersInit) {
  let index = 0
  const cancel = jest.fn()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel,
  })
  const request = new Request('http://localhost/webhook', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  return { request, cancel }
}

describe('readBoundedRequestBody', () => {
  const encoder = new TextEncoder()

  it('rejects an oversized declared length before reading the body', async () => {
    const request = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-length': '6' },
      body: 'ok',
    })

    await expect(readBoundedRequestBody(request, { maxBytes: 5 })).rejects.toEqual(
      expect.objectContaining<WebhookBodyTooLargeError>({ limitBytes: 5 }),
    )
  })

  it('stops a chunked body when its actual byte count crosses the limit', async () => {
    const { request, cancel } = makeStreamingRequest([
      encoder.encode('abc'),
      encoder.encode('def'),
      encoder.encode('never-read'),
    ])

    await expect(readBoundedRequestBody(request, { maxBytes: 5 })).rejects.toBeInstanceOf(
      WebhookBodyTooLargeError,
    )
    expect(cancel).toHaveBeenCalled()
  })

  it.each([
    ['invalid', 'not-a-number'],
    ['lying', '3'],
  ])('does not let a %s Content-Length bypass the streamed cap', async (_case, contentLength) => {
    const { request } = makeStreamingRequest(
      [encoder.encode('abc'), encoder.encode('def')],
      { 'content-length': contentLength },
    )

    await expect(readBoundedRequestBody(request, { maxBytes: 5 })).rejects.toBeInstanceOf(
      WebhookBodyTooLargeError,
    )
  })

  it('preserves the exact decoded body at the byte boundary', async () => {
    const bytes = encoder.encode('a€')
    const { request } = makeStreamingRequest([bytes.slice(0, 2), bytes.slice(2)])

    await expect(readBoundedRequestBody(request, { maxBytes: bytes.byteLength })).resolves.toBe('a€')
  })
})

describe('readBoundedRequestBytes', () => {
  it('preserves exact bytes including invalid UTF-8', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0xc3, 0x28])
    const { request } = makeStreamingRequest([bytes.slice(0, 2), bytes.slice(2)])

    const result = await readBoundedRequestBytes(request, { maxBytes: bytes.byteLength })

    expect(Array.from(result)).toEqual(Array.from(bytes))
    expect(new TextDecoder().decode(result)).toContain('\uFFFD')
  })

  it('returns an empty array for a missing body', async () => {
    const request = new Request('http://localhost/webhook', { method: 'POST' })

    expect((await readBoundedRequestBytes(request)).byteLength).toBe(0)
    await expect(readBoundedRequestBody(request)).resolves.toBe('')
  })

  it('enforces the declared and streamed limits and cancels the stream', async () => {
    const declared = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-length': '6' },
      body: 'ok',
    })
    await expect(readBoundedRequestBytes(declared, { maxBytes: 5 })).rejects.toBeInstanceOf(
      WebhookBodyTooLargeError,
    )

    const { request, cancel } = makeStreamingRequest([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ])
    await expect(readBoundedRequestBytes(request, { maxBytes: 5 })).rejects.toBeInstanceOf(
      WebhookBodyTooLargeError,
    )
    expect(cancel).toHaveBeenCalled()
  })

  it('keeps the string reader decoding the same bytes', async () => {
    const bytes = new TextEncoder().encode('zażółć')
    const { request } = makeStreamingRequest([bytes])

    await expect(readBoundedRequestBody(request)).resolves.toBe('zażółć')
  })
})

describe('resolveWebhookBodyLimitBytes', () => {
  it('uses the documented default for missing or invalid configuration', () => {
    expect(resolveWebhookBodyLimitBytes(undefined)).toBe(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES)
    expect(resolveWebhookBodyLimitBytes('invalid')).toBe(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES)
    expect(resolveWebhookBodyLimitBytes('0')).toBe(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES)
  })

  it('accepts a positive safe integer override', () => {
    expect(resolveWebhookBodyLimitBytes('2097152')).toBe(2 * 1024 * 1024)
  })

  it('supports a source-specific fallback without weakening validation', () => {
    expect(resolveWebhookBodyLimitBytes(undefined, 2 * 1024 * 1024)).toBe(2 * 1024 * 1024)
    expect(resolveWebhookBodyLimitBytes('invalid', 2 * 1024 * 1024)).toBe(2 * 1024 * 1024)
  })
})
