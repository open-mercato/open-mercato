import { TextDecoder } from 'util'

export type CsvPreviewRow = Record<string, string | null>

export type CsvPreview = {
  headers: string[]
  sampleRows: CsvPreviewRow[]
  totalRows: number
  delimiter: ',' | ';'
  encoding: 'utf-8'
}

export type CsvDocument = {
  headers: string[]
  rows: CsvPreviewRow[]
  totalRows: number
  delimiter: ',' | ';'
  encoding: 'utf-8'
}

export type CsvStreamMetadata = {
  headers: string[]
  totalRows: number
  delimiter: ',' | ';'
  encoding: 'utf-8'
}

export type CsvDocumentBatch = {
  headers: string[]
  rows: CsvPreviewRow[]
  rowStart: number
  nextOffset: number
  delimiter: ',' | ';'
  encoding: 'utf-8'
}

type ParseCsvPreviewOptions = {
  maxRows?: number
}

type ParseCsvBatchOptions = {
  batchSize: number
  startOffset?: number
}

type CsvInputChunk = Buffer | Uint8Array | string

const CSV_DELIMITER_PROBE_ROWS = 5
const CSV_DELIMITER_PROBE_MAX_CHARS = 64 * 1024

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function countFields(line: string, delimiter: ',' | ';'): number {
  let count = 1
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && character === delimiter) {
      count += 1
    }
  }

  return count
}

export function detectCsvDelimiter(text: string): ',' | ';' {
  const normalized = stripUtf8Bom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)

  if (lines.length === 0) return ','

  const commaScore = lines.reduce((accumulator, line) => accumulator + countFields(line, ','), 0)
  const semicolonScore = lines.reduce((accumulator, line) => accumulator + countFields(line, ';'), 0)

  return semicolonScore > commaScore ? ';' : ','
}

export function parseCsvText(text: string, delimiter: ',' | ';'): string[][] {
  const normalized = stripUtf8Bom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentValue = ''
  let inQuotes = false

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]

    if (character === '"') {
      if (inQuotes && normalized[index + 1] === '"') {
        currentValue += '"'
        index += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && character === delimiter) {
      currentRow.push(currentValue)
      currentValue = ''
      continue
    }

    if (!inQuotes && character === '\n') {
      currentRow.push(currentValue)
      const isMeaningfulRow = currentRow.some((value) => value.trim().length > 0)
      if (isMeaningfulRow) {
        rows.push(currentRow)
      }
      currentRow = []
      currentValue = ''
      continue
    }

    currentValue += character
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue)
    const isMeaningfulRow = currentRow.some((value) => value.trim().length > 0)
    if (isMeaningfulRow) {
      rows.push(currentRow)
    }
  }

  return rows
}

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((header, index) => {
    const trimmed = header.trim()
    return trimmed.length > 0 ? trimmed : `Column ${index + 1}`
  })
}

function rowsToObjects(headers: string[], rows: string[][], maxRows: number): CsvPreviewRow[] {
  return rows.slice(0, maxRows).map((row) => {
    const record: CsvPreviewRow = {}
    headers.forEach((header, index) => {
      const value = row[index]
      record[header] = typeof value === 'string' && value.length > 0 ? value : null
    })
    return record
  })
}

async function createCsvRowStream(input: AsyncIterable<CsvInputChunk>): Promise<{
  delimiter: ',' | ';'
  rows: AsyncIterable<string[]>
}> {
  const iterator = input[Symbol.asyncIterator]()
  const decoder = new TextDecoder('utf-8')
  const prefixTexts: string[] = []
  let probeText = ''

  while (probeText.length < CSV_DELIMITER_PROBE_MAX_CHARS) {
    const next = await iterator.next()
    if (next.done) break

    const text = typeof next.value === 'string' ? next.value : decoder.decode(next.value, { stream: true })
    prefixTexts.push(text)
    probeText += text

    if (parseCsvText(probeText, ',').length >= CSV_DELIMITER_PROBE_ROWS) {
      break
    }
  }

  const delimiter = detectCsvDelimiter(probeText)

  async function* decodedChunks(): AsyncIterable<string> {
    for (const text of prefixTexts) {
      yield text
    }
    while (true) {
      const next = await iterator.next()
      if (next.done) break
      yield typeof next.value === 'string' ? next.value : decoder.decode(next.value, { stream: true })
    }
    const finalChunk = decoder.decode()
    if (finalChunk.length > 0) {
      yield finalChunk
    }
  }

  return {
    delimiter,
    rows: parseCsvRowsFromTextChunks(decodedChunks(), delimiter),
  }
}

async function* parseCsvRowsFromTextChunks(
  chunks: AsyncIterable<string>,
  delimiter: ',' | ';',
): AsyncIterable<string[]> {
  let currentRow: string[] = []
  let currentValue = ''
  let inQuotes = false
  let isFirstChunk = true
  let previousWasCarriageReturn = false
  let pendingQuote = false
  let pendingQuoteWasInQuotes = false

  const completeRow = (): string[] | null => {
    currentRow.push(currentValue)
    const completedRow = currentRow
    currentRow = []
    currentValue = ''
    return completedRow.some((value) => value.trim().length > 0) ? completedRow : null
  }

  for await (const chunk of chunks) {
    const text = isFirstChunk ? stripUtf8Bom(chunk) : chunk
    isFirstChunk = false

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]

      if (pendingQuote) {
        pendingQuote = false
        if (pendingQuoteWasInQuotes && character === '"') {
          currentValue += '"'
          continue
        }
        inQuotes = !pendingQuoteWasInQuotes
      }

      if (previousWasCarriageReturn) {
        previousWasCarriageReturn = false
        if (character === '\n') {
          continue
        }
      }

      if (character === '"') {
        if (index + 1 >= text.length) {
          pendingQuote = true
          pendingQuoteWasInQuotes = inQuotes
          continue
        }
        if (inQuotes && text[index + 1] === '"') {
          currentValue += '"'
          index += 1
          continue
        }
        inQuotes = !inQuotes
        continue
      }

      if (!inQuotes && character === delimiter) {
        currentRow.push(currentValue)
        currentValue = ''
        continue
      }

      if (character === '\r') {
        previousWasCarriageReturn = true
        if (inQuotes) {
          currentValue += '\n'
        } else {
          const row = completeRow()
          if (row) yield row
        }
        continue
      }

      if (character === '\n') {
        if (inQuotes) {
          currentValue += '\n'
        } else {
          const row = completeRow()
          if (row) yield row
        }
        continue
      }

      currentValue += character
    }
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    const row = completeRow()
    if (row) yield row
  }
}

export async function parseCsvStreamMetadata(input: AsyncIterable<CsvInputChunk>): Promise<CsvStreamMetadata> {
  const stream = await createCsvRowStream(input)
  let headers: string[] = []
  let hasHeaders = false
  let totalRows = 0

  for await (const row of stream.rows) {
    if (!hasHeaders) {
      headers = normalizeHeaders(row)
      hasHeaders = true
      continue
    }
    totalRows += 1
  }

  return {
    headers,
    totalRows,
    delimiter: stream.delimiter,
    encoding: 'utf-8',
  }
}

export async function* parseCsvDocumentBatches(
  input: AsyncIterable<CsvInputChunk>,
  options: ParseCsvBatchOptions,
): AsyncIterable<CsvDocumentBatch> {
  const stream = await createCsvRowStream(input)
  const batchSize = Math.max(1, Math.floor(options.batchSize))
  const startOffset = Math.max(0, Math.floor(options.startOffset ?? 0))
  let headers: string[] | null = null
  let rowOffset = 0
  let batchRows: string[][] = []
  let batchStart = startOffset

  for await (const row of stream.rows) {
    if (!headers) {
      headers = normalizeHeaders(row)
      continue
    }

    if (rowOffset < startOffset) {
      rowOffset += 1
      continue
    }

    if (batchRows.length === 0) {
      batchStart = rowOffset
    }
    batchRows.push(row)
    rowOffset += 1

    if (batchRows.length >= batchSize) {
      yield {
        headers,
        rows: rowsToObjects(headers, batchRows, batchRows.length),
        rowStart: batchStart,
        nextOffset: rowOffset,
        delimiter: stream.delimiter,
        encoding: 'utf-8',
      }
      batchRows = []
    }
  }

  if (headers && batchRows.length > 0) {
    yield {
      headers,
      rows: rowsToObjects(headers, batchRows, batchRows.length),
      rowStart: batchStart,
      nextOffset: rowOffset,
      delimiter: stream.delimiter,
      encoding: 'utf-8',
    }
  }
}

export function parseCsvPreview(buffer: Buffer, options: ParseCsvPreviewOptions = {}): CsvPreview {
  const text = buffer.toString('utf-8')
  const delimiter = detectCsvDelimiter(text)
  const rows = parseCsvText(text, delimiter)
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeHeaders(rawHeaders)
  const maxRows = options.maxRows ?? 5

  return {
    headers,
    sampleRows: rowsToObjects(headers, dataRows, maxRows),
    totalRows: dataRows.length,
    delimiter,
    encoding: 'utf-8',
  }
}

export function parseCsvDocument(buffer: Buffer): CsvDocument {
  const text = buffer.toString('utf-8')
  const delimiter = detectCsvDelimiter(text)
  const rows = parseCsvText(text, delimiter)
  const [rawHeaders = [], ...dataRows] = rows
  const headers = normalizeHeaders(rawHeaders)

  return {
    headers,
    rows: rowsToObjects(headers, dataRows, dataRows.length),
    totalRows: dataRows.length,
    delimiter,
    encoding: 'utf-8',
  }
}
