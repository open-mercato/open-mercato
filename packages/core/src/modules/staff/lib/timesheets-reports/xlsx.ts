/**
 * A minimal, dependency-free single-sheet XLSX writer.
 *
 * US-G4 asks for CSV *and* XLSX because back-offices differ: CSV is what an
 * import script wants, XLSX is what an accountant opens. The repository has no
 * spreadsheet library and adding a production dependency is an "ask first"
 * change, so this writes the format directly — an XLSX file is a ZIP of five
 * small XML parts, and Node ships both DEFLATE (`node:zlib`) and everything else
 * needed.
 *
 * Numbers are written as numbers (`<v>`), not as text, so a column of amounts
 * sums in Excel rather than needing a re-type. Strings go in as inline strings
 * rather than through a shared-strings table: it costs a few bytes on repeated
 * values and removes an entire index that could go out of sync.
 */

import { deflateRawSync } from 'node:zlib'

export type XlsxCell = string | number | null | undefined

export type XlsxSheet = {
  name: string
  rows: XlsxCell[][]
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = -1
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel refuses a file containing raw control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** `0 -> A`, `26 -> AA`. Spreadsheet columns are bijective base-26. */
export function columnName(index: number): string {
  let name = ''
  let remaining = index + 1
  while (remaining > 0) {
    const rest = (remaining - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    remaining = Math.floor((remaining - 1) / 26)
  }
  return name
}

function cellXml(value: XlsxCell, reference: string): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
}

export function buildSheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${rowIndex + 1}`)).join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
}

type ZipEntry = { name: string; data: Buffer }

function zipEntries(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30 + nameBuffer.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    // Bit 11 marks the filename as UTF-8; all names here are ASCII, but the flag
    // costs nothing and keeps the file honest if one ever is not.
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuffer.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuffer.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuffer.copy(central, 46)

    locals.push(local, compressed)
    centrals.push(central)
    offset += local.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralDirectory, end])
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function buildXlsx(sheet: XlsxSheet): Buffer {
  const safeName = escapeXml(sheet.name.slice(0, 31) || 'Sheet1')
  const parts: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets>` +
          '</workbook>',
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(buildSheetXml(sheet), 'utf8') },
  ]

  return zipEntries(parts)
}
