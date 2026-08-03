/** @jest-environment node */
import {
  DEFAULT_WEBHOOK_BODY_LIMIT_BYTES,
  readBoundedRequestBody,
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
