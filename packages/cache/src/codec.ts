import zlib from 'node:zlib'

export type CacheCompression = 'off' | 'zstd' | 'gzip'

export type CacheCodecConfig = {
  compression: CacheCompression
  minBytes: number
}

export type CacheCodecOptions = {
  compression?: CacheCompression
  compressionMinBytes?: number
}

export const DEFAULT_COMPRESSION_MIN_BYTES = 1024

/** Upper bound for one decompressed entry; larger JSON is never compressed, so no legitimate entry can hit it. */
export const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024

const ZSTD_LEVEL = 1
const COMPRESSIONS: CacheCompression[] = ['off', 'zstd', 'gzip']

const warnedMessages = new Set<string>()

function warnOnce(message: string): void {
  if (warnedMessages.has(message)) return
  warnedMessages.add(message)
  console.warn(message)
}

export function isZstdAvailable(): boolean {
  return typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function'
}

export function parseCacheCompression(raw: string | undefined): CacheCompression {
  const value = raw?.trim().toLowerCase()
  if (!value) return 'off'
  if (COMPRESSIONS.includes(value as CacheCompression)) return value as CacheCompression
  warnOnce(`[cache] Unknown CACHE_COMPRESSION value "${raw}". Compression stays off.`)
  return 'off'
}

export function parseCacheCompressionMinBytes(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function resolveCacheCodecConfig(options?: CacheCodecOptions): CacheCodecConfig {
  const minBytes = options?.compressionMinBytes && options.compressionMinBytes > 0
    ? options.compressionMinBytes
    : DEFAULT_COMPRESSION_MIN_BYTES
  let compression = options?.compression ?? 'off'
  if (compression === 'zstd' && !isZstdAvailable()) {
    warnOnce('[cache] zstd is not available in this Node.js runtime. Falling back to gzip cache compression.')
    compression = 'gzip'
  }
  return { compression, minBytes }
}

function compress(input: Buffer, compression: Exclude<CacheCompression, 'off'>): Buffer {
  if (compression === 'zstd') {
    return zlib.zstdCompressSync(input, { params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } })
  }
  return zlib.gzipSync(input)
}

export function encodeCacheText(json: string, config: CacheCodecConfig): string | Buffer {
  if (config.compression === 'off') return json
  const size = Buffer.byteLength(json)
  if (size < config.minBytes || size > MAX_DECOMPRESSED_BYTES) return json
  const compressed = compress(Buffer.from(json, 'utf8'), config.compression)
  return compressed.length < size ? compressed : json
}

function isZstdFrame(raw: Buffer): boolean {
  return raw.length >= 4 && raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd
}

function isGzipStream(raw: Buffer): boolean {
  return raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
}

/** Detects the format from the stored bytes, so entries stay readable whatever CACHE_COMPRESSION is set to now. */
export function decodeCacheText(raw: string | Buffer): string {
  if (typeof raw === 'string') return raw
  if (isZstdFrame(raw)) {
    return zlib.zstdDecompressSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString('utf8')
  }
  if (isGzipStream(raw)) {
    return zlib.gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString('utf8')
  }
  return raw.toString('utf8')
}
