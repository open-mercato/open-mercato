export type CrudExportFormat = 'csv' | 'json' | 'xml' | 'markdown'

export type CrudExportColumn = {
  field: string
  header: string
}

export type PreparedExport = {
  columns: CrudExportColumn[]
  rows: Array<Record<string, unknown>>
}

export type SerializedExport = {
  body: string
  contentType: string
  fileExtension: string
}

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const XML_CONTENT_TYPE = 'application/xml; charset=utf-8'
const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

function normalizeValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map((v) => normalizeValue(v)).filter(Boolean).join(', ')
    return JSON.stringify(value)
  }
  return String(value)
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function escapeMarkdown(value: string): string {
  const escaped = value
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br />')
  return escaped || ' '
}

function escapeXmlTag(tag: string, fallbackIndex: number): string {
  const sanitized = tag.replace(/[^A-Za-z0-9_:-]/g, '_')
  const normalized = sanitized.length > 0 ? sanitized : `field_${fallbackIndex}`
  if (/^[^A-Za-z_]/.test(normalized)) {
    return `f_${normalized}`
  }
  return normalized
}

function escapeXmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function serializeCsv(prepared: PreparedExport): SerializedExport {
  const headers = prepared.columns.map((col) => col.header)
  const lines = [headers.join(',')]
  for (const row of prepared.rows) {
    const values = prepared.columns.map((col) => {
      const raw = normalizeValue(row[col.field])
      return escapeCsv(raw)
    })
    lines.push(values.join(','))
  }
  return {
    body: lines.join('\n'),
    contentType: CSV_CONTENT_TYPE,
    fileExtension: 'csv',
  }
}

function serializeJson(prepared: PreparedExport): SerializedExport {
  // For JSON we return objects keyed by exported field names with human headers as metadata
  const payload = prepared.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (const column of prepared.columns) {
      obj[column.header] = row[column.field]
    }
    return obj
  })
  return {
    body: JSON.stringify(payload, null, 2),
    contentType: JSON_CONTENT_TYPE,
    fileExtension: 'json',
  }
}

function serializeXml(prepared: PreparedExport): SerializedExport {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<records>']
  for (const row of prepared.rows) {
    lines.push('  <record>')
    prepared.columns.forEach((column, index) => {
      const tag = escapeXmlTag(column.field || column.header, index)
      const value = escapeXmlValue(normalizeValue(row[column.field]))
      lines.push(`    <${tag}>${value}</${tag}>`)
    })
    lines.push('  </record>')
  }
  lines.push('</records>')
  return {
    body: lines.join('\n'),
    contentType: XML_CONTENT_TYPE,
    fileExtension: 'xml',
  }
}

function serializeMarkdown(prepared: PreparedExport): SerializedExport {
  const headers = prepared.columns.map((col) => escapeMarkdown(col.header))
  const headerLine = `| ${headers.join(' | ')} |`
  const dividerLine = `| ${prepared.columns.map(() => '---').join(' | ')} |`
  const rows = prepared.rows.map((row) => {
    const cells = prepared.columns.map((col) => escapeMarkdown(normalizeValue(row[col.field])))
    return `| ${cells.join(' | ')} |`
  })
  const body = [headerLine, dividerLine, ...rows].join('\n')
  return {
    body,
    contentType: MARKDOWN_CONTENT_TYPE,
    fileExtension: 'md',
  }
}

export function serializeExport(prepared: PreparedExport, format: CrudExportFormat): SerializedExport {
  switch (format) {
    case 'csv':
      return serializeCsv(prepared)
    case 'json':
      return serializeJson(prepared)
    case 'xml':
      return serializeXml(prepared)
    case 'markdown':
      return serializeMarkdown(prepared)
    default:
      return serializeJson(prepared)
  }
}

export function normalizeExportFormat(raw: unknown): CrudExportFormat | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const value = raw.toLowerCase()
  if (value === 'csv') return 'csv'
  if (value === 'json' || value === 'application/json') return 'json'
  if (value === 'xml' || value === 'application/xml') return 'xml'
  if (value === 'markdown' || value === 'md' || value === 'text/markdown') return 'markdown'
  return null
}

export function defaultExportFilename(base: string | undefined | null, format: CrudExportFormat): string {
  const safeBase = (base && base.trim().length > 0 ? base.trim() : 'export')
    .replace(/[^a-z0-9_\-]/gi, '_')
  const suffix = format === 'markdown' ? 'md' : format
  return `${safeBase}.${suffix}`
}

function toHeaderLabel(key: string): string {
  const normalized = key.replace(/[_\-\s]+/g, ' ').trim()
  if (!normalized) return 'Field'
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase())
}

export function ensureColumns(rows: Array<Record<string, unknown>>, hint?: CrudExportColumn[]): CrudExportColumn[] {
  if (hint && hint.length > 0) return hint
  const used = new Map<string, string>()
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!used.has(key)) used.set(key, key)
    })
  })
  if (used.size === 0) return [{ field: 'id', header: 'ID' }]
  return Array.from(used.keys()).map((key) => ({
    field: key,
    header: toHeaderLabel(key),
  }))
}
