import {
  FX_DECIMAL_PLACES,
  decimalToString,
  divideDecimals,
  parseDecimal,
} from '@open-mercato/shared/lib/decimal'
import type { RateType } from '../../data/validators'

export type { RateType } from '../../data/validators'

export type ProviderSelectionMode = 'default' | 'explicit'

export class RateProviderError extends Error {
  constructor(
    readonly i18nKey: string,
    message: string,
    readonly i18nParams?: Record<string, string | number>,
  ) {
    super(message)
    this.name = 'RateProviderError'
  }
}

export interface RateProviderResult {
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string // Numeric string for precision
  source: string
  date: Date
  type?: RateType | null // Rate type from bank's perspective
  externalReference?: string | null
  metadata?: Record<string, unknown> | null // Provider-specific context, e.g. table number
}

/**
 * The exact decimal rate for a provider value, or `null` when it is missing,
 * malformed or not positive (such a row is skipped instead of failing the import).
 */
export function toProviderRate(value: unknown): string | null {
  const parsed = parseDecimal(value)
  return parsed && parsed.gt(0) ? decimalToString(parsed) : null
}

/** The exact reciprocal (`1 / value`) of a provider rate, or `null` when unusable. */
export function invertProviderRate(value: unknown): string | null {
  const rate = toProviderRate(value)
  return rate === null ? null : decimalToString(divideDecimals(1, rate, FX_DECIMAL_PLACES))
}

export interface RateProvider {
  readonly name: string
  readonly source: string
  readonly providerBaseCurrency?: string // The base currency for this provider (e.g., 'PLN')
  readonly selectionMode?: ProviderSelectionMode

  fetchRates(
    date: Date,
    scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>
  ): Promise<RateProviderResult[]>

  isAvailable(): boolean
}
