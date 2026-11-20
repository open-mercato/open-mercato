/** @jest-environment node */
import { assertXlsxArchiveWithinLimit, SPREADSHEET_ENTRY_TOO_LARGE } from '../xlsxSheetNames'
import { buildArchive } from './xlsxArchive'

const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02])

function centralOffset(archive: Buffer): number {
  return archive.indexOf(centralSignature)
}

describe('assertXlsxArchiveWithinLimit', () => {
  it.each(['stored', 'deflate'] as const)('accepts exactly the expanded byte budget for %s entries', async (compression) => {
    const archive = buildArchive([
      { name: 'one', content: 'a'.repeat(400), compression },
      { name: 'two', content: 'b'.repeat(600), compression },
    ])

    await expect(assertXlsxArchiveWithinLimit(archive, 1000)).resolves.toBeUndefined()
    await expect(assertXlsxArchiveWithinLimit(archive, 999)).rejects.toMatchObject({ code: SPREADSHEET_ENTRY_TOO_LARGE })
  })

  it('counts stored, deflated, duplicate and unused parts against one archive-wide budget', async () => {
    const archive = buildArchive([
      { name: 'xl/sharedStrings.xml', content: 'a'.repeat(400) },
      { name: 'xl/sharedStrings.xml', content: 'b'.repeat(400), compression: 'deflate' },
      { name: 'xl/media/unused.bin', content: 'c'.repeat(400) },
    ])

    await expect(assertXlsxArchiveWithinLimit(archive, 1199)).rejects.toMatchObject({ code: SPREADSHEET_ENTRY_TOO_LARGE })
    await expect(assertXlsxArchiveWithinLimit(archive, 1200)).resolves.toBeUndefined()
  })

  it.each(['stored', 'deflate'] as const)('counts actual %s bytes when the declared expanded size is zero', async (compression) => {
    const archive = buildArchive([{ name: 'payload', content: 'x'.repeat(8 * 1024 * 1024), compression }])
    archive.writeUInt32LE(0, centralOffset(archive) + 24)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toMatchObject({ code: SPREADSHEET_ENTRY_TOO_LARGE })
  })

  it('rejects understated expanded sizes even when their actual output fits', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content', compression: 'deflate' }])
    archive.writeUInt32LE(1, centralOffset(archive) + 24)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('expanded size is inconsistent')
  })

  it.each(['stored', 'deflate'] as const)('accepts ZIP64 %s entries and applies the same aggregate cap', async (compression) => {
    const archive = buildArchive([
      { name: 'one', content: 'a'.repeat(600), compression },
      { name: 'two', content: 'b'.repeat(600), compression },
    ], { zip64: true })

    await expect(assertXlsxArchiveWithinLimit(archive, 1200)).resolves.toBeUndefined()
    await expect(assertXlsxArchiveWithinLimit(archive, 1199)).rejects.toMatchObject({ code: SPREADSHEET_ENTRY_TOO_LARGE })
  })

  it('supports descriptor flags when the central directory supplies exact payload sizes', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content', compression: 'deflate' }])
    archive.writeUInt16LE(8, centralOffset(archive) + 8)
    archive.writeUInt16LE(8, 6)
    archive.writeUInt32LE(0, 18)
    archive.writeUInt32LE(0, 22)

    await expect(assertXlsxArchiveWithinLimit(archive, 7)).resolves.toBeUndefined()
  })

  it('rejects zero-size descriptor metadata instead of allowing the parser to find an uncounted payload', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'x'.repeat(2000) }])
    const central = centralOffset(archive)
    archive.writeUInt16LE(8, central + 8)
    archive.writeUInt32LE(0, central + 20)
    archive.writeUInt32LE(0, central + 24)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('ambiguous data descriptor')
  })

  it.each([0, 2])('rejects an entry count of %s that disagrees with the directory', async (count) => {
    const archive = buildArchive([{ name: 'payload', content: 'content' }])
    archive.writeUInt16LE(count, archive.length - 14)
    archive.writeUInt16LE(count, archive.length - 12)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('inconsistent')
  })

  it('rejects a central-directory size that hides bytes from the guard', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content' }])
    archive.writeUInt32LE(46, archive.length - 10)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('bounds are inconsistent')
  })

  it('rejects unsafe ZIP64 sizes', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content' }], { zip64: true })
    archive.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, centralOffset(archive) + 46 + 'payload'.length + 4)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('unsafe spreadsheet ZIP64 metadata')
  })

  it('rejects ZIP64 fields whose values spill past the extra-field boundary', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content' }], { zip64: true })
    archive.writeUInt16LE(8, centralOffset(archive) + 46 + 'payload'.length + 2)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('truncated spreadsheet ZIP64 metadata')
  })

  it('rejects truncated local payloads', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content' }])
    archive.writeUInt32LE(archive.length, centralOffset(archive) + 20)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('truncated')
  })

  it('rejects unsupported compression before workbook parsing', async () => {
    const archive = buildArchive([{ name: 'payload', content: 'content' }])
    archive.writeUInt16LE(12, 8)
    archive.writeUInt16LE(12, centralOffset(archive) + 10)

    await expect(assertXlsxArchiveWithinLimit(archive, 1024)).rejects.toThrow('unsupported spreadsheet ZIP compression')
  })
})
