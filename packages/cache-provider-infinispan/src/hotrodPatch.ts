/// <reference path="./infinispan-protocols.d.ts" />
export type HotRodDecodeResult = { result?: unknown; continue: boolean }
export type HotRodDecoder = (header: unknown, bytebuf: unknown) => HotRodDecodeResult

type HotRodProtocol = { decodeWithMeta: () => HotRodDecoder }

type HotRodProtocolsModule = {
  resolve: (version: string, options: unknown) => HotRodProtocol
}

const PATCH_MARKER = Symbol.for('@open-mercato/cache-provider-infinispan/decode-with-meta')

function isProtocolsModule(value: unknown): value is HotRodProtocolsModule {
  return typeof value === 'object' && value !== null && typeof (value as { resolve?: unknown }).resolve === 'function'
}

function isTruncatedVersionedValue(decoded: HotRodDecodeResult): boolean {
  if (!decoded.continue) return false
  const result = decoded.result
  if (typeof result !== 'object' || result === null) return false
  return 'version' in result && (result as { value?: unknown }).value === undefined
}

export function guardDecodeWithMeta(decoder: HotRodDecoder): HotRodDecoder {
  return (header, bytebuf) => {
    let decoded: HotRodDecodeResult
    try {
      decoded = decoder(header, bytebuf)
    } catch {
      return { continue: false }
    }
    return isTruncatedVersionedValue(decoded) ? { continue: false } : decoded
  }
}

/**
 * infinispan@0.16.x `getWithMetadata` mis-handles a response split across socket
 * reads: a truncated value decodes as `value: undefined` (desynchronizing the
 * connection) and a truncated lifespan timestamp throws inside the socket data
 * handler (crashing the process). Make the decoder ask the transport for more
 * bytes instead, so it rewinds and retries; a frame that never completes is
 * bounded by the provider's command timeout and connection discard.
 */
export function patchHotRodProtocols(candidate: unknown): boolean {
  const modules = [(candidate as { default?: unknown } | null)?.default, candidate]
  const protocols = modules.find(isProtocolsModule)
  if (!protocols) return false
  const marked = protocols as HotRodProtocolsModule & { [PATCH_MARKER]?: true }
  if (marked[PATCH_MARKER]) return true
  const resolve = protocols.resolve
  marked.resolve = (version, options) => {
    const protocol = resolve(version, options)
    const decodeWithMeta = protocol.decodeWithMeta
    protocol.decodeWithMeta = () => guardDecodeWithMeta(decodeWithMeta.call(protocol))
    return protocol
  }
  marked[PATCH_MARKER] = true
  return true
}

export async function applyHotRodDecodePatch(): Promise<boolean> {
  return patchHotRodProtocols(await import('infinispan/lib/protocols.js'))
}
