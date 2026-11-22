/** @jest-environment node */
import { deflateRawSync } from 'node:zlib'
import { isSpreadsheetAccepted, parseCsv, parseXlsx, sheetToObjects } from '../spreadsheet'

const encoder = new TextEncoder()

/** A minimal single-worksheet .xlsx, built by hand so the reader has real bytes to prove itself on. */
function buildXlsx(sheetXml: string, sharedStringsXml: string | null): Uint8Array {
  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) },
  ]
  if (sharedStringsXml) {
    files.push({ name: 'xl/sharedStrings.xml', data: encoder.encode(sharedStringsXml) })
  }

  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(file.data)))
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(8, 8, true)
    localView.setUint32(20, compressed.length, true)
    localView.setUint32(24, file.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    localParts.push(local, compressed)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(20, compressed.length, true)
    centralView.setUint32(24, file.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length + compressed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, files.length, true)
  eocdView.setUint16(10, files.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, offset, true)

  const total = localParts.reduce((sum, part) => sum + part.length, 0) + centralSize + eocd.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

describe('csv parsing', () => {
  it('handles quoted delimiters, embedded newlines and doubled quotes', () => {
    const rows = parseCsv('a,b\n"1,2","line\nbreak ""quoted"""\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['1,2', 'line\nbreak "quoted"'],
    ])
  })

  it('detects the delimiter a hand-written export uses', () => {
    expect(parseCsv('a;b;c\n1;2;3\n')[1]).toEqual(['1', '2', '3'])
    expect(parseCsv('a\tb\n1\t2\n')[1]).toEqual(['1', '2'])
  })

  it('strips a BOM and drops blank rows', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('accepts the file extensions the picker offers', () => {
    expect(isSpreadsheetAccepted('rates.csv')).toBe(true)
    expect(isSpreadsheetAccepted('rates.XLSX')).toBe(true)
    expect(isSpreadsheetAccepted('rates.pdf')).toBe(false)
  })
})

describe('sheetToObjects', () => {
  it('maps the header row onto trimmed values and skips empty rows', () => {
    const objects = sheetToObjects([
      ['origin', ' destination ', 'rateAmount'],
      ['Riyadh', 'Dammam', '450'],
      ['', '', ''],
    ])
    expect(objects).toEqual([{ origin: 'Riyadh', destination: 'Dammam', rateAmount: '450' }])
  })
})

describe('xlsx parsing', () => {
  it('reads shared strings, inline strings and numbers from the first worksheet', async () => {
    const sharedStrings = '<sst><si><t>Riyadh</t></si><si><t>Dammam</t></si></sst>'
    const sheet = [
      '<worksheet><sheetData>',
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>450</t></is></c></row>',
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Jeddah</t></is></c><c r="C2"><v>517.5</v></c></row>',
      '</sheetData></worksheet>',
    ].join('')
    const rows = await parseXlsx(buildXlsx(sheet, sharedStrings))
    expect(rows).toEqual([
      ['Riyadh', 'Dammam', '450'],
      ['Jeddah', '', '517.5'],
    ])
  })

  it('refuses a file that is not a zip', async () => {
    await expect(parseXlsx(encoder.encode('not a zip at all'))).rejects.toThrow(/not a readable \.xlsx/)
  })
})
