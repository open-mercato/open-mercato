import { inflateRawSync } from 'zlib'

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

function readCentralDirectoryBounds(archive: Buffer): { start: number; end: number } {
  const endRecord = findEndOfCentralDirectory(archive)
  const size = archive.readUInt32LE(endRecord + 12)
  const start = archive.readUInt32LE(endRecord + 16)
  if (size !== UINT32_MAX && start !== UINT32_MAX) return { start, end: start + size }
  const locator = endRecord - 20
  if (locator < 0 || archive.readUInt32LE(locator) !== ZIP64_END_LOCATOR) {
    throw new Error('[internal] spreadsheet archive has no ZIP64 end of central directory locator')
  }
  const zip64EndRecord = Number(archive.readBigUInt64LE(locator + 8))
  if (archive.readUInt32LE(zip64EndRecord) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
    throw new Error('[internal] spreadsheet archive has no ZIP64 end of central directory record')
  }
  const zip64Start = Number(archive.readBigUInt64LE(zip64EndRecord + 48))
  return { start: zip64Start, end: zip64Start + Number(archive.readBigUInt64LE(zip64EndRecord + 40)) }
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
    if (archive.readUInt16LE(field) !== ZIP64_EXTRA_FIELD) continue
    let value = field + 4
    const readNext = (): number => {
      const result = Number(archive.readBigUInt64LE(value))
      value += 8
      return result
    }
    const uncompressedSize = entry.uncompressedSize === UINT32_MAX ? readNext() : entry.uncompressedSize
    const compressedSize = entry.compressedSize === UINT32_MAX ? readNext() : entry.compressedSize
    const localHeaderOffset = entry.localHeaderOffset === UINT32_MAX ? readNext() : entry.localHeaderOffset
    return { method: entry.method, compressedSize, uncompressedSize, localHeaderOffset }
  }
  throw new Error('[internal] spreadsheet archive entry is missing its ZIP64 extra field')
}

function findEntry(archive: Buffer, name: string): ArchiveEntry | null {
  const { start, end } = readCentralDirectoryBounds(archive)
  let found: ArchiveEntry | null = null
  let cursor = start
  while (cursor < end) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('[internal] spreadsheet archive has a malformed central directory')
    }
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const nameStart = cursor + 46
    if (archive.toString('utf8', nameStart, nameStart + nameLength) === name) {
      found = applyZip64Sizes(archive, nameStart + nameLength, nameStart + nameLength + extraLength, {
        method: archive.readUInt16LE(cursor + 10),
        compressedSize: archive.readUInt32LE(cursor + 20),
        uncompressedSize: archive.readUInt32LE(cursor + 24),
        localHeaderOffset: archive.readUInt32LE(cursor + 42),
      })
    }
    cursor = nameStart + nameLength + extraLength + commentLength
  }
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

function readAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes)
  if (!match) return null
  return decodeXmlText(match[1] ?? match[2] ?? '')
}

function resolveWorkbookPath(archive: Buffer, maxBytes: number): string {
  const relationships = readEntryText(archive, PACKAGE_RELATIONSHIPS_PATH, maxBytes)
  if (relationships === null) throw new Error('[internal] spreadsheet archive has no package relationships')
  for (const [, attributes] of relationships.matchAll(RELATIONSHIP_TAG)) {
    const type = readAttribute(attributes, 'Type')
    const target = readAttribute(attributes, 'Target')
    if (type && target && OFFICE_DOCUMENT_RELATIONSHIP.test(type)) return target.replace(/^\/+/, '')
  }
  throw new Error('[internal] spreadsheet archive has no workbook relationship')
}

/**
 * Sheet names in workbook order, read from the package relationships and the workbook part only,
 * so no other part of an untrusted archive is decompressed to learn them.
 */
export function readXlsxSheetNames(archive: Buffer, maxBytes: number): string[] {
  if (archive.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) {
    throw Object.assign(new Error('[internal] spreadsheet is an encrypted (OLE2) container'), { code: SPREADSHEET_ENCRYPTED })
  }
  const workbookPath = resolveWorkbookPath(archive, maxBytes)
  const workbook = readEntryText(archive, workbookPath, maxBytes)
  if (workbook === null) throw new Error('[internal] spreadsheet archive has no workbook part')
  return Array.from(workbook.matchAll(SHEET_TAG), ([, attributes]) => readAttribute(attributes, 'name') ?? '')
}
