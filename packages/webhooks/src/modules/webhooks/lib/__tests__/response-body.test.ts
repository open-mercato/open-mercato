import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readWebhookResponseBody, WEBHOOK_RESPONSE_BODY_LIMIT_BYTES } from '../response-body'

const encoder = new TextEncoder()

function streamOf(chunks: Uint8Array[], onCancel: () => void = () => undefined) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[index])
      index += 1
    },
    cancel() {
      onCancel()
    },
  }, { highWaterMark: 0 })
}

async function startServer(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/` }
}

async function stopServer(server: http.Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

describe('readWebhookResponseBody', () => {
  it('returns an empty string when the response has no body', async () => {
    const text = await readWebhookResponseBody(new Response(null, { status: 204 }), {
      maxBytes: WEBHOOK_RESPONSE_BODY_LIMIT_BYTES,
      signal: new AbortController().signal,
    })
    expect(text).toBe('')
  })

  it('returns an empty string and cancels the body when the signal is already aborted', async () => {
    let cancelled = false
    const controller = new AbortController()
    controller.abort()
    const text = await readWebhookResponseBody(
      new Response(streamOf([encoder.encode('ignored')], () => { cancelled = true })),
      { maxBytes: WEBHOOK_RESPONSE_BODY_LIMIT_BYTES, signal: controller.signal },
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(text).toBe('')
    expect(cancelled).toBe(true)
  })

  it('stops exactly at the cap when it falls on a chunk boundary and cancels the rest', async () => {
    let cancelled = false
    const chunks = [encoder.encode('abcd'), encoder.encode('efgh'), encoder.encode('ijkl')]
    const text = await readWebhookResponseBody(
      new Response(streamOf(chunks, () => { cancelled = true })),
      { maxBytes: 8, signal: new AbortController().signal },
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(text).toBe('abcdefgh')
    expect(cancelled).toBe(true)
  })

  it('returns the whole body when it ends before the cap', async () => {
    const text = await readWebhookResponseBody(new Response('hello'), {
      maxBytes: WEBHOOK_RESPONSE_BODY_LIMIT_BYTES,
      signal: new AbortController().signal,
    })
    expect(text).toBe('hello')
  })

  it('drops a multi-byte character split by the cap instead of emitting a replacement character', async () => {
    const text = await readWebhookResponseBody(new Response('aéé'), {
      maxBytes: 4,
      signal: new AbortController().signal,
    })
    expect(text).toBe('aé')
  })

  it('rejects when the stream errors for a reason other than the abort signal', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial'))
      },
      pull(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    await expect(readWebhookResponseBody(new Response(failing), {
      maxBytes: WEBHOOK_RESPONSE_BODY_LIMIT_BYTES,
      signal: new AbortController().signal,
    })).rejects.toThrow('connection reset')
  })

  it('returns the partial body by the deadline when a real receiver stalls after its headers', async () => {
    const { server, url } = await startServer((req, res) => {
      req.resume()
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('partial')
    })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300)
    try {
      const startedAt = Date.now()
      const response = await fetch(url, { signal: controller.signal })
      const text = await readWebhookResponseBody(response, {
        maxBytes: WEBHOOK_RESPONSE_BODY_LIMIT_BYTES,
        signal: controller.signal,
      })
      expect(text).toBe('partial')
      expect(Date.now() - startedAt).toBeLessThan(1300)
    } finally {
      clearTimeout(timeoutId)
      await stopServer(server)
    }
  })

  it('reads only the capped prefix of a large real response and closes the connection early', async () => {
    const totalBytes = 64 * 1024 * 1024
    const chunk = Buffer.alloc(64 * 1024, 'x')
    let bytesWritten = 0
    let completed = false
    let markClosed: () => void = () => undefined
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve
    })
    const { server, url } = await startServer((req, res) => {
      req.resume()
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.on('close', () => markClosed())
      const writeMore = () => {
        while (bytesWritten < totalBytes) {
          bytesWritten += chunk.length
          if (!res.write(chunk)) {
            res.once('drain', writeMore)
            return
          }
        }
        completed = true
        res.end()
      }
      writeMore()
    })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      const text = await readWebhookResponseBody(response, {
        maxBytes: WEBHOOK_RESPONSE_BODY_LIMIT_BYTES,
        signal: controller.signal,
      })
      expect(Buffer.byteLength(text, 'utf8')).toBe(WEBHOOK_RESPONSE_BODY_LIMIT_BYTES)
      await closed
      expect(completed).toBe(false)
      expect(bytesWritten).toBeLessThan(totalBytes)
    } finally {
      clearTimeout(timeoutId)
      await stopServer(server)
    }
  })
})
