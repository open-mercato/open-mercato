import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { DRIVER_INCENTIVE_TYPE_VALUES, RATE_BASIS_VALUES } from './freightEnums'

/**
 * Header → field mapping for the rate importer. Operators write their sheets by
 * hand, so every field accepts the spellings a transport office actually uses
 * (camelCase, snake_case, and the plain words) — the first matching header wins,
 * and an unknown header is reported rather than silently dropped.
 */
export const RATE_IMPORT_COLUMNS: Record<string, string[]> = {
  lineNumber: ['lineNumber', 'line_number', 'line', 'no', 'number', '#'],
  origin: ['origin', 'from', 'pickup', 'pickup_location'],
  destination: ['destination', 'to', 'dropoff', 'dropoff_location'],
  rateBasis: ['rateBasis', 'rate_basis', 'basis'],
  rateAmount: ['rateAmount', 'rate_amount', 'rate', 'price', 'amount'],
  minimumCharge: ['minimumCharge', 'minimum_charge', 'minimum', 'min_charge'],
  currencyCode: ['currencyCode', 'currency_code', 'currency'],
  equipmentType: ['equipmentType', 'equipment_type', 'equipment', 'truck_type'],
  vehicleTypeId: ['vehicleTypeId', 'vehicle_type_id', 'vehicle_type'],
  driverIncentiveType: ['driverIncentiveType', 'driver_incentive_type', 'incentive_type'],
  driverIncentiveValue: ['driverIncentiveValue', 'driver_incentive_value', 'incentive_value', 'incentive'],
  includesTolls: ['includesTolls', 'includes_tolls', 'tolls_included', 'tolls'],
  includesWaiting: ['includesWaiting', 'includes_waiting', 'waiting_included', 'waiting'],
  freeWaitingMinutes: ['freeWaitingMinutes', 'free_waiting_minutes', 'free_waiting'],
  waitingRatePerHour: ['waitingRatePerHour', 'waiting_rate_per_hour', 'waiting_rate'],
  vatRateOverride: ['vatRateOverride', 'vat_rate_override', 'vat_override', 'vat'],
  isActive: ['isActive', 'is_active', 'active'],
  effectiveFrom: ['effectiveFrom', 'effective_from', 'valid_from', 'from_date'],
  effectiveTo: ['effectiveTo', 'effective_to', 'valid_to', 'to_date'],
}

const REQUIRED_FIELDS = ['origin', 'destination', 'rateAmount'] as const

const BOOLEAN_FIELDS = new Set(['includesTolls', 'includesWaiting', 'isActive'])
const NUMBER_FIELDS = new Set(['lineNumber', 'freeWaitingMinutes', 'rateAmount', 'minimumCharge', 'waitingRatePerHour', 'vatRateOverride', 'driverIncentiveValue'])
const ENUM_VALUES: Record<string, readonly string[]> = {
  rateBasis: RATE_BASIS_VALUES,
  driverIncentiveType: DRIVER_INCENTIVE_TYPE_VALUES,
}

export type RateImportRow = {
  /** 1-based row number in the sheet, header excluded — what the operator sees. */
  rowNumber: number
  payload: Record<string, unknown>
  errors: string[]
}

export type RateImportParseResult = {
  rows: RateImportRow[]
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
  for (const [field, aliases] of Object.entries(RATE_IMPORT_COLUMNS)) {
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
  const cleaned = value.replace(/[\s ,]/g, '').replace(/^[^\d.+-]+/, '').replace(/(SAR|USD|EUR|ر\.س)/gi, '')
  // An unparseable cell is reported, not treated as an empty one: a rate that
  // silently disappears here becomes a lane the contract never had. The caller
  // only hands over a non-empty cell, so an empty result is a parse failure.
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { error: 'not a number' }
  return { value: cleaned }
}

export function parseRateImportRows(objects: Array<Record<string, string>>): RateImportParseResult {
  const headers = objects.length ? Object.keys(objects[0]) : []
  const { byField, unknown } = buildHeaderIndex(headers)
  const missingRequiredHeaders = REQUIRED_FIELDS.filter((field) => !byField.has(field))

  const rows: RateImportRow[] = objects.map((object, index) => {
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
      const allowed = ENUM_VALUES[field]
      if (allowed) {
        const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
        if (!allowed.includes(normalized)) errors.push(`${header}: expected one of ${allowed.join(', ')}`)
        else payload[field] = normalized
        continue
      }
      payload[field] = raw
    }
    for (const field of REQUIRED_FIELDS) {
      if (!payload[field]) errors.push(`${field}: is required`)
    }
    return { rowNumber: index + 2, payload, errors }
  })

  return { rows, unknownHeaders: unknown, missingRequiredHeaders: [...missingRequiredHeaders] }
}

/** The header row an operator can export from a spreadsheet or type by hand. */
export const RATE_IMPORT_TEMPLATE_HEADERS = [
  'origin',
  'destination',
  'rateBasis',
  'rateAmount',
  'minimumCharge',
  'currency',
  'equipmentType',
  'driverIncentiveType',
  'driverIncentiveValue',
  'includesTolls',
  'includesWaiting',
  'freeWaitingMinutes',
  'waitingRatePerHour',
  'effectiveFrom',
  'effectiveTo',
  'isActive',
]

export function buildRateImportTemplateCsv(): string {
  const sample = [
    'Riyadh',
    'Dammam',
    'per_trip',
    '450',
    '',
    'SAR',
    'Flatbed 40ft',
    'per_trip',
    '35',
    'yes',
    'no',
    '60',
    '80',
    '2026-01-01',
    '2026-12-31',
    'yes',
  ]
  return `${RATE_IMPORT_TEMPLATE_HEADERS.join(',')}\n${sample.join(',')}\n`
}
