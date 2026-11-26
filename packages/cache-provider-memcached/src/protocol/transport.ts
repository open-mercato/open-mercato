import net from 'node:net'
import tls from 'node:tls'
import { MemcachedProtocolError } from './errors'

/**
 * Minimal duplex surface the connection needs. `net.Socket` and
 * `tls.TLSSocket` satisfy it; tests may inject an in-memory implementation.
 */
export type MemcachedSocket = {
  write(data: Buffer): boolean
  destroy(error?: Error): void
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  setNoDelay?(noDelay?: boolean): unknown
  setKeepAlive?(enable?: boolean, initialDelay?: number): unknown
}

export type MemcachedTransportOpenOptions = {
  timeoutMs: number
}

/**
 * Opens one connected socket to a single memcached server. `describe()` is a
 * redaction-safe label (never includes credentials).
 */
export type MemcachedTransport = {
  open(options: MemcachedTransportOpenOptions): Promise<MemcachedSocket>
  describe(): string
}

export type MemcachedTcpEndpoint = {
  host: string
  port: number
}

export type MemcachedTlsOptions = {
  ca?: string | Buffer | Array<string | Buffer>
  cert?: string | Buffer
  key?: string | Buffer
  servername?: string
  rejectUnauthorized?: boolean
}

function connectWithTimeout<TSocket extends net.Socket>(
  create: () => TSocket,
  readyEvent: 'connect' | 'secureConnect',
  timeoutMs: number,
): Promise<TSocket> {
  return new Promise<TSocket>((resolve, reject) => {
    const socket = create()
    let settled = false
    const finish = (error: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeListener(readyEvent, onReady)
      socket.removeListener('error', onError)
      if (error) {
        socket.destroy()
        reject(error)
        return
      }
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 30_000)
      resolve(socket)
    }
    const onReady = () => finish(null)
    const onError = (error: Error) => finish(new MemcachedProtocolError('unavailable', 'Memcached connection failed', { cause: error }))
    const timer = setTimeout(
      () => finish(new MemcachedProtocolError('timeout', `Memcached connection did not open within ${timeoutMs}ms`)),
      timeoutMs,
    )
    socket.once(readyEvent, onReady)
    socket.once('error', onError)
  })
}

export function createTcpTransport(endpoint: MemcachedTcpEndpoint): MemcachedTransport {
  return {
    open: ({ timeoutMs }) => connectWithTimeout(
      () => net.connect({ host: endpoint.host, port: endpoint.port }),
      'connect',
      timeoutMs,
    ),
    describe: () => `tcp:${endpoint.host}:${endpoint.port}`,
  }
}

export function createTlsTransport(endpoint: MemcachedTcpEndpoint, options: MemcachedTlsOptions = {}): MemcachedTransport {
  return {
    open: ({ timeoutMs }) => connectWithTimeout(
      () => tls.connect({
        host: endpoint.host,
        port: endpoint.port,
        servername: options.servername ?? (net.isIP(endpoint.host) ? undefined : endpoint.host),
        ...(options.ca !== undefined ? { ca: options.ca } : {}),
        ...(options.cert !== undefined ? { cert: options.cert } : {}),
        ...(options.key !== undefined ? { key: options.key } : {}),
        rejectUnauthorized: options.rejectUnauthorized ?? true,
      }),
      'secureConnect',
      timeoutMs,
    ),
    describe: () => `tls:${endpoint.host}:${endpoint.port}`,
  }
}
