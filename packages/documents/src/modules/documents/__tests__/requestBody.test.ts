import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  DOCUMENTS_REQUEST_BODY_TOO_LARGE,
  readBoundedJsonBody,
} from '../lib/requestBody'

function streamRequest(chunks: string[], onCancel?: () => void): Request {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      if (chunk === undefined) {
        controller.close()
        return
      }
      index += 1
      controller.enqueue(encoder.encode(chunk))
    },
    cancel() {
      onCancel?.()
    },
  })
  return new Request('http://localhost/api/documents/test', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

describe('bounded Documents JSON request bodies', () => {
  it('parses a streamed object below the byte limit', async () => {
    const request = streamRequest(['{"title":', '"Quarterly plan"}'])

    await expect(readBoundedJsonBody(request, 128)).resolves.toEqual({
      title: 'Quarterly plan',
    })
  })

  it('rejects and cancels a chunked body without Content-Length at the limit', async () => {
    let cancelled = false
    const request = streamRequest(['{"body":"', '0123456789', '"}'], () => { cancelled = true })

    let thrown: unknown
    try {
      await readBoundedJsonBody(request, 12)
    } catch (error) {
      thrown = error
    }

    expect(isCrudHttpError(thrown)).toBe(true)
    if (isCrudHttpError(thrown)) {
      expect(thrown.status).toBe(413)
      expect(thrown.body.error).toBe(DOCUMENTS_REQUEST_BODY_TOO_LARGE)
    }
    expect(cancelled).toBe(true)
  })

  it('rejects an oversized declared Content-Length before consuming the body', async () => {
    const request = new Request('http://localhost/api/documents/test', {
      method: 'POST',
      headers: { 'content-length': '129' },
      body: '{}',
    })

    await expect(readBoundedJsonBody(request, 128)).rejects.toMatchObject({
      status: 413,
      body: { error: DOCUMENTS_REQUEST_BODY_TOO_LARGE },
    })
  })

  it('preserves the previous fallback behavior for malformed JSON', async () => {
    const request = streamRequest(['not-json'])

    await expect(readBoundedJsonBody(request, 128, {})).resolves.toEqual({})
  })
})
