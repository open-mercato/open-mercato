import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SalesAmountsMode } from '../data/entities'
import { EXTERNAL_HEADER_FIELDS } from './calculations'
import type { SalesDocumentAmounts } from './types'

export type ExternalHeaderField = (typeof EXTERNAL_HEADER_FIELDS)[number]

// A mirrored document that charges no shipping or surcharge has nothing to say
// about them, so they default to zero instead of being required.
const OPTIONAL_EXTERNAL_HEADER_FIELDS: ReadonlySet<ExternalHeaderField> = new Set([
  'shippingNetAmount',
  'shippingGrossAmount',
  'surchargeTotalAmount',
])

export const REQUIRED_EXTERNAL_HEADER_FIELDS: readonly ExternalHeaderField[] =
  EXTERNAL_HEADER_FIELDS.filter((field) => !OPTIONAL_EXTERNAL_HEADER_FIELDS.has(field))

/**
 * `unitPriceNet` is required because the derived discount consumes it: without it
 * the line's whole net would be stored as a discount, indistinguishable from a markup.
 */
export const REQUIRED_EXTERNAL_LINE_FIELDS = [
  'unitPriceNet',
  'totalNetAmount',
  'totalGrossAmount',
  'taxAmount',
] as const

export type ExternalLineField = (typeof REQUIRED_EXTERNAL_LINE_FIELDS)[number]

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

type HeaderSource = Record<string, unknown> | null | undefined

export function collectSuppliedHeaderTotals(source: HeaderSource): Partial<SalesDocumentAmounts> {
  const totals: Partial<SalesDocumentAmounts> = {}
  if (!source) return totals
  for (const field of EXTERNAL_HEADER_FIELDS) {
    const value = toFiniteNumber(source[field])
    if (value !== null) totals[field] = value
  }
  return totals
}

export function hasAnySuppliedHeaderTotal(source: HeaderSource): boolean {
  if (!source) return false
  return EXTERNAL_HEADER_FIELDS.some((field) => toFiniteNumber(source[field]) !== null)
}

function missingHeaderFields(source: HeaderSource): ExternalHeaderField[] {
  return REQUIRED_EXTERNAL_HEADER_FIELDS.filter(
    (field) => toFiniteNumber(source?.[field]) === null,
  )
}

function missingLineFields(line: Record<string, unknown>): ExternalLineField[] {
  return REQUIRED_EXTERNAL_LINE_FIELDS.filter((field) => toFiniteNumber(line[field]) === null)
}

/** The supplied header with its optional fields defaulted to zero. */
export function buildExternalHeaderTotals(source: HeaderSource): Partial<SalesDocumentAmounts> {
  const supplied = collectSuppliedHeaderTotals(source)
  for (const field of OPTIONAL_EXTERNAL_HEADER_FIELDS) {
    supplied[field] ??= 0
  }
  return supplied
}

export async function assertExternalHeaderComplete(source: HeaderSource): Promise<void> {
  const missing = missingHeaderFields(source)
  if (!missing.length) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'sales.errors.externalTotalsRequired',
      'An order with external amounts must supply its own document totals: {{fields}}.',
      { fields: missing.join(', ') },
    ),
  })
}

export async function assertExternalLineComplete(
  line: Record<string, unknown>,
  lineNumber: number,
): Promise<void> {
  const missing = missingLineFields(line)
  if (!missing.length) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'sales.errors.externalAmountsIncomplete',
      'Line {{line}} has external amounts but is missing: {{fields}}. Partial specification is not a mode.',
      { line: String(lineNumber), fields: missing.join(', ') },
    ),
  })
}

export async function assertUniformAmountsMode(
  documentMode: SalesAmountsMode,
  lines: Array<{ amountsMode?: SalesAmountsMode | null }>,
): Promise<void> {
  const conflicting = lines.some(
    (line) => line.amountsMode != null && line.amountsMode !== documentMode,
  )
  if (!conflicting) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'sales.errors.externalModeMixed',
      'An order and all of its lines must share the same amounts mode.',
      { mode: documentMode },
    ),
  })
}

export async function refuseOnExternalOrder(): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(
      'sales.errors.externalAdjustmentRefused',
      'This order carries amounts from an external system, so adjustments cannot be added or removed. Switch it to computed amounts first.',
    ),
  })
}

export async function requireOrderTotalsForExternalWrite(source: HeaderSource): Promise<void> {
  if (!hasAnySuppliedHeaderTotal(source)) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(400, {
      error: translate(
        'sales.errors.externalTotalsRequired',
        'An order with external amounts must supply its own document totals: {{fields}}.',
        { fields: REQUIRED_EXTERNAL_HEADER_FIELDS.join(', ') },
      ),
    })
  }
  await assertExternalHeaderComplete(source)
}

export function readPersistedHeaderTotals(
  order: Record<ExternalHeaderField, string | number | null | undefined>,
): Partial<SalesDocumentAmounts> {
  const totals: Partial<SalesDocumentAmounts> = {}
  for (const field of EXTERNAL_HEADER_FIELDS) {
    totals[field] = toFiniteNumber(order[field]) ?? 0
  }
  return totals
}

export async function assertAmountsModeUnsupportedOnQuote(
  payloads:
    | Array<{ amountsMode?: SalesAmountsMode | null; totalsMode?: SalesAmountsMode | null }>
    | null
    | undefined,
): Promise<void> {
  // Both reach quote commands, through schemas shared with orders.
  if (!payloads?.some((payload) => payload.amountsMode != null || payload.totalsMode != null)) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'sales.errors.externalModeUnsupportedOnQuote',
      'Quotes cannot carry an amounts mode; they always use computed amounts.',
    ),
  })
}
