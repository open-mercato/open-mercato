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

type ParseCsvPreviewOptions = {
  maxRows?: number
}

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
