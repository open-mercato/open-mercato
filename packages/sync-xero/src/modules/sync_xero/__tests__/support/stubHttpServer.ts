import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type StubRequest = {
  method: string
  path: string
  query: URLSearchParams
  headers: http.IncomingHttpHeaders
}

export type StubResponse = {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export type StubHttpServer = {
  url: string
  requests: StubRequest[]
  close(): Promise<void>
}

export async function startStubHttpServer(
  handler: (request: StubRequest) => StubResponse | Promise<StubResponse>,
): Promise<StubHttpServer> {
  const requests: StubRequest[] = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const request: StubRequest = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers }
    requests.push(request)
    req.resume()
    Promise.resolve(handler(request))
      .then((response) => {
        const headers = { ...(response.headers ?? {}) }
        const payload = response.body === undefined ? '' : typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
        if (response.body !== undefined && typeof response.body !== 'string') headers['content-type'] ??= 'application/json'
        res.writeHead(response.status, headers)
        res.end(payload)
      })
      .catch(() => {
        res.writeHead(500)
        res.end()
      })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
