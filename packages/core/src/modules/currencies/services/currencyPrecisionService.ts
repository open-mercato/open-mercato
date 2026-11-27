import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CurrencyPrecisionLookup, CurrencyPrecisionResolver } from '@open-mercato/shared/lib/currencyPrecision'
import { Currency } from '../data/entities'

export class CurrencyPrecisionService implements CurrencyPrecisionResolver {
  private readonly lookups: Record<string, Promise<number | null>> = {}

  constructor(private readonly em: EntityManager) {}

  /**
   * The currency's decimal places for one organization, looked up once per request.
   * Without an organization the lookup is not scoped tightly enough, so it returns
   * `null` and callers fall back to the ISO digits.
   */
  getDecimalPlaces(lookup: CurrencyPrecisionLookup): Promise<number | null> {
    const code = lookup.code.trim().toUpperCase()
    if (!code || !lookup.tenantId || !lookup.organizationId) return Promise.resolve(null)
    const key = `${lookup.tenantId}:${lookup.organizationId}:${code}`
    this.lookups[key] ??= this.loadDecimalPlaces(code, lookup.tenantId, lookup.organizationId)
    return this.lookups[key]
  }

  private async loadDecimalPlaces(code: string, tenantId: string, organizationId: string): Promise<number | null> {
    const currency = await findOneWithDecryption(
      this.em,
      Currency,
      {
        code,
        tenantId,
        organizationId,
        deletedAt: null,
      },
      {},
      { tenantId, organizationId },
    )
    return currency ? currency.decimalPlaces : null
  }
}
