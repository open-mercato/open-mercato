import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'

const inflate = promisify(inflateRaw)
const END_OF_DIRECTORY = Buffer.from('504b0506', 'hex')
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50

export async function fitsDocxExpansionBudget(archive: Buffer, maxBytes: number): Promise<boolean> {
  const directoryEnd = archive.lastIndexOf(END_OF_DIRECTORY)
  if (directoryEnd < 0 || directoryEnd + 22 > archive.length) return false

  const entryCount = archive.readUInt16LE(directoryEnd + 10)
  const directorySize = archive.readUInt32LE(directoryEnd + 12)
  const directoryStart = archive.readUInt32LE(directoryEnd + 16)
  const commentLength = archive.readUInt16LE(directoryEnd + 20)
  if (archive.readUInt32LE(directoryEnd + 4) !== 0
    || archive.readUInt16LE(directoryEnd + 8) !== entryCount
    || entryCount === 0xffff
    || directoryEnd + 22 + commentLength !== archive.length
    || directoryStart + directorySize !== directoryEnd) return false

  let offset = directoryStart
  let remaining = maxBytes
  let remainingCompressed = directoryStart
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > directoryEnd || archive.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) return false

    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const expandedSize = archive.readUInt32LE(offset + 24)
    const localOffset = archive.readUInt32LE(offset + 42)
    if ((flags & 1) !== 0 || archive.readUInt16LE(offset + 34) !== 0
      || expandedSize > remaining || expandedSize === 0xffffffff
      || localOffset + 30 > directoryStart
      || archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) return false

    const dataStart = localOffset + 30
      + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28)
    if (compressedSize > remainingCompressed || dataStart + compressedSize > directoryStart) return false

    if (method === 0) {
      if (compressedSize !== expandedSize) return false
    } else if (method === 8) {
      const compressed = archive.subarray(dataStart, dataStart + compressedSize)
      const expanded = await inflate(compressed, { maxOutputLength: Math.max(1, expandedSize) })
      if (expanded.length !== expandedSize) return false
    } else {
      return false
    }

    remaining -= expandedSize
    remainingCompressed -= compressedSize
    offset += 46 + archive.readUInt16LE(offset + 28)
      + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32)
  }

  return offset === directoryEnd
}
