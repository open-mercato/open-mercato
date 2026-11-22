import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { CARGO_UNIT_VALUES, TRUCK_TYPE_VALUES } from './freightEnums'

/**
 * Header aliases for the bulk order importer. The customer is chosen once in
 * the dialog, so a sheet does not repeat it on every row; the rest of the
 * columns mirror the single-order form so an operator can copy a sheet from
 * their dispatch team without translating field names.
 */
export const ORDER_IMPORT_COLUMNS: Record<string, string[]> = {
  cargoDescription: ['cargoDescription', 'cargo_description', 'cargo', 'description', 'goods'],
  pickupLocation: ['pickupLocation', 'pickup_location', 'pickup', 'origin', 'from'],
  dropoffLocation: ['dropoffLocation', 'dropoff_location', 'dropoff', 'destination', 'to'],
  requestedPickupAt: ['requestedPickupAt', 'requested_pickup_at', 'pickup_date', 'pickup_at', 'ready_at'],
  requestedDeliveryAt: ['requestedDeliveryAt', 'requested_delivery_at', 'delivery_date', 'deliver_at', 'due_at'],
  truckTypeRequired: ['truckTypeRequired', 'truck_type_required', 'truck_type', 'vehicle_type', 'equipment'],
  cargoQuantity: ['cargoQuantity', 'cargo_quantity', 'quantity', 'qty'],
  cargoUnit: ['cargoUnit', 'cargo_unit', 'unit', 'uom'],
  cargoWeightKg: ['cargoWeightKg', 'cargo_weight_kg', 'weight', 'weight_kg'],
  cargoVolumeM3: ['cargoVolumeM3', 'cargo_volume_m3', 'volume', 'volume_m3'],
  cargoHazardous: ['cargoHazardous', 'cargo_hazardous', 'hazardous', 'dangerous'],
  cargoRefrigerated: ['cargoRefrigerated', 'cargo_refrigerated', 'refrigerated', 'reefer'],
  agreedAmountNet: ['agreedAmountNet', 'agreed_amount_net', 'amount', 'price', 'rate', 'net_amount'],
  vatRate: ['vatRate', 'vat_rate', 'vat', 'tax_rate'],
  currencyCode: ['currencyCode', 'currency_code', 'currency'],
  notes: ['notes', 'note', 'comments', 'remarks'],
}

const REQUIRED_FIELDS = ['cargoDescription', 'pickupLocation', 'dropoffLocation', 'agreedAmountNet'] as const

const BOOLEAN_FIELDS = new Set(['cargoHazardous', 'cargoRefrigerated'])
const NUMBER_FIELDS = new Set([
  'cargoQuantity',
  'cargoWeightKg',
  'cargoVolumeM3',
  'agreedAmountNet',
  'vatRate',
])
const DATE_FIELDS = new Set(['requestedPickupAt', 'requestedDeliveryAt'])
const ENUM_VALUES: Record<string, readonly string[]> = {
  truckTypeRequired: TRUCK_TYPE_VALUES,
  cargoUnit: CARGO_UNIT_VALUES,
}

export type OrderImportRow = {
  /** 1-based row number in the sheet, header excluded — what the operator sees. */
  rowNumber: number
  payload: Record<string, unknown>
  errors: string[]
}

export type OrderImportParseResult = {
  rows: OrderImportRow[]
  unknownHeaders: string[]
  missingRequiredHeaders: string[]
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function buildHeaderIndex(headers: string[]): { byField: Map<string, string>; unknown: string[] } {
  const normalized = new Map<string, string>()
  for (const header of headers) {
    const key = normalizeHeader(header)
    if (key && !normalized.has(key)) normalized.set(key, header.trim())
  }
  const byField = new Map<string, string>()
  const claimed = new Set<string>()
  for (const [field, aliases] of Object.entries(ORDER_IMPORT_COLUMNS)) {
    for (const alias of aliases) {
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { value: `${trimmed}T12:00:00.000Z` }
  }
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed)
  if (dayFirst) {
    const day = Number(dayFirst[1])
    const month = Number(dayFirst[2])
    const year = Number(dayFirst[3])
    const parsed = new Date(Date.UTC(year, month - 1, day, 12))
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return { value: parsed.toISOString() }
    }
    return { error: 'not a date' }
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return { error: 'not a date' }
  return { value: parsed.toISOString() }
}

export function parseOrderImportRows(objects: Array<Record<string, string>>): OrderImportParseResult {
  const headers = objects.length ? Object.keys(objects[0]) : []
  const { byField, unknown } = buildHeaderIndex(headers)
  const missingRequiredHeaders = REQUIRED_FIELDS.filter((field) => !byField.has(field))

  const rows: OrderImportRow[] = objects.map((object, index) => {
    const payload: Record<string, unknown> = {}
    const errors: string[] = []
    for (const [field, header] of byField.entries()) {
      const raw = (object[header] ?? '').trim()
      if (!raw.length) continue
      if (BOOLEAN_FIELDS.has(field)) {
        const parsed = parseBooleanToken(raw)
        if (parsed === null) errors.push(`${header}: not a yes/no value`)
        else payload[field] = parsed
        continue
      }
      if (NUMBER_FIELDS.has(field)) {
        const parsed = cleanNumber(raw)
        if (parsed.error) errors.push(`${header}: not a number`)
        else if (parsed.value !== undefined) payload[field] = parsed.value
        continue
      }
      if (DATE_FIELDS.has(field)) {
        const parsed = normalizeDate(raw)
        if (parsed.error) errors.push(`${header}: ${parsed.error}`)
        else if (parsed.value) payload[field] = parsed.value
        continue
      }
      const allowed = ENUM_VALUES[field]
      if (allowed) {
        const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
        if (!allowed.includes(normalized)) errors.push(`${header}: expected one of ${allowed.join(', ')}`)
        else payload[field] = normalized
        continue
      }
      payload[field] = field === 'currencyCode' ? raw.toUpperCase() : raw
    }
    for (const field of REQUIRED_FIELDS) {
      if (!payload[field]) errors.push(`${field}: is required`)
    }
    return { rowNumber: index + 2, payload, errors }
  })

  return { rows, unknownHeaders: unknown, missingRequiredHeaders: [...missingRequiredHeaders] }
}

/** The header row an operator can export from a spreadsheet or type by hand. */
export const ORDER_IMPORT_TEMPLATE_HEADERS = [
  'cargoDescription',
  'pickupLocation',
  'dropoffLocation',
  'requestedPickupAt',
  'requestedDeliveryAt',
  'truckTypeRequired',
  'cargoQuantity',
  'cargoUnit',
  'cargoWeightKg',
  'cargoVolumeM3',
  'cargoHazardous',
  'cargoRefrigerated',
  'agreedAmountNet',
  'vatRate',
  'currencyCode',
  'notes',
]

export function buildOrderImportTemplateCsv(): string {
  const sample = [
    'Steel coils',
    'Riyadh',
    'Dammam',
    '2026-12-01',
    '2026-12-02',
    'flatbed',
    '12',
    'ton',
    '12000',
    '18',
    'no',
    'no',
    '2500',
    '15',
    'SAR',
    'Call the site supervisor before arrival',
  ]
  return `${ORDER_IMPORT_TEMPLATE_HEADERS.join(',')}\n${sample.map((value) => (value.includes(',') ? `"${value}"` : value)).join(',')}\n`
}
