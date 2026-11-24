import { MemcachedProtocolError } from './errors'
import type { MemcachedSocket, MemcachedTransport } from './transport'
import {
  FatalResponseError,
  NEED_MORE,
  PROGRESS,
  ResponseReader,
  type ParsedResult,
  type ResponseParser,
} from './reader'

type PendingRequest = {
  parse: ResponseParser<ParsedResult<unknown>>
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * One pipelined memcached connection. Requests are written in order and their
 * replies parsed in the same order. A timeout, a protocol violation or a
 * socket failure destroys the connection and fails every in-flight request,
 * because the reply stream position is no longer known.
 */
export class MemcachedConnection {
  private readonly queue: PendingRequest[] = []
  private chunks: Buffer[] = []
  private buffered = 0
  private needed = 0
  private failure: MemcachedProtocolError | null = null

  private constructor(private readonly socket: MemcachedSocket, private readonly commandTimeoutMs: number) {
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('error', (error) => this.fail(new MemcachedProtocolError('unavailable', 'Memcached connection failed', { cause: error })))
    socket.on('close', () => this.fail(new MemcachedProtocolError('unavailable', 'Memcached connection closed')))
  }

  static async open(transport: MemcachedTransport, options: { connectTimeoutMs: number; commandTimeoutMs: number }): Promise<MemcachedConnection> {
    const socket = await transport.open({ timeoutMs: options.connectTimeoutMs })
    return new MemcachedConnection(socket, options.commandTimeoutMs)
  }

  get alive(): boolean {
    return this.failure === null
  }

  get pending(): number {
    return this.queue.length
  }

  send<T>(payload: Buffer | Buffer[], parse: ResponseParser<ParsedResult<T>>): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise<T>((resolve, reject) => {
      const request: PendingRequest = {
        parse: parse as ResponseParser<ParsedResult<unknown>>,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: null,
      }
      if (this.commandTimeoutMs > 0) {
        request.timer = setTimeout(() => {
          this.fail(new MemcachedProtocolError('timeout', `Memcached command did not complete within ${this.commandTimeoutMs}ms`))
        }, this.commandTimeoutMs)
      }
      this.queue.push(request)
      const parts = Array.isArray(payload) ? payload : [payload]
      for (const part of parts) this.socket.write(part)
    })
  }

  close(): void {
    this.fail(new MemcachedProtocolError('closed', 'Memcached client is closed'))
  }

  private onData(chunk: Buffer): void {
    if (this.failure) return
    this.chunks.push(chunk)
    this.buffered += chunk.length
    if (this.buffered < this.needed) return
    this.drain()
  }

  private drain(): void {
    const buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.buffered)
    let committed = 0
    let needed = 0
    while (committed < buffer.length || this.queue.length > 0) {
      const head = this.queue[0]
      if (!head) {
        this.fail(new MemcachedProtocolError('protocol_error', 'Memcached sent an unsolicited reply'))
        return
      }
      const reader = new ResponseReader(buffer, committed)
      let step
      try {
        step = head.parse(reader)
      } catch (error) {
        const reason = error instanceof FatalResponseError
          ? error.reason
          : error instanceof MemcachedProtocolError
            ? error
            : new MemcachedProtocolError('protocol_error', 'Memcached reply could not be parsed', { cause: error })
        this.queue.shift()
        if (head.timer) clearTimeout(head.timer)
        head.reject(reason)
        this.fail(new MemcachedProtocolError('unavailable', 'Memcached connection reset after an unrecoverable reply', { cause: reason }))
        return
      }
      if (step === NEED_MORE) {
        needed = Math.max(reader.needed - committed, buffer.length - committed + 1)
        break
      }
      committed = reader.offset
      if (step === PROGRESS) continue
      this.queue.shift()
      if (head.timer) clearTimeout(head.timer)
      if (step.value.ok) head.resolve(step.value.value)
      else head.reject(step.value.error)
    }
    const rest = committed < buffer.length ? buffer.subarray(committed) : null
    this.chunks = rest ? [rest] : []
    this.buffered = rest ? rest.length : 0
    this.needed = rest ? needed : 0
  }

  private fail(error: MemcachedProtocolError): void {
    if (this.failure) return
    this.failure = error
    const pending = this.queue.splice(0, this.queue.length)
    for (const request of pending) {
      if (request.timer) clearTimeout(request.timer)
      request.reject(error)
    }
    this.chunks = []
    this.buffered = 0
    this.socket.destroy()
  }
}
