/**
 * Spreadsheet reading for the rate importer, with no third-party dependency.
 *
 * CSV is parsed directly. An `.xlsx` file is a ZIP of XML parts, and the browser
 * (and Node ≥20) ships `DecompressionStream('deflate-raw')`, so a small ZIP
 * reader plus a targeted XML scan reads the first worksheet — enough for the
 * operator's rate sheet, and nothing to audit or upgrade. The alternative, an
 * npm parser, was avoided deliberately: the module ships in a template that
 * users run, and a spreadsheet dependency there is a standing supply-chain and
 * bundle-size cost for one dialog.
 *
 * Scope is deliberately narrow: the first worksheet, values only (no formulas
 * evaluation, no styles, no merged cells).
 */

export type SheetRow = string[]

const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_LOCAL_SIGNATURE = 0x04034b50

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function columnIndexFromRef(reference: string): number {
  const letters = reference.replace(/[^A-Z]/gi, '').toUpperCase()
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** RFC-4180-ish CSV: quotes protect delimiters and newlines, doubled quotes escape. */
export function parseCsv(text: string, delimiter?: string): SheetRow[] {
  const source = text.replace(/^﻿/, '')
  const resolvedDelimiter = delimiter ?? detectDelimiter(source)
  const rows: SheetRow[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === resolvedDelimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((line) => line.some((cell) => cell.trim().length > 0))
}

function detectDelimiter(source: string): string {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = -1
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

type ZipEntry = { name: string; method: number; compressedSize: number; localHeaderOffset: number }

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let index = bytes.length - 22; index >= 0 && index >= bytes.length - 66_000; index -= 1) {
    if (view.getUint32(index, true) === ZIP_EOCD_SIGNATURE) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('The file is not a readable .xlsx (no ZIP directory).')
  const entryCount = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const streamCtor = (globalThis as { DecompressionStream?: new (format: string) => DecompressionStream }).DecompressionStream
  if (!streamCtor) throw new Error('This browser cannot read .xlsx files — save the sheet as CSV instead.')
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new streamCtor('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(entry.localHeaderOffset, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error('The .xlsx file is damaged (bad entry header).')
  }
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true)
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return decodeUtf8(data)
  if (entry.method !== 8) throw new Error('The .xlsx file uses an unsupported compression method.')
  return decodeUtf8(await inflateRaw(data))
}

function readXmlText(fragment: string): string {
  let value = ''
  const tagPattern = /<t[^>]*>([\s\S]*?)<\/t>|<t[^>]*\/>/g
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(fragment)) !== null) {
    if (match[1]) value += match[1]
  }
  return decodeXmlEntities(value)
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const values: string[] = []
  const itemPattern = /<si>([\s\S]*?)<\/si>/g
  let match: RegExpExecArray | null
  while ((match = itemPattern.exec(xml)) !== null) values.push(readXmlText(match[1]))
  return values
}

function readWorksheet(xml: string, sharedStrings: string[]): SheetRow[] {
  const rows: SheetRow[] = []
  const rowPattern = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const cells: SheetRow = []
    const cellPattern = /<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      const attributes = cellMatch[1] ?? ''
      const inner = cellMatch[2] ?? ''
      const referenceMatch = /r="([A-Z]+\d+)"/.exec(attributes)
      const index = referenceMatch ? columnIndexFromRef(referenceMatch[1]) : cells.length
      const typeMatch = /t="([^"]+)"/.exec(attributes)
      const type = typeMatch?.[1] ?? 'n'
      let value = ''
      if (type === 's') {
        const valueMatch = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)
        const sharedIndex = valueMatch ? Number(valueMatch[1]) : Number.NaN
        value = Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? '') : ''
      } else if (type === 'inlineStr') {
        value = readXmlText(inner)
      } else {
        const valueMatch = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)
        value = valueMatch ? decodeXmlEntities(valueMatch[1]) : ''
        if (type === 'b') value = value === '1' ? 'true' : 'false'
      }
      while (cells.length < index) cells.push('')
      cells[index] = value
    }
    rows.push(cells)
  }
  return rows.filter((line) => line.some((cell) => cell.trim().length > 0))
}

export async function parseXlsx(bytes: Uint8Array): Promise<SheetRow[]> {
  const entries = readZipEntries(bytes)
  const sharedEntry = entries.find((entry) => entry.name === 'xl/sharedStrings.xml') ?? null
  const sheetEntry = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml')
    ?? entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
  if (!sheetEntry) throw new Error('The .xlsx file has no worksheet.')
  const [sharedXml, sheetXml] = await Promise.all([
    sharedEntry ? readZipEntry(bytes, sharedEntry) : Promise.resolve(null),
    readZipEntry(bytes, sheetEntry),
  ])
  return readWorksheet(sheetXml, readSharedStrings(sharedXml))
}

export function isSpreadsheetAccepted(fileName: string): boolean {
  return /\.(csv|tsv|txt|xlsx)$/i.test(fileName)
}

export async function readSpreadsheetFile(file: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<SheetRow[]> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(bytes)
  const text = decodeUtf8(bytes)
  return parseCsv(text, /\.tsv$/i.test(file.name) ? '\t' : undefined)
}

/** First row becomes the header; header names are trimmed and lower-cased. */
export function sheetToObjects(rows: SheetRow[]): Array<Record<string, string>> {
  if (rows.length === 0) return []
  const headers = rows[0].map((header) => header.trim())
  return rows.slice(1).flatMap((row) => {
    const record: Record<string, string> = {}
    let filled = false
    headers.forEach((header, index) => {
      if (!header) return
      const value = (row[index] ?? '').trim()
      record[header] = value
      if (value.length) filled = true
    })
    return filled ? [record] : []
  })
}
