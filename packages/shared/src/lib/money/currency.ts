import type { CurrencyDetails, CurrencyPrecisionLookup, CurrencyPrecisionResolver } from '../currencyPrecision'
import { CurrencyMismatchError, CurrencyNotResolvedError } from './errors'
import { brandCurrency, isValidMoneyDecimalPlaces, normalizeCurrencyCode } from './internal'
import type { Currency } from './types'

type ServiceContainer = {
  resolve<T = unknown>(name: string): T
}

/**
 * Lookup for `resolveCurrency`. Unlike the legacy `CurrencyPrecisionLookup`, the
 * organization is required: a lookup without one is never resolved.
 */
export type CurrencyLookup = {
  code: string
  tenantId: string
  organizationId: string
}

function resolvePrecisionService(container: ServiceContainer): CurrencyPrecisionResolver | null {
  try {
    return container.resolve<CurrencyPrecisionResolver>('currencyPrecisionService') ?? null
  } catch {
    return null
  }
}

async function readCurrencyDetails(
  resolver: CurrencyPrecisionResolver,
  lookup: CurrencyPrecisionLookup,
): Promise<CurrencyDetails | null> {
  if (typeof resolver.getCurrency === 'function') return resolver.getCurrency(lookup)
  const decimalPlaces = await resolver.getDecimalPlaces(lookup)
  return decimalPlaces === null ? null : { code: lookup.code, decimalPlaces, symbol: null }
}

function hasScope(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * The tenant's `Currency` for `code`, read from `currencyPrecisionService`. There is
 * no ISO fallback: a missing service, an unknown code, a lookup without a tenant or
 * an organization (checked here, before any resolver override runs) or a failing
 * lookup all throw `CurrencyNotResolvedError`. An inactive currency throws only when
 * the resolver implements `getCurrency` and returns `null` for it, as
 * `CurrencyPrecisionService` does; a resolver that implements only
 * `getDecimalPlaces` cannot report activity, so it is not checked on that path.
 * Existing `<field>Exact` code keeps using `resolveCurrencyDecimalPlaces`.
 */
export async function resolveCurrency(container: ServiceContainer, lookup: CurrencyLookup): Promise<Currency> {
  const rawCode = typeof lookup?.code === 'string' ? lookup.code : ''
  const code = normalizeCurrencyCode(rawCode)
  if (!code) throw new CurrencyNotResolvedError(rawCode)
  if (!hasScope(lookup.tenantId) || !hasScope(lookup.organizationId)) throw new CurrencyNotResolvedError(code)
  const resolver = resolvePrecisionService(container)
  if (!resolver) throw new CurrencyNotResolvedError(code)
  let details: CurrencyDetails | null
  try {
    details = await readCurrencyDetails(resolver, { ...lookup, code })
  } catch (error) {
    throw new CurrencyNotResolvedError(code, error)
  }
  if (!details || !isValidMoneyDecimalPlaces(details.decimalPlaces)) throw new CurrencyNotResolvedError(code)
  const symbol = typeof details.symbol === 'string' && details.symbol.length > 0 ? details.symbol : null
  return brandCurrency(code, details.decimalPlaces, symbol)
}

/** Equal when code and decimal places match; the display symbol is ignored. */
export function currenciesEqual(left: Currency, right: Currency): boolean {
  return left.code === right.code && left.decimalPlaces === right.decimalPlaces
}

export function assertSameCurrency(left: Currency, right: Currency): void {
  if (!currenciesEqual(left, right)) throw new CurrencyMismatchError(left, right)
}
