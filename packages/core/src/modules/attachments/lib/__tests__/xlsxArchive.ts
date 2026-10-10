import { crc32, deflateRawSync } from 'zlib'

export type ArchiveEntryInput = {
  name: string
  content: string | Buffer
  compression?: 'stored' | 'deflate' | 'corrupt'
}

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50
const ZIP64_END_LOCATOR = 0x07064b50
const UTF8_NAMES_FLAG = 0x0800
const UINT16_MAX = 0xffff
const UINT32_MAX = 0xffffffff
const CORRUPT_DEFLATE_DATA = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

export const OFFICE_DOCUMENT_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

export function packageRelationships(workbookTarget: string): ArchiveEntryInput {
  return {
    name: '_rels/.rels',
    content:
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_RELATIONSHIP}" Target="${workbookTarget}"/></Relationships>`,
  }
}

function compress(raw: Buffer, compression: ArchiveEntryInput['compression']): { method: number; data: Buffer } {
  if (compression === 'deflate') return { method: 8, data: deflateRawSync(raw) }
  if (compression === 'corrupt') return { method: 8, data: CORRUPT_DEFLATE_DATA }
  return { method: 0, data: raw }
}

function zip64ExtraField(uncompressedSize: number, compressedSize: number, localHeaderOffset: number): Buffer {
  const field = Buffer.alloc(28)
  field.writeUInt16LE(0x0001, 0)
  field.writeUInt16LE(24, 2)
  field.writeBigUInt64LE(BigInt(uncompressedSize), 4)
  field.writeBigUInt64LE(BigInt(compressedSize), 12)
  field.writeBigUInt64LE(BigInt(localHeaderOffset), 20)
  return field
}

function zip64EndRecords(entryCount: number, centralSize: number, centralOffset: number): Buffer[] {
  const record = Buffer.alloc(56)
  record.writeUInt32LE(ZIP64_END_OF_CENTRAL_DIRECTORY, 0)
  record.writeBigUInt64LE(BigInt(record.length - 12), 4)
  record.writeUInt16LE(45, 12)
  record.writeUInt16LE(45, 14)
  record.writeBigUInt64LE(BigInt(entryCount), 24)
  record.writeBigUInt64LE(BigInt(entryCount), 32)
  record.writeBigUInt64LE(BigInt(centralSize), 40)
  record.writeBigUInt64LE(BigInt(centralOffset), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(ZIP64_END_LOCATOR, 0)
  locator.writeBigUInt64LE(BigInt(centralOffset + centralSize), 8)
  locator.writeUInt32LE(1, 16)
  return [record, locator]
}

export function buildArchive(entries: ArchiveEntryInput[], options: { zip64?: boolean } = {}): Buffer {
  const zip64 = options.zip64 === true
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const raw = typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content
    const { method, data } = compress(raw, entry.compression)
    const name = Buffer.from(entry.name, 'utf8')
    const checksum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_NAMES_FLAG, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, data)

    const extra = zip64 ? zip64ExtraField(raw.length, data.length, offset) : Buffer.alloc(0)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_DIRECTORY_ENTRY, 0)
    central.writeUInt16LE(45, 4)
    central.writeUInt16LE(zip64 ? 45 : 20, 6)
    central.writeUInt16LE(UTF8_NAMES_FLAG, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(zip64 ? UINT32_MAX : data.length, 20)
    central.writeUInt32LE(zip64 ? UINT32_MAX : raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt32LE(zip64 ? UINT32_MAX : offset, 42)
    centralParts.push(central, name, extra)

    offset += local.length + name.length + data.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
  end.writeUInt16LE(zip64 ? UINT16_MAX : entries.length, 8)
  end.writeUInt16LE(zip64 ? UINT16_MAX : entries.length, 10)
  end.writeUInt32LE(zip64 ? UINT32_MAX : centralDirectory.length, 12)
  end.writeUInt32LE(zip64 ? UINT32_MAX : offset, 16)
  const zip64Records = zip64 ? zip64EndRecords(entries.length, centralDirectory.length, offset) : []
  return Buffer.concat([...localParts, centralDirectory, ...zip64Records, end])
}
