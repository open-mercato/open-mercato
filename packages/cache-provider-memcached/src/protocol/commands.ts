import { MemcachedProtocolError } from './errors'
import {
  FatalResponseError,
  NEED_MORE,
  PROGRESS,
  failureOrUnexpected,
  parseServerFailure,
  type ParsedResult,
  type ResponseParser,
} from './reader'

export const MAX_KEY_BYTES = 250
const KEY_PATTERN = /^[\x21-\x7e]+$/

export type MemcachedItem = {
  value: Buffer
  cas: string
  flags: number
}

export type MetaSetMode = 'set' | 'add' | 'replace' | 'append' | 'prepend'

export type MetaSetOutcome = 'stored' | 'not_stored' | 'exists' | 'not_found'
export type MetaDeleteOutcome = 'deleted' | 'not_found' | 'exists'
export type ClassicStoreOutcome = 'stored' | 'not_stored' | 'exists' | 'not_found'

const META_SET_MODE_TOKEN: Record<MetaSetMode, string> = {
  set: 'S',
  add: 'E',
  replace: 'R',
  append: 'A',
  prepend: 'P',
}

const CAS_PATTERN = /^\d{1,20}$/

export function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || Buffer.byteLength(key, 'latin1') > MAX_KEY_BYTES || !KEY_PATTERN.test(key)) {
    throw new MemcachedProtocolError('invalid_key', `Memcached keys must be 1-${MAX_KEY_BYTES} printable ASCII characters without spaces`)
  }
}

function assertCas(cas: string): void {
  if (!CAS_PATTERN.test(cas)) throw new MemcachedProtocolError('protocol_error', 'Invalid memcached CAS token')
}

function assertTtlSeconds(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0) {
    throw new MemcachedProtocolError('protocol_error', 'Memcached TTL must be a non-negative integer number of seconds')
  }
}

function assertFlags(flags: number): void {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) {
    throw new MemcachedProtocolError('protocol_error', 'Memcached client flags must be a 32-bit unsigned integer')
  }
}

function line(text: string): Buffer {
  return Buffer.from(`${text}\r\n`, 'latin1')
}

function withData(header: string, value: Buffer): Buffer[] {
  return [line(header), value, Buffer.from('\r\n', 'latin1')]
}

function parseMetaFlags(tokens: string[]): { cas: string | null; flags: number; key: string | null } {
  let cas: string | null = null
  let flags = 0
  let key: string | null = null
  for (const token of tokens) {
    if (token.length === 0) continue
    const kind = token[0]
    const rest = token.slice(1)
    if (kind === 'c') cas = rest
    else if (kind === 'f') flags = Number.parseInt(rest, 10) || 0
    else if (kind === 'k') key = rest
  }
  return { cas, flags, key }
}

function parseLength(raw: string | undefined): number {
  const length = raw !== undefined ? Number(raw) : Number.NaN
  if (!Number.isInteger(length) || length < 0) {
    throw new FatalResponseError(new MemcachedProtocolError('protocol_error', 'Memcached reply carried an invalid value length'))
  }
  return length
}

export type EncodedCommand<T> = {
  payload: Buffer | Buffer[]
  parse: ResponseParser<ParsedResult<T>>
}

export function metaGetCommand(key: string): EncodedCommand<MemcachedItem | null> {
  assertValidKey(key)
  return {
    payload: line(`mg ${key} v c f`),
    parse(reader) {
      const header = reader.readLine()
      if (header === null) return NEED_MORE
      if (header === 'EN') return { value: { ok: true, value: null } }
      if (header.startsWith('VA ')) {
        const tokens = header.split(' ')
        const length = parseLength(tokens[1])
        const data = reader.readData(length)
        if (data === null) return NEED_MORE
        const meta = parseMetaFlags(tokens.slice(2))
        return { value: { ok: true, value: { value: data, cas: meta.cas ?? '0', flags: meta.flags } } }
      }
      return failureOrUnexpected(header, 'mg')
    },
  }
}

/**
 * Quiet meta-get pipeline terminated by `mn`: misses are suppressed and hits
 * carry their key (`k` flag). The caller bounds the command size.
 */
export function metaGetManyCommand(keys: string[]): EncodedCommand<Map<string, MemcachedItem>> {
  for (const key of keys) assertValidKey(key)
  const found = new Map<string, MemcachedItem>()
  let failure: MemcachedProtocolError | null = null
  const text = `${keys.map((key) => `mg ${key} v c f k q`).join('\r\n')}\r\nmn\r\n`
  return {
    payload: Buffer.from(text, 'latin1'),
    parse(reader) {
      const header = reader.readLine()
      if (header === null) return NEED_MORE
      if (header === 'MN') {
        return { value: failure ? { ok: false, error: failure } : { ok: true, value: found } }
      }
      if (header.startsWith('VA ')) {
        const tokens = header.split(' ')
        const length = parseLength(tokens[1])
        const data = reader.readData(length)
        if (data === null) return NEED_MORE
        const meta = parseMetaFlags(tokens.slice(2))
        if (meta.key === null) {
          throw new FatalResponseError(new MemcachedProtocolError('protocol_error', 'Memcached multi-get hit is missing its key'))
        }
        found.set(meta.key, { value: data, cas: meta.cas ?? '0', flags: meta.flags })
        return PROGRESS
      }
      if (header === 'EN') return PROGRESS
      const serverFailure = parseServerFailure(header)
      if (!serverFailure) {
        throw new FatalResponseError(new MemcachedProtocolError('protocol_error', 'Unexpected memcached reply to mg'))
      }
      if (serverFailure.fatal) throw new FatalResponseError(serverFailure.error)
      failure = failure ?? serverFailure.error
      return PROGRESS
    },
  }
}

export type MetaSetOptions = {
  mode?: MetaSetMode
  cas?: string
  ttlSeconds?: number
  flags?: number
}

export function metaSetCommand(key: string, value: Buffer, options: MetaSetOptions = {}): EncodedCommand<MetaSetOutcome> {
  assertValidKey(key)
  const tokens = [`ms ${key} ${value.length}`]
  if (options.ttlSeconds !== undefined) {
    assertTtlSeconds(options.ttlSeconds)
    tokens.push(`T${options.ttlSeconds}`)
  }
  if (options.flags !== undefined) {
    assertFlags(options.flags)
    tokens.push(`F${options.flags}`)
  }
  if (options.cas !== undefined) {
    assertCas(options.cas)
    tokens.push(`C${options.cas}`)
  }
  if (options.mode && options.mode !== 'set') tokens.push(`M${META_SET_MODE_TOKEN[options.mode]}`)
  return {
    payload: withData(tokens.join(' '), value),
    parse(reader) {
      const reply = reader.readLine()
      if (reply === null) return NEED_MORE
      const code = reply.split(' ')[0]
      if (code === 'HD') return { value: { ok: true, value: 'stored' } }
      if (code === 'NS') return { value: { ok: true, value: 'not_stored' } }
      if (code === 'EX') return { value: { ok: true, value: 'exists' } }
      if (code === 'NF') return { value: { ok: true, value: 'not_found' } }
      return failureOrUnexpected(reply, 'ms')
    },
  }
}

export function metaDeleteCommand(key: string, options: { cas?: string } = {}): EncodedCommand<MetaDeleteOutcome> {
  assertValidKey(key)
  const tokens = [`md ${key}`]
  if (options.cas !== undefined) {
    assertCas(options.cas)
    tokens.push(`C${options.cas}`)
  }
  return {
    payload: line(tokens.join(' ')),
    parse(reader) {
      const reply = reader.readLine()
      if (reply === null) return NEED_MORE
      const code = reply.split(' ')[0]
      if (code === 'HD') return { value: { ok: true, value: 'deleted' } }
      if (code === 'NF') return { value: { ok: true, value: 'not_found' } }
      if (code === 'EX') return { value: { ok: true, value: 'exists' } }
      return failureOrUnexpected(reply, 'md')
    },
  }
}

export function getsCommand(keys: string[]): EncodedCommand<Map<string, MemcachedItem>> {
  if (keys.length === 0) throw new MemcachedProtocolError('protocol_error', 'gets requires at least one key')
  for (const key of keys) assertValidKey(key)
  const found = new Map<string, MemcachedItem>()
  return {
    payload: line(`gets ${keys.join(' ')}`),
    parse(reader) {
      const header = reader.readLine()
      if (header === null) return NEED_MORE
      if (header === 'END') return { value: { ok: true, value: found } }
      if (header.startsWith('VALUE ')) {
        const tokens = header.split(' ')
        const key = tokens[1]
        const flags = Number.parseInt(tokens[2] ?? '0', 10) || 0
        const length = parseLength(tokens[3])
        const cas = tokens[4]
        const data = reader.readData(length)
        if (data === null) return NEED_MORE
        if (!key || !cas) {
          throw new FatalResponseError(new MemcachedProtocolError('protocol_error', 'Malformed memcached VALUE header'))
        }
        found.set(key, { value: data, cas, flags })
        return PROGRESS
      }
      return failureOrUnexpected(header, 'gets')
    },
  }
}

function classicStoreOutcome(reply: string, command: string): { value: ParsedResult<ClassicStoreOutcome> } {
  if (reply === 'STORED') return { value: { ok: true, value: 'stored' } }
  if (reply === 'NOT_STORED') return { value: { ok: true, value: 'not_stored' } }
  if (reply === 'EXISTS') return { value: { ok: true, value: 'exists' } }
  if (reply === 'NOT_FOUND') return { value: { ok: true, value: 'not_found' } }
  return failureOrUnexpected(reply, command)
}

export type ClassicStoreOptions = {
  ttlSeconds?: number
  flags?: number
}

function classicStoreCommand(
  verb: 'add' | 'set' | 'cas',
  key: string,
  value: Buffer,
  options: ClassicStoreOptions & { cas?: string },
): EncodedCommand<ClassicStoreOutcome> {
  assertValidKey(key)
  const ttlSeconds = options.ttlSeconds ?? 0
  const flags = options.flags ?? 0
  assertTtlSeconds(ttlSeconds)
  assertFlags(flags)
  const header = [verb, key, String(flags), String(ttlSeconds), String(value.length)]
  if (verb === 'cas') {
    if (options.cas === undefined) throw new MemcachedProtocolError('protocol_error', 'cas requires a CAS token')
    assertCas(options.cas)
    header.push(options.cas)
  }
  return {
    payload: withData(header.join(' '), value),
    parse(reader) {
      const reply = reader.readLine()
      if (reply === null) return NEED_MORE
      return classicStoreOutcome(reply, verb)
    },
  }
}

export function addCommand(key: string, value: Buffer, options: ClassicStoreOptions = {}): EncodedCommand<ClassicStoreOutcome> {
  return classicStoreCommand('add', key, value, options)
}

export function casCommand(key: string, value: Buffer, cas: string, options: ClassicStoreOptions = {}): EncodedCommand<ClassicStoreOutcome> {
  return classicStoreCommand('cas', key, value, { ...options, cas })
}

export function versionCommand(): EncodedCommand<string> {
  return {
    payload: line('version'),
    parse(reader) {
      const reply = reader.readLine()
      if (reply === null) return NEED_MORE
      if (reply.startsWith('VERSION ')) return { value: { ok: true, value: reply.slice(8).trim() } }
      return failureOrUnexpected(reply, 'version')
    },
  }
}

export function noopCommand(): EncodedCommand<null> {
  return {
    payload: line('mn'),
    parse(reader) {
      const reply = reader.readLine()
      if (reply === null) return NEED_MORE
      if (reply === 'MN') return { value: { ok: true, value: null } }
      return failureOrUnexpected(reply, 'mn')
    },
  }
}

const STATS_GROUP_PATTERN = /^[a-z_]{1,32}$/

export function statsCommand(group?: string): EncodedCommand<Map<string, string>> {
  if (group !== undefined && !STATS_GROUP_PATTERN.test(group)) {
    throw new MemcachedProtocolError('protocol_error', 'Invalid memcached stats group')
  }
  const stats = new Map<string, string>()
  return {
    payload: line(group ? `stats ${group}` : 'stats'),
    parse(reader) {
      const reply = reader.readLine()
      if (reply === null) return NEED_MORE
      if (reply === 'END') return { value: { ok: true, value: stats } }
      if (reply.startsWith('STAT ')) {
        const separator = reply.indexOf(' ', 5)
        if (separator > 0) stats.set(reply.slice(5, separator), reply.slice(separator + 1))
        return PROGRESS
      }
      return failureOrUnexpected(reply, 'stats')
    },
  }
}
