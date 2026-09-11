import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isWebResearchError } from '../../contract/errors'
import { createHttpClient } from '../client'

/**
 * Real sockets, not a stubbed transport.
 *
 * The behaviour worth pinning here lives below `fetch`: redirect re-vetting,
 * what happens to a caller's credentials on a hop, and whether a stalled body
 * read can ever be interrupted. A double of the transport would assert the
 * double. The SSRF guard blocks loopback by design, so these tests use the
 * `allowPrivateHosts` allowlist to name the one host they serve from.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const LOOPBACK = ['127.0.0.1']

function listen(handler: Handler): Promise<{ server: Server; origin: string; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, origin: `http://127.0.0.1:${port}`, port })
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

const client = (overrides = {}) => createHttpClient({ allowPrivateHosts: LOOPBACK, ...overrides })

describe('http client against a real server', () => {
  const servers: Server[] = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close))
  })
  const track = <T extends { server: Server }>(started: T): T => {
    servers.push(started.server)
    return started
  }

  it('refuses a private host that is not on the allowlist', async () => {
    const { origin } = track(await listen((_req, res) => res.end('ok')))

    await expect(createHttpClient().request(origin)).rejects.toMatchObject({ code: 'ssrf_blocked' })
  })

  it('reads a body and reports the final url', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>hello</body></html>')
      }),
    )

    const response = await client().request(`${origin}/page`)

    expect(response.status).toBe(200)
    expect(response.body).toContain('hello')
    expect(response.url).toBe(`${origin}/page`)
  })

  it('keeps caller headers on a same-origin redirect', async () => {
    const seen: Array<string | undefined> = []
    const { origin } = track(
      await listen((req, res) => {
        seen.push(req.headers.authorization)
        if (req.url === '/start') {
          res.writeHead(302, { location: '/end' })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('done')
      }),
    )

    await client().request(`${origin}/start`, { headers: { authorization: 'Bearer secret' } })

    expect(seen).toEqual(['Bearer secret', 'Bearer secret'])
  })

  it('drops caller headers when a redirect changes origin', async () => {
    let received: string | undefined = 'not-called'
    const target = track(
      await listen((req, res) => {
        received = req.headers.authorization
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('done')
      }),
    )
    const { origin } = track(
      await listen((_req, res) => {
        // A different port is a different origin, which is all the rule keys on.
        res.writeHead(302, { location: `${target.origin}/landed` })
        res.end()
      }),
    )

    const response = await client().request(`${origin}/start`, {
      headers: { authorization: 'Bearer secret' },
    })

    // The whole point: a vendor key must not be replayed to wherever a 302 points.
    expect(received).toBeUndefined()
    expect(response.body).toBe('done')
  })

  it('re-vets every redirect hop against the SSRF guard', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()
      }),
    )

    // The allowlist named 127.0.0.1 only, so the metadata endpoint is still refused.
    await expect(client().request(`${origin}/start`)).rejects.toMatchObject({ code: 'ssrf_blocked' })
  })

  it('stops after the redirect limit instead of looping', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(302, { location: '/again' })
        res.end()
      }),
    )

    await expect(client({ maxRedirects: 2 }).request(`${origin}/start`)).rejects.toMatchObject({
      code: 'too_many_redirects',
    })
  })

  it('caps the body and reports truncation', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('x'.repeat(100_000))
      }),
    )

    const response = await client().request(origin, { maxBytes: 1024 })

    expect(response.truncated).toBe(true)
    expect(response.body.length).toBeLessThanOrEqual(1024)
  })

  it('refuses to decode a content type the caller did not accept', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end('binary')
      }),
    )

    await expect(client().request(origin, { accept: ['text/html'] })).rejects.toMatchObject({
      code: 'unsupported_content_type',
    })
  })

  it('reports a 429 as blocked and carries retry-after', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(429, { 'retry-after': '7' })
        res.end('slow down')
      }),
    )

    const error = await client({ maxRetries: 0 }).request(origin).catch((caught: unknown) => caught)

    expect(isWebResearchError(error) && error.code).toBe('blocked')
    expect(isWebResearchError(error) && error.retryAfterMs).toBe(7000)
  })

  it('retries a 5xx and succeeds on a later attempt', async () => {
    let attempts = 0
    const { origin } = track(
      await listen((_req, res) => {
        attempts += 1
        if (attempts < 3) {
          res.writeHead(503)
          res.end('nope')
          return
        }
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('recovered')
      }),
    )

    const response = await client({ sleep: async () => {} }).request(origin)

    expect(attempts).toBe(3)
    expect(response.body).toBe('recovered')
  })

  it('does not retry a 404', async () => {
    let attempts = 0
    const { origin } = track(
      await listen((_req, res) => {
        attempts += 1
        res.writeHead(404)
        res.end('gone')
      }),
    )

    await expect(client({ sleep: async () => {} }).request(origin)).rejects.toMatchObject({
      code: 'bad_response',
    })
    expect(attempts).toBe(1)
  })

  it('gives up once one call has used its whole budget', async () => {
    let hops = 0
    const { origin } = track(
      await listen((_req, res) => {
        hops += 1
        res.writeHead(302, { location: '/again' })
        res.end()
      }),
    )

    // Each hop is fast, but the budget is what bounds the call — a chain of
    // redirects and retries could otherwise run for minutes inside an adapter
    // budget of seconds.
    let clock = 0
    await expect(
      client({ maxRedirects: 50, maxTotalMs: 100, now: () => (clock += 60) }).request(`${origin}/start`),
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(hops).toBeLessThan(50)
  })

  it('times out a body that never finishes', async () => {
    const { origin } = track(
      await listen((_req, res) => {
        // Headers land, then the server stalls forever. Before the read timeout
        // existed this pinned a socket and an adapter promise for the process
        // lifetime: the engine walked away on its deadline and cancelled nothing.
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('partial')
      }),
    )

    const error = await client({ timeoutMs: 300 }).request(origin).catch((caught: unknown) => caught)

    expect(isWebResearchError(error) && error.code).toBe('timeout')
  }, 10_000)

  it('aborts a body read that is already in flight', async () => {
    const controller = new AbortController()
    const { origin } = track(
      await listen((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('partial')
        setTimeout(() => controller.abort(), 50).unref?.()
      }),
    )

    const error = await client({ timeoutMs: 30_000 })
      .request(origin, { signal: controller.signal })
      .catch((caught: unknown) => caught)

    // The abort listener used to be removed once headers arrived, which left the
    // read uninterruptible by any signal or deadline.
    expect(isWebResearchError(error) && error.code).toBe('aborted')
  }, 10_000)
})
