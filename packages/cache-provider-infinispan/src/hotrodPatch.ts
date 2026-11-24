/// <reference path="./infinispan-protocols.d.ts" />
export type HotRodDecodeResult = { result?: unknown; continue: boolean }
export type HotRodDecoder = (header: unknown, bytebuf: unknown) => HotRodDecodeResult

type HotRodProtocol = { decodeWithMeta: () => HotRodDecoder; decodeNextEntries: () => HotRodDecoder }

const PINNED_PROTOCOL_VERSIONS = ['4.1', '4.0', '3.1'] as const
const PROBE_OPTIONS = { dataFormat: { keyType: 'text/plain', valueType: 'text/plain' } }

type HotRodProtocolsModule = {
  resolve: (version: string, options: unknown) => HotRodProtocol
}

const PATCH_MARKER = Symbol.for('@open-mercato/cache-provider-infinispan/split-frame-decoders')

function isProtocolsModule(value: unknown): value is HotRodProtocolsModule {
  return typeof value === 'object' && value !== null && typeof (value as { resolve?: unknown }).resolve === 'function'
}

function exposesPatchedDecoders(protocols: HotRodProtocolsModule): boolean {
  return PINNED_PROTOCOL_VERSIONS.every((version) => {
    try {
      const protocol: unknown = protocols.resolve(version, PROBE_OPTIONS)
      if (typeof protocol !== 'object' || protocol === null) return false
      const candidate = protocol as { decodeWithMeta?: unknown; decodeNextEntries?: unknown }
      return typeof candidate.decodeWithMeta === 'function' && typeof candidate.decodeNextEntries === 'function'
    } catch {
      return false
    }
  })
}

function isTruncatedVersionedValue(decoded: HotRodDecodeResult): boolean {
  if (!decoded.continue) return false
  const result = decoded.result
  if (typeof result !== 'object' || result === null) return false
  return 'version' in result && (result as { value?: unknown }).value === undefined
}

export function isIncompleteFrameError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown }
  if (name === 'RangeError') return code === 'ERR_OUT_OF_RANGE' || code === 'ERR_BUFFER_OUT_OF_BOUNDS'
  return name === 'TypeError' && typeof message === 'string' && /^Cannot read properties of undefined \(reading '(length|\d+)'\)$/.test(message)
}

function hasTruncatedIteratorEntry(decoded: HotRodDecodeResult): boolean {
  if (!decoded.continue || !Array.isArray(decoded.result)) return false
  return decoded.result.some((entry: unknown) =>
    typeof entry !== 'object' || entry === null
    || (entry as { key?: unknown }).key === undefined
    || (entry as { value?: unknown }).value === undefined)
}

function guardDecoder(decoder: HotRodDecoder, isTruncated: (decoded: HotRodDecodeResult) => boolean): HotRodDecoder {
  return (header, bytebuf) => {
    let decoded: HotRodDecodeResult
    try {
      decoded = decoder(header, bytebuf)
    } catch (error) {
      if (isIncompleteFrameError(error)) return { continue: false }
      throw error
    }
    return isTruncated(decoded) ? { continue: false } : decoded
  }
}

export function guardDecodeWithMeta(decoder: HotRodDecoder): HotRodDecoder {
  return guardDecoder(decoder, isTruncatedVersionedValue)
}

export function guardDecodeNextEntries(decoder: HotRodDecoder): HotRodDecoder {
  return guardDecoder(decoder, hasTruncatedIteratorEntry)
}

/**
 * infinispan@0.16.x `getWithMetadata` (and the iterator page decoder, which
 * shares the timestamp decoding) mis-handles a response split across socket
 * reads: a truncated value decodes as `value: undefined` (desynchronizing the
 * connection) and a truncated lifespan timestamp throws inside the socket data
 * handler (crashing the process). Make the decoder ask the transport for more
 * bytes instead, so it rewinds and retries; a frame that never completes is
 * bounded by the provider's command timeout and connection discard. Only
 * out-of-bounds reads count as an incomplete frame; any other decoder error is
 * rethrown. Returns false (the provider then fails with `load_failed`) when the
 * installed client does not expose the decoder shape this patch relies on.
 */
export function patchHotRodProtocols(candidate: unknown): boolean {
  const modules = [(candidate as { default?: unknown } | null)?.default, candidate]
  const protocols = modules.find(isProtocolsModule)
  if (!protocols) return false
  const marked = protocols as HotRodProtocolsModule & { [PATCH_MARKER]?: true }
  if (marked[PATCH_MARKER]) return true
  if (!exposesPatchedDecoders(protocols)) return false
  const resolve = protocols.resolve
  marked.resolve = (version, options) => {
    const protocol = resolve(version, options)
    const decodeWithMeta = protocol.decodeWithMeta
    const decodeNextEntries = protocol.decodeNextEntries
    protocol.decodeWithMeta = () => guardDecodeWithMeta(decodeWithMeta.call(protocol))
    protocol.decodeNextEntries = () => guardDecodeNextEntries(decodeNextEntries.call(protocol))
    return protocol
  }
  marked[PATCH_MARKER] = true
  return true
}

export async function applyHotRodDecodePatch(): Promise<boolean> {
  return patchHotRodProtocols(await import('infinispan/lib/protocols.js'))
}
