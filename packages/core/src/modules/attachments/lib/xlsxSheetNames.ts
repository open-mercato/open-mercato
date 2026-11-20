import { createInflateRaw, inflateRawSync } from 'zlib'
import { Readable, Writable } from 'stream'
import { pipeline } from 'stream/promises'

export const SPREADSHEET_ENCRYPTED = 'SPREADSHEET_ENCRYPTED'
export const SPREADSHEET_ENTRY_TOO_LARGE = 'SPREADSHEET_ENTRY_TOO_LARGE'

const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP64_END_LOCATOR = 0x07064b50
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const ZIP64_EXTRA_FIELD = 0x0001
const END_OF_CENTRAL_DIRECTORY_SIZE = 22
const MAX_ARCHIVE_COMMENT_LENGTH = 0xffff
const UINT32_MAX = 0xffffffff
const STORED = 0
const DEFLATED = 8
const PACKAGE_RELATIONSHIPS_PATH = '_rels/.rels'
const OFFICE_DOCUMENT_RELATIONSHIP = /\/officeDocument$/
const RELATIONSHIP_TAG = /<(?:[\w.-]+:)?Relationship\b((?:[^<>"']|"[^"<]*"|'[^'<]*')*)>/g
const SHEET_TAG = /<(?:[\w.-]+:)?sheet\b((?:[^<>"']|"[^"<]*"|'[^'<]*')*)>/g
const XML_ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

type ArchiveEntry = {
  flags: number
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const lowest = Math.max(0, archive.length - END_OF_CENTRAL_DIRECTORY_SIZE - MAX_ARCHIVE_COMMENT_LENGTH)
  for (let offset = archive.length - END_OF_CENTRAL_DIRECTORY_SIZE; offset >= lowest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  throw new Error('[internal] spreadsheet archive has no end of central directory record')
}

function readSafeUint64(archive: Buffer, offset: number, end: number): number {
  if (offset < 0 || offset + 8 > end) throw new Error('[internal] truncated spreadsheet ZIP64 metadata')
  const value = archive.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('[internal] unsafe spreadsheet ZIP64 metadata')
  return Number(value)
}

function readCentralDirectoryBounds(archive: Buffer): { start: number; end: number; count: number } {
  const endRecord = findEndOfCentralDirectory(archive)
  if (endRecord + 22 + archive.readUInt16LE(endRecord + 20) !== archive.length ||
      archive.readUInt16LE(endRecord + 4) !== 0 || archive.readUInt16LE(endRecord + 6) !== 0 ||
      archive.readUInt16LE(endRecord + 8) !== archive.readUInt16LE(endRecord + 10)) {
    throw new Error('[internal] malformed or split spreadsheet archive')
  }
  let size = archive.readUInt32LE(endRecord + 12)
  let start = archive.readUInt32LE(endRecord + 16)
  let count = archive.readUInt16LE(endRecord + 10)
  let footerStart = endRecord
  if (size === UINT32_MAX || start === UINT32_MAX || count === 0xffff) {
    const locator = endRecord - 20
    if (locator < 0 || archive.readUInt32LE(locator) !== ZIP64_END_LOCATOR ||
        archive.readUInt32LE(locator + 4) !== 0 || archive.readUInt32LE(locator + 16) !== 1) {
      throw new Error('[internal] spreadsheet archive has an invalid ZIP64 locator')
    }
    const zip64EndRecord = readSafeUint64(archive, locator + 8, endRecord)
    if (zip64EndRecord + 56 > locator || archive.readUInt32LE(zip64EndRecord) !== ZIP64_END_OF_CENTRAL_DIRECTORY ||
        archive.readUInt32LE(zip64EndRecord + 16) !== 0 || archive.readUInt32LE(zip64EndRecord + 20) !== 0 ||
        readSafeUint64(archive, zip64EndRecord + 4, locator) + zip64EndRecord + 12 !== locator ||
        readSafeUint64(archive, zip64EndRecord + 24, locator) !== readSafeUint64(archive, zip64EndRecord + 32, locator)) {
      throw new Error('[internal] spreadsheet archive has an invalid ZIP64 end record')
    }
    size = readSafeUint64(archive, zip64EndRecord + 40, locator)
    start = readSafeUint64(archive, zip64EndRecord + 48, locator)
    count = readSafeUint64(archive, zip64EndRecord + 32, locator)
    footerStart = zip64EndRecord
  }
  if (start + size !== footerStart || count > Math.floor(size / 46)) {
    throw new Error('[internal] spreadsheet central directory bounds are inconsistent')
  }
  return { start, end: start + size, count }
}

function applyZip64Sizes(archive: Buffer, extraStart: number, extraEnd: number, entry: ArchiveEntry): ArchiveEntry {
  if (
    entry.uncompressedSize !== UINT32_MAX &&
    entry.compressedSize !== UINT32_MAX &&
    entry.localHeaderOffset !== UINT32_MAX
  ) {
    return entry
  }
  for (let field = extraStart; field + 4 <= extraEnd; field += 4 + archive.readUInt16LE(field + 2)) {
    const fieldEnd = field + 4 + archive.readUInt16LE(field + 2)
    if (fieldEnd > extraEnd) throw new Error('[internal] truncated spreadsheet ZIP64 extra field')
    if (archive.readUInt16LE(field) !== ZIP64_EXTRA_FIELD) continue
    let value = field + 4
    const readNext = (): number => {
      const result = readSafeUint64(archive, value, fieldEnd)
      value += 8
      return result
    }
    const uncompressedSize = entry.uncompressedSize === UINT32_MAX ? readNext() : entry.uncompressedSize
    const compressedSize = entry.compressedSize === UINT32_MAX ? readNext() : entry.compressedSize
    const localHeaderOffset = entry.localHeaderOffset === UINT32_MAX ? readNext() : entry.localHeaderOffset
    return { ...entry, compressedSize, uncompressedSize, localHeaderOffset }
  }
  throw new Error('[internal] spreadsheet archive entry is missing its ZIP64 extra field')
}

function* archiveEntries(archive: Buffer): Generator<ArchiveEntry & { name: string }> {
  const { start, end, count } = readCentralDirectoryBounds(archive)
  let cursor = start
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('[internal] spreadsheet archive has a malformed central directory')
    }
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const nameStart = cursor + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > end || archive.readUInt16LE(cursor + 34) !== 0) {
      throw new Error('[internal] truncated or split spreadsheet central directory entry')
    }
    yield {
      ...applyZip64Sizes(archive, nameStart + nameLength, nameStart + nameLength + extraLength, {
        flags: archive.readUInt16LE(cursor + 8),
        method: archive.readUInt16LE(cursor + 10),
        compressedSize: archive.readUInt32LE(cursor + 20),
        uncompressedSize: archive.readUInt32LE(cursor + 24),
        localHeaderOffset: archive.readUInt32LE(cursor + 42),
      }),
      name: archive.toString('utf8', nameStart, nameStart + nameLength),
    }
    cursor = next
  }
  if (cursor !== end) throw new Error('[internal] spreadsheet central directory count is inconsistent')
}

function findEntry(archive: Buffer, name: string): ArchiveEntry | null {
  let found: ArchiveEntry | null = null
  for (const entry of archiveEntries(archive)) if (entry.name === name) found = entry
  return found
}

function entryTooLargeError(maxBytes: number, cause?: unknown): RangeError {
  return Object.assign(new RangeError(`[internal] spreadsheet archive entry exceeds ${maxBytes} bytes`, { cause }), {
    code: SPREADSHEET_ENTRY_TOO_LARGE,
  })
}

function inflateWithinLimit(compressed: Buffer, maxBytes: number): Buffer {
  try {
    return inflateRawSync(compressed, { maxOutputLength: maxBytes })
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') throw entryTooLargeError(maxBytes, error)
    throw error
  }
}

export async function assertXlsxArchiveWithinLimit(archive: Buffer, maxBytes: number): Promise<void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('[internal] invalid spreadsheet byte budget')
  if (archive.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) {
    throw Object.assign(new Error('[internal] spreadsheet is an encrypted (OLE2) container'), { code: SPREADSHEET_ENCRYPTED })
  }
  let expandedBytes = 0
  for (const entry of archiveEntries(archive)) {
    if (entry.flags & 0x0041) {
      throw Object.assign(new Error('[internal] spreadsheet ZIP entry is encrypted'), { code: SPREADSHEET_ENCRYPTED })
    }
    const offset = entry.localHeaderOffset
    if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== LOCAL_FILE_HEADER ||
        archive.readUInt16LE(offset + 8) !== entry.method) {
      throw new Error('[internal] spreadsheet archive has an invalid local header')
    }
    if ((entry.flags & 8) && entry.compressedSize === 0) {
      throw new Error('[internal] spreadsheet entry has an ambiguous data descriptor')
    }
    const dataStart = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28)
    const dataEnd = dataStart + entry.compressedSize
    if (dataStart > archive.length || dataEnd > archive.length) throw new Error('[internal] spreadsheet ZIP entry is truncated')
    const remaining = maxBytes - expandedBytes
    if (entry.uncompressedSize > remaining) throw entryTooLargeError(maxBytes)
    const compressed = archive.subarray(dataStart, dataEnd)
    let actualBytes = 0
    if (entry.method === STORED) {
      actualBytes = compressed.length
      if (actualBytes > remaining) throw entryTooLargeError(maxBytes)
    } else if (entry.method === DEFLATED) {
      const inflater = createInflateRaw({ chunkSize: 16 * 1024 })
      await pipeline(Readable.from([compressed]), inflater, new Writable({
        write(chunk: Buffer, _encoding, callback) {
          actualBytes += chunk.length
          callback(actualBytes > remaining ? entryTooLargeError(maxBytes) : undefined)
        },
      }))
      if (inflater.bytesWritten !== compressed.length) throw new Error('[internal] spreadsheet deflate payload has trailing bytes')
    } else {
      throw new Error('[internal] unsupported spreadsheet ZIP compression')
    }
    if (actualBytes !== entry.uncompressedSize) throw new Error('[internal] spreadsheet ZIP expanded size is inconsistent')
    expandedBytes += actualBytes
  }
}

function readEntryText(archive: Buffer, name: string, maxBytes: number): string | null {
  const entry = findEntry(archive, name)
  if (!entry) return null
  if (archive.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_HEADER) {
    throw new Error('[internal] spreadsheet archive has a malformed local file header')
  }
  const dataStart =
    entry.localHeaderOffset + 30 + archive.readUInt16LE(entry.localHeaderOffset + 26) + archive.readUInt16LE(entry.localHeaderOffset + 28)
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) throw new Error('[internal] spreadsheet archive entry is truncated')
  const compressed = archive.subarray(dataStart, dataEnd)
  if (entry.method === DEFLATED) return inflateWithinLimit(compressed, maxBytes).toString('utf8')
  if (entry.method !== STORED) throw new Error(`[internal] unsupported spreadsheet compression method ${entry.method}`)
  if (compressed.length > maxBytes) throw entryTooLargeError(maxBytes)
  return compressed.toString('utf8')
}

function decodeXmlText(value: string): string {
  return value.replace(XML_ENTITY, (match, decimal?: string, hex?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named]
    const codePoint = decimal ? Number(decimal) : Number.parseInt(hex ?? '', 16)
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match
  })
}

function readAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const attribute = /\s*([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y
  for (let match = attribute.exec(source); match; match = attribute.exec(source)) {
    attributes.set(match[1], decodeXmlText(match[2] ?? match[3] ?? ''))
  }
  return attributes
}

function readRelationshipId(attributes: Map<string, string>): string {
  const explicit = attributes.get('r:id') ?? attributes.get('R:id')
  if (explicit !== undefined) return explicit
  for (const [name, value] of attributes) {
    if (name.endsWith(':id') && value.startsWith('rId')) return value
  }
  return ''
}

function resolveWorkbookPath(archive: Buffer, maxBytes: number): string {
  const relationships = readEntryText(archive, PACKAGE_RELATIONSHIPS_PATH, maxBytes)
  if (relationships === null) throw new Error('[internal] spreadsheet archive has no package relationships')
  for (const [, source] of relationships.matchAll(RELATIONSHIP_TAG)) {
    const attributes = readAttributes(source)
    const type = attributes.get('Type')
    const target = attributes.get('Target')
    if (type && target && OFFICE_DOCUMENT_RELATIONSHIP.test(type)) return target.replace(/^\/+/, '')
  }
  throw new Error('[internal] spreadsheet archive has no workbook relationship')
}

/**
 * Sheet names in workbook order, read from the package relationships and the workbook part only,
 * so no other part of an untrusted archive is decompressed to learn them. A sheet entry without a
 * name or a relationship id is skipped, as the streaming reader skips it, so the list lines up with
 * the reader's sheet indexes.
 */
export function readXlsxSheetNames(archive: Buffer, maxBytes: number): string[] {
  if (archive.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) {
    throw Object.assign(new Error('[internal] spreadsheet is an encrypted (OLE2) container'), { code: SPREADSHEET_ENCRYPTED })
  }
  const workbookPath = resolveWorkbookPath(archive, maxBytes)
  const workbook = readEntryText(archive, workbookPath, maxBytes)
  if (workbook === null) throw new Error('[internal] spreadsheet archive has no workbook part')
  const names: string[] = []
  for (const [, source] of workbook.matchAll(SHEET_TAG)) {
    const attributes = readAttributes(source)
    const name = attributes.get('name') ?? ''
    if (name && readRelationshipId(attributes)) names.push(name)
  }
  return names
}
