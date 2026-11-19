import type { CurrencyDetails, CurrencyPrecisionLookup, CurrencyPrecisionResolver } from '../../currencyPrecision'
import { resolveCurrency } from '../currency'
import type { Currency } from '../types'

export const scope = { tenantId: 't1', organizationId: 'o1' }

export type CurrencyTable = Record<string, { decimalPlaces: number; symbol?: string | null }>

export function createResolver(table: CurrencyTable): CurrencyPrecisionResolver & {
  getCurrency(lookup: CurrencyPrecisionLookup): Promise<CurrencyDetails | null>
} {
  return {
    async getDecimalPlaces(lookup) {
      return table[lookup.code]?.decimalPlaces ?? null
    },
    async getCurrency(lookup) {
      const entry = table[lookup.code]
      return entry ? { code: lookup.code, decimalPlaces: entry.decimalPlaces, symbol: entry.symbol ?? null } : null
    },
  }
}

export function createContainer(resolver: CurrencyPrecisionResolver | null) {
  return {
    resolve<T = unknown>(name: string): T {
      if (name === 'currencyPrecisionService' && resolver) return resolver as T
      throw new Error(`[internal] Missing ${name}`)
    },
  }
}

export const defaultTable: CurrencyTable = {
  USD: { decimalPlaces: 2, symbol: '$' },
  EUR: { decimalPlaces: 2, symbol: '€' },
  JPY: { decimalPlaces: 0, symbol: '¥' },
  BHD: { decimalPlaces: 3 },
}

export async function currencyOf(code: string, table: CurrencyTable = defaultTable): Promise<Currency> {
  return resolveCurrency(createContainer(createResolver(table)), { code, ...scope })
}
