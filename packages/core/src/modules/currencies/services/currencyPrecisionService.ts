import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  CurrencyDetails,
  CurrencyPrecisionLookup,
  CurrencyPrecisionResolver,
} from '@open-mercato/shared/lib/currencyPrecision'
import { Currency } from '../data/entities'

type CurrencyRecord = { details: CurrencyDetails; isActive: boolean }

export class CurrencyPrecisionService implements CurrencyPrecisionResolver {
  private readonly lookups: Record<string, Promise<CurrencyRecord | null>> = {}

  constructor(private readonly em: EntityManager) {}

  /**
   * The currency's decimal places for one organization, looked up once per request.
   * Without an organization the lookup is not scoped tightly enough, so it returns
   * `null` and callers fall back to the ISO digits. Inactive currencies still
   * report their precision, so existing amounts keep rounding as before.
   */
  async getDecimalPlaces(lookup: CurrencyPrecisionLookup): Promise<number | null> {
    const record = await this.loadRecord(lookup)
    return record ? record.details.decimalPlaces : null
  }

  /**
   * Code, decimal places and symbol of an ACTIVE organization currency, sharing the
   * lookup above. `null` for an inactive currency: `resolveCurrency` creates money in
   * it only while it is enabled (stored snapshots still restore without a lookup).
   */
  async getCurrency(lookup: CurrencyPrecisionLookup): Promise<CurrencyDetails | null> {
    const record = await this.loadRecord(lookup)
    return record && record.isActive ? record.details : null
  }

  private loadRecord(lookup: CurrencyPrecisionLookup): Promise<CurrencyRecord | null> {
    const code = lookup.code.trim().toUpperCase()
    if (!code || !lookup.tenantId || !lookup.organizationId) return Promise.resolve(null)
    const key = `${lookup.tenantId}:${lookup.organizationId}:${code}`
    this.lookups[key] ??= this.loadCurrency(code, lookup.tenantId, lookup.organizationId)
    return this.lookups[key]
  }

  private async loadCurrency(code: string, tenantId: string, organizationId: string): Promise<CurrencyRecord | null> {
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
    if (!currency) return null
    return {
      details: Object.freeze({ code, decimalPlaces: currency.decimalPlaces, symbol: currency.symbol || null }),
      isActive: currency.isActive !== false,
    }
  }
}
