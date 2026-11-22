/**
 * Shared parsing for the transport bulk-import dialogs.
 *
 * A sheet is mapped to command input in the browser, then validated again with
 * the entity's own zod schema on the server, so the preview and the commit can
 * never disagree about what a valid row is. Header aliases let an operator use
 * the column names their existing fleet sheet already has.
 */

export type ImportColumnSpec = {
  aliases: string[]
  kind?: 'string' | 'number' | 'date' | 'enum'
  enumValues?: readonly string[]
}

export type ImportRow = {
  /** 1-based row number in the sheet, header excluded — what the operator sees. */
  rowNumber: number
  payload: Record<string, unknown>
  errors: string[]
}

export type ImportParseResult = {
  rows: ImportRow[]
  unknownHeaders: string[]
  missingRequiredHeaders: string[]
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function buildHeaderIndex(
  headers: string[],
  columns: Record<string, ImportColumnSpec>,
): { byField: Map<string, string>; unknown: string[] } {
  const normalized = new Map<string, string>()
  for (const header of headers) {
    const key = normalizeHeader(header)
    if (key && !normalized.has(key)) normalized.set(key, header.trim())
  }
  const byField = new Map<string, string>()
  const claimed = new Set<string>()
  for (const [field, spec] of Object.entries(columns)) {
    for (const alias of spec.aliases) {
      const match = normalized.get(normalizeHeader(alias))
      if (match && !claimed.has(match)) {
        byField.set(field, match)
        claimed.add(match)
        break
      }
    }
  }
  const unknown = Array.from(normalized.values()).filter((header) => !claimed.has(header))
  return { byField, unknown }
}

function cleanNumber(value: string): { value?: string; error?: string } {
  const normalized = value.replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return { error: 'not a number' }
  return { value: normalized }
}

function normalizeDate(value: string): { value?: string; error?: string } {
  const trimmed = value.trim()
  if (!trimmed.length) return {}
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (isoDate) {
    const year = Number(isoDate[1])
    const month = Number(isoDate[2])
    const day = Number(isoDate[3])
    const parsed = new Date(Date.UTC(year, month - 1, day))
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return { value: trimmed }
    }
    return { error: 'not a date' }
  }
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed)
  if (dayFirst) {
    const day = Number(dayFirst[1])
    const month = Number(dayFirst[2])
    const year = Number(dayFirst[3])
    const parsed = new Date(Date.UTC(year, month - 1, day))
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return { value: parsed.toISOString().slice(0, 10) }
    }
    return { error: 'not a date' }
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return { error: 'not a date' }
  return { value: parsed.toISOString().slice(0, 10) }
}

export function parseImportRows(
  objects: Array<Record<string, string>>,
  options: { columns: Record<string, ImportColumnSpec>; required: readonly string[] },
): ImportParseResult {
  const headers = objects.length ? Object.keys(objects[0]) : []
  const { byField, unknown } = buildHeaderIndex(headers, options.columns)
  const missingRequiredHeaders = options.required.filter((field) => !byField.has(field))

  const rows: ImportRow[] = objects.map((object, index) => {
    const payload: Record<string, unknown> = {}
    const errors: string[] = []
    for (const [field, header] of byField.entries()) {
      const raw = (object[header] ?? '').trim()
      if (!raw.length) continue
      const spec = options.columns[field]
      if (spec.kind === 'number') {
        const parsed = cleanNumber(raw)
        if (parsed.error) errors.push(`${header}: not a number`)
        else if (parsed.value !== undefined) payload[field] = parsed.value
        continue
      }
      if (spec.kind === 'date') {
        const parsed = normalizeDate(raw)
        if (parsed.error) errors.push(`${header}: ${parsed.error}`)
        else if (parsed.value) payload[field] = parsed.value
        continue
      }
      if (spec.kind === 'enum') {
        const allowed = spec.enumValues ?? []
        const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
        if (!allowed.includes(normalized)) errors.push(`${header}: expected one of ${allowed.join(', ')}`)
        else payload[field] = normalized
        continue
      }
      payload[field] = raw
    }
    for (const field of options.required) {
      if (!payload[field]) errors.push(`${field}: is required`)
    }
    return { rowNumber: index + 2, payload, errors }
  })

  return { rows, unknownHeaders: unknown, missingRequiredHeaders: [...missingRequiredHeaders] }
}

function escapeCsvValue(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The header row an operator can export from a spreadsheet or type by hand. */
export function buildImportTemplateCsv(headers: readonly string[], sample: readonly string[]): string {
  return `${headers.map(escapeCsvValue).join(',')}\n${sample.map(escapeCsvValue).join(',')}\n`
}
