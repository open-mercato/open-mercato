/** @jest-environment node */
import zlib from 'node:zlib'
import {
  DEFAULT_COMPRESSION_MIN_BYTES,
  MAX_DECOMPRESSED_BYTES,
  decodeCacheText,
  encodeCacheText,
  parseCacheCompression,
  parseCacheCompressionMinBytes,
  resolveCacheCodecConfig,
} from '../codec'
import type { CacheCodecConfig } from '../codec'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const GZIP_MAGIC = [0x1f, 0x8b]

function listPayload(rows: number): string {
  return JSON.stringify({
    items: Array.from({ length: rows }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      displayName: `Contact ${index}`,
      primaryEmail: `contact.${index}@example.com`,
      status: index % 2 ? 'active' : 'lead',
    })),
    total: rows,
  })
}

function startsWith(raw: string | Buffer, magic: number[]): boolean {
  return Buffer.isBuffer(raw) && magic.every((byte, index) => raw[index] === byte)
}

describe.each([
  ['zstd', ZSTD_MAGIC],
  ['gzip', GZIP_MAGIC],
] as const)('cache codec (%s)', (compression, magic) => {
  const config: CacheCodecConfig = { compression, minBytes: DEFAULT_COMPRESSION_MIN_BYTES }

  it('round-trips a large entry through a compressed frame', () => {
    const json = listPayload(100)
    const encoded = encodeCacheText(json, config)

    expect(startsWith(encoded, magic)).toBe(true)
    expect((encoded as Buffer).length).toBeLessThan(Buffer.byteLength(json) / 4)
    expect(decodeCacheText(encoded)).toBe(json)
  })

  it('keeps entries below the threshold as plain JSON', () => {
    const json = listPayload(2)
    expect(Buffer.byteLength(json)).toBeLessThan(DEFAULT_COMPRESSION_MIN_BYTES)

    expect(encodeCacheText(json, config)).toBe(json)
  })

  it('stores the JSON when compression would not shrink it', () => {
    const json = JSON.stringify({ id: 'a1' })

    expect(encodeCacheText(json, { compression, minBytes: 1 })).toBe(json)
  })

  it('reads entries written by the other codec and by the off setting', () => {
    const json = listPayload(100)
    const other: CacheCodecConfig = { compression: compression === 'zstd' ? 'gzip' : 'zstd', minBytes: 1024 }

    expect(decodeCacheText(encodeCacheText(json, other))).toBe(json)
    expect(decodeCacheText(encodeCacheText(json, { compression: 'off', minBytes: 1024 }))).toBe(json)
  })

  it('rejects a corrupt frame', () => {
    const encoded = encodeCacheText(listPayload(100), config) as Buffer
    const corrupt = Buffer.concat([encoded.subarray(0, magic.length), Buffer.alloc(32, 0xff)])

    expect(() => decodeCacheText(corrupt)).toThrow()
  })
})

describe('cache codec format detection', () => {
  it('reads legacy JSON stored as a string or as UTF-8 bytes', () => {
    const json = listPayload(100)

    expect(decodeCacheText(json)).toBe(json)
    expect(decodeCacheText(Buffer.from(json, 'utf8'))).toBe(json)
  })

  it('never compresses with compression off', () => {
    const json = listPayload(100)
    expect(encodeCacheText(json, { compression: 'off', minBytes: 1 })).toBe(json)
  })

  it('skips compression above the decode cap so a legitimate entry can always be read back', () => {
    const encodeSpy = jest.spyOn(zlib, 'gzipSync')
    const json = 'x'.repeat(MAX_DECOMPRESSED_BYTES + 1)

    expect(encodeCacheText(json, { compression: 'gzip', minBytes: 1 })).toBe(json)
    expect(encodeSpy).not.toHaveBeenCalled()
    encodeSpy.mockRestore()
  })

  it('caps the decompressed size of a hostile frame', () => {
    const bomb = zlib.zstdCompressSync(Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1024, 0x20))

    expect(() => decodeCacheText(bomb)).toThrow()
  })
})

describe('cache codec configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('parses known compression values case-insensitively', () => {
    expect(parseCacheCompression('zstd')).toBe('zstd')
    expect(parseCacheCompression(' GZIP ')).toBe('gzip')
    expect(parseCacheCompression('off')).toBe('off')
    expect(parseCacheCompression(undefined)).toBe('off')
    expect(parseCacheCompression('')).toBe('off')
  })

  it('treats an unknown value as off and warns once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseCacheCompression('brotli-codec-test')).toBe('off')
    expect(parseCacheCompression('brotli-codec-test')).toBe('off')

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('accepts only a positive min-bytes value', () => {
    expect(parseCacheCompressionMinBytes('2048')).toBe(2048)
    expect(parseCacheCompressionMinBytes('0')).toBeUndefined()
    expect(parseCacheCompressionMinBytes('-5')).toBeUndefined()
    expect(parseCacheCompressionMinBytes('abc')).toBeUndefined()
    expect(parseCacheCompressionMinBytes(undefined)).toBeUndefined()
  })

  it('defaults to off with a 1 KB threshold', () => {
    expect(resolveCacheCodecConfig()).toEqual({ compression: 'off', minBytes: DEFAULT_COMPRESSION_MIN_BYTES })
    expect(resolveCacheCodecConfig({ compression: 'zstd', compressionMinBytes: 0 })).toEqual({
      compression: 'zstd',
      minBytes: DEFAULT_COMPRESSION_MIN_BYTES,
    })
  })

  it('falls back to gzip when the runtime has no zstd', () => {
    jest.isolateModules(() => {
      jest.doMock('node:zlib', () => {
        const actual = jest.requireActual<typeof import('node:zlib')>('node:zlib')
        return { ...actual, zstdCompressSync: undefined, zstdDecompressSync: undefined }
      })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const isolated = require('../codec') as typeof import('../codec')

      const config = isolated.resolveCacheCodecConfig({ compression: 'zstd' })
      const encoded = isolated.encodeCacheText(listPayload(100), config)

      expect(config.compression).toBe('gzip')
      expect(startsWith(encoded, GZIP_MAGIC)).toBe(true)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('zstd is not available'))
    })
    jest.dontMock('node:zlib')
  })
})
