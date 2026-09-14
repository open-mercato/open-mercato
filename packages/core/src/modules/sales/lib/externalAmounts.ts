import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SalesAmountsMode } from '../data/entities'
import type { SalesDocumentAmounts } from './types'

/**
 * Header fields a caller MUST supply to put a document in `external` mode.
 * Shipping and surcharge are deliberately absent: a mirrored document that
 * charges neither has nothing to say about them, and they default to zero.
 */
export const REQUIRED_EXTERNAL_HEADER_FIELDS = [
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
] as const

const OPTIONAL_EXTERNAL_HEADER_FIELDS = [
  'shippingNetAmount',
  'shippingGrossAmount',
  'surchargeTotalAmount',
] as const

const EXTERNAL_HEADER_FIELDS = [
  ...REQUIRED_EXTERNAL_HEADER_FIELDS,
  ...OPTIONAL_EXTERNAL_HEADER_FIELDS,
] as const

export type ExternalHeaderField = (typeof EXTERNAL_HEADER_FIELDS)[number]

/**
 * Line fields a caller MUST supply on an external line. `unitPriceNet` is on the
 * list because the derived `discount_amount` consumes it: an external line that
 * omitted it would derive `0 × quantity − totalNetAmount`, persisting the line's
 * whole net as a discount and rendering as one — indistinguishable from a
 * legitimate markup.
 */
export const REQUIRED_EXTERNAL_LINE_FIELDS = [
  'unitPriceNet',
  'totalNetAmount',
  'totalGrossAmount',
  'taxAmount',
] as const

export type ExternalLineField = (typeof REQUIRED_EXTERNAL_LINE_FIELDS)[number]

export function isExternalMode(mode: SalesAmountsMode | null | undefined): boolean {
  return mode === 'external'
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

type HeaderSource = Record<string, unknown> | null | undefined

/** Header fields present on a payload, whether or not the set is complete. */
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

/**
 * A supplied header the engine can honour verbatim, with the optional fields
 * defaulted. Callers pass this as `CalculateDocumentOptions.suppliedTotals`.
 */
export function buildExternalHeaderTotals(source: HeaderSource): Partial<SalesDocumentAmounts> {
  const supplied = collectSuppliedHeaderTotals(source)
  for (const field of OPTIONAL_EXTERNAL_HEADER_FIELDS) {
    if (supplied[field] === undefined) supplied[field] = 0
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

/**
 * The § 1 invariant: an order is external iff every one of its lines is. A mixed
 * document has a header nobody owns, so it is refused at the command layer
 * rather than stored and reasoned about later.
 */
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

/** The persisted header of an order, as the engine's supplied-totals shape. */
export function readPersistedHeaderTotals(
  order: Record<ExternalHeaderField, string | number | null | undefined>,
): Partial<SalesDocumentAmounts> {
  const totals: Partial<SalesDocumentAmounts> = {}
  for (const field of EXTERNAL_HEADER_FIELDS) {
    totals[field] = toFiniteNumber(order[field]) ?? 0
  }
  return totals
}

/**
 * Quotes are always `computed` — a quote is core composing a proposal, not
 * mirroring a book of record. The field reaches the quote schemas because the
 * line pricing shape is shared, so it is rejected rather than silently ignored:
 * silently ignoring an accepted field is the failure this whole mode exists to
 * stop repeating.
 */
export async function assertAmountsModeUnsupportedOnQuote(
  payloads:
    | Array<{ amountsMode?: SalesAmountsMode | null; totalsMode?: SalesAmountsMode | null }>
    | null
    | undefined,
): Promise<void> {
  // Both names, because both reach a quote command: `amountsMode` through the
  // shared line pricing shape, `totalsMode` through the shared document update
  // schema.
  if (!payloads?.some((payload) => payload.amountsMode != null || payload.totalsMode != null)) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(400, {
    error: translate(
      'sales.errors.externalModeUnsupportedOnQuote',
      'Quotes cannot carry an amounts mode; they always use computed amounts.',
    ),
  })
}
