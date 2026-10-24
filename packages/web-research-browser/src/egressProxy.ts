import {
  createServer,
  request as sendHttp,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { assertPublicUrl, createPinnedLookup, type LookupFn, type VettedUrl } from '@open-mercato/web-research'

export type EgressDialTarget = {
  readonly host: string
  readonly port: number
  /** The addresses `assertPublicUrl` vetted for this connection; the only ones a dial may use. */
  readonly addresses: readonly string[]
}

export type EgressConnect = (target: EgressDialTarget) => Socket

export type EgressProxyOptions = {
  readonly lookup?: LookupFn
  readonly connect?: EgressConnect
  readonly vetTimeoutMs?: number
  readonly dialTimeoutMs?: number
  readonly idleTimeoutMs?: number
}

export type EgressProxy = {
  readonly url: string
  close(): Promise<void>
}

const EGRESS_VET_TIMEOUT_MS = 10_000
const EGRESS_DIAL_TIMEOUT_MS = 10_000
const EGRESS_IDLE_TIMEOUT_MS = 120_000

const AUTHORITY_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+):(\d{1,5})$/

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  502: 'Bad Gateway',
  504: 'Gateway Timeout',
}

/** Dials only the vetted addresses: the hostname is never handed to DNS. */
export const pinnedConnect: EgressConnect = ({ host, port, addresses }) =>
  netConnect({ host, port, lookup: createPinnedLookup(addresses), autoSelectFamily: true })

function parseConnectAuthority(raw: string): { host: string; port: number } | null {
  const match = AUTHORITY_PATTERN.exec(raw)
  if (!match) return null
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: match[1], port }
}

function parseAbsoluteForm(raw: string): URL | null {
  if (!/^http:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' || url.hostname === '') return null
    return url
  } catch {
    return null
  }
}

function forwardableHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const listed = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0),
  )
  const result: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const key = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(key) || key.startsWith('proxy-') || listed.has(key)) continue
    result[key] = value
  }
  return result
}

function dialHost(vetted: VettedUrl): string {
  return vetted.url.hostname.replace(/^\[|\]$/g, '')
}

function refuseSocket(socket: Duplex, status: number): void {
  if (socket.destroyed || !socket.writable) {
    socket.destroy()
    return
  }
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  )
}

function refuseResponse(res: ServerResponse, status: number, reason: string): void {
  if (res.headersSent || res.destroyed) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
  res.end(`om-web-research egress proxy: ${reason}\n`)
}

/**
 * Loopback HTTP proxy that every connection of the sidecar's Chromium goes through.
 *
 * Each CONNECT tunnel and each absolute-form request is vetted with
 * `assertPublicUrl` on its own, then dialled only to the addresses that check
 * returned, so redirect hops, WebSockets, workers and a host whose DNS answer
 * changes between connections are all held to the same rule. Nothing is cached.
 */
export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const connect = options.connect ?? pinnedConnect
  const vetTimeoutMs = options.vetTimeoutMs ?? EGRESS_VET_TIMEOUT_MS
  const dialTimeoutMs = options.dialTimeoutMs ?? EGRESS_DIAL_TIMEOUT_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? EGRESS_IDLE_TIMEOUT_MS
  const sockets = new Set<Duplex>()
  let closed = false

  const track = (socket: Duplex): void => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  }

  const vet = (rawUrl: string): Promise<VettedUrl | 'blocked' | 'timeout'> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), vetTimeoutMs)
      assertPublicUrl(rawUrl, 'browser egress', {
        failClosed: true,
        ...(options.lookup ? { lookup: options.lookup } : {}),
      }).then(
        (vetted) => {
          clearTimeout(timer)
          resolve(vetted)
        },
        () => {
          clearTimeout(timer)
          resolve('blocked')
        },
      )
    })

  const dial = (target: EgressDialTarget): Promise<Socket> =>
    new Promise((resolve, reject) => {
      let socket: Socket
      try {
        socket = connect(target)
      } catch (error) {
        reject(error)
        return
      }
      track(socket)
      socket.on('error', () => socket.destroy())
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`dial to ${target.host}:${target.port} timed out`))
      }, dialTimeoutMs)
      socket.once('close', () => {
        clearTimeout(timer)
        reject(new Error(`dial to ${target.host}:${target.port} failed`))
      })
      socket.once('connect', () => {
        clearTimeout(timer)
        if (closed) {
          socket.destroy()
          return
        }
        resolve(socket)
      })
    })

  const handleConnect = async (req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> => {
    track(client)
    client.on('error', () => client.destroy())
    let clientLeft = false
    const markLeft = (): void => {
      clientLeft = true
    }
    client.once('end', markLeft)
    client.once('close', markLeft)
    const authority = parseConnectAuthority(req.url ?? '')
    if (!authority) return refuseSocket(client, 400)
    const vetted = await vet(`http://${authority.host}:${authority.port}/`)
    if (vetted === 'timeout') return refuseSocket(client, 504)
    if (vetted === 'blocked') return refuseSocket(client, 403)
    if (closed || clientLeft) {
      client.destroy()
      return
    }
    let upstream: Socket
    try {
      upstream = await dial({ host: dialHost(vetted), port: authority.port, addresses: vetted.addresses })
    } catch {
      return refuseSocket(client, 502)
    }
    if (clientLeft) {
      upstream.destroy()
      client.destroy()
      return
    }
    upstream.setTimeout(idleTimeoutMs, () => {
      upstream.destroy()
      client.destroy()
    })
    upstream.once('close', () => client.destroy())
    client.once('close', () => upstream.destroy())
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) upstream.write(head)
    client.pipe(upstream)
    upstream.pipe(client)
  }

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    req.on('error', () => res.destroy())
    res.on('error', () => res.destroy())
    const target = parseAbsoluteForm(req.url ?? '')
    if (!target) return refuseResponse(res, 400, 'only absolute-form http:// requests are proxied')
    if (req.headers.upgrade !== undefined) return refuseResponse(res, 400, 'upgrade requests must use CONNECT')
    const vetted = await vet(target.href)
    if (vetted === 'timeout') return refuseResponse(res, 504, 'destination could not be vetted in time')
    if (vetted === 'blocked') return refuseResponse(res, 403, 'destination is not a public address')
    if (closed || res.destroyed) return
    let upstreamSocket: Socket
    try {
      upstreamSocket = await dial({
        host: dialHost(vetted),
        port: Number(vetted.url.port || 80),
        addresses: vetted.addresses,
      })
    } catch {
      return refuseResponse(res, 502, 'destination unreachable')
    }
    if (res.destroyed) {
      upstreamSocket.destroy()
      return
    }
    upstreamSocket.setTimeout(idleTimeoutMs, () => upstreamSocket.destroy())

    const headers = forwardableHeaders(req.headers)
    headers.host = vetted.url.host
    headers.connection = 'close'
    const forwardResponse = (upstreamResponse: IncomingMessage): void => {
      upstreamResponse.on('error', () => res.destroy())
      const status = upstreamResponse.statusCode ?? 0
      if (status < 200 || status > 999) {
        upstreamResponse.destroy()
        refuseResponse(res, 502, 'upstream sent an invalid status')
        return
      }
      try {
        res.writeHead(status, forwardableHeaders(upstreamResponse.headers))
      } catch {
        upstreamResponse.destroy()
        res.destroy()
        return
      }
      upstreamResponse.pipe(res)
    }
    let upstreamRequest: ClientRequest
    try {
      upstreamRequest = sendHttp(
        {
          method: req.method,
          path: `${vetted.url.pathname}${vetted.url.search}`,
          headers,
          setHost: false,
          createConnection: () => upstreamSocket,
        },
        forwardResponse,
      )
    } catch {
      upstreamSocket.destroy()
      return refuseResponse(res, 502, 'upstream request could not be built')
    }
    upstreamRequest.on('error', () => refuseResponse(res, 502, 'upstream failed'))
    upstreamRequest.on('upgrade', (_response, socket) => {
      socket.destroy()
      refuseResponse(res, 502, 'upstream attempted a protocol upgrade')
    })
    res.once('close', () => upstreamRequest.destroy())
    req.pipe(upstreamRequest)
  }

  const server = createServer()
  server.timeout = idleTimeoutMs
  server.on('connection', (socket) => track(socket))
  server.on('request', (req, res) => {
    void handleRequest(req, res).catch(() => refuseResponse(res, 502, 'proxy failure'))
  })
  server.on('connect', (req, socket, head) => {
    void handleConnect(req, socket, head).catch(() => socket.destroy())
  })
  server.on('upgrade', (_req, socket) => {
    socket.on('error', () => socket.destroy())
    refuseSocket(socket, 400)
  })
  server.on('clientError', (_error, socket) => {
    refuseSocket(socket, 400)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  server.on('error', () => undefined)
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('[internal] egress proxy did not bind a TCP port')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        closed = true
        server.close(() => resolve())
        for (const socket of sockets) socket.destroy()
      }),
  }
}
