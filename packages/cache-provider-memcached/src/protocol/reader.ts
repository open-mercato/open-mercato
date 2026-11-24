import { MemcachedProtocolError } from './errors'

const CR = 0x0d
const LF = 0x0a

export const NEED_MORE: unique symbol = Symbol('memcached.needMore')
export const PROGRESS: unique symbol = Symbol('memcached.progress')

export type ParseStep<T> = typeof NEED_MORE | typeof PROGRESS | { value: T }

/**
 * Incremental parser for one pipelined request. It reads from `reader` and
 * returns `NEED_MORE` (nothing consumed, wait for bytes), `PROGRESS` (bytes
 * consumed, request not finished yet) or the final value.
 */
export type ResponseParser<T> = (reader: ResponseReader) => ParseStep<T>

export class ResponseReader {
  public offset: number
  public needed = 0

  constructor(private readonly buffer: Buffer, offset: number) {
    this.offset = offset
  }

  readLine(): string | null {
    const end = this.buffer.indexOf('\r\n', this.offset, 'latin1')
    if (end < 0) {
      this.needed = this.buffer.length + 1
      return null
    }
    const line = this.buffer.toString('latin1', this.offset, end)
    this.offset = end + 2
    return line
  }

  readData(length: number): Buffer | null {
    const end = this.offset + length
    if (end + 2 > this.buffer.length) {
      this.needed = end + 2
      return null
    }
    if (this.buffer[end] !== CR || this.buffer[end + 1] !== LF) {
      throw new MemcachedProtocolError('protocol_error', 'Memcached value block is not terminated by CRLF')
    }
    const data = Buffer.from(this.buffer.subarray(this.offset, end))
    this.offset = end + 2
    return data
  }
}

/**
 * Maps the generic `ERROR` / `CLIENT_ERROR` / `SERVER_ERROR` replies. A client
 * error may leave the server reading the rest of our payload as a command, so
 * the connection is marked unusable; server errors keep the stream in sync.
 */
export function parseServerFailure(line: string): { error: MemcachedProtocolError; fatal: boolean } | null {
  if (line === 'ERROR' || line.startsWith('ERROR ')) {
    return { error: new MemcachedProtocolError('client_error', 'Memcached rejected an unknown command'), fatal: true }
  }
  if (line.startsWith('CLIENT_ERROR')) {
    return { error: new MemcachedProtocolError('client_error', `Memcached client error: ${line.slice(12).trim().slice(0, 120)}`), fatal: true }
  }
  if (line.startsWith('SERVER_ERROR')) {
    const detail = line.slice(12).trim().slice(0, 120)
    if (/too large/i.test(detail)) {
      return { error: new MemcachedProtocolError('item_too_large', 'Memcached rejected an item larger than its item size limit'), fatal: false }
    }
    return { error: new MemcachedProtocolError('server_error', `Memcached server error: ${detail}`), fatal: false }
  }
  return null
}

export class FatalResponseError extends Error {
  constructor(public readonly reason: MemcachedProtocolError) {
    super(reason.message)
    this.name = 'FatalResponseError'
  }
}

export type ParsedResult<T> = { ok: true; value: T } | { ok: false; error: MemcachedProtocolError }

export function failureOrUnexpected<T>(line: string, expected: string): { value: ParsedResult<T> } {
  const failure = parseServerFailure(line)
  if (!failure) {
    throw new FatalResponseError(new MemcachedProtocolError('protocol_error', `Unexpected memcached reply to ${expected}`))
  }
  if (failure.fatal) throw new FatalResponseError(failure.error)
  return { value: { ok: false, error: failure.error } }
}
