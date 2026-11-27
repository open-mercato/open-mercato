import type { EntityManager } from '@mikro-orm/postgresql'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

type CurrencyScope = { organizationId: string; tenantId: string }

/**
 * Readable codes for the currencies of journal lines, resolved on the server in
 * the entry's own organization and tenant as part of the ledger detail.
 *
 * Soft-deleted currencies are included on purpose: a posted line keeps the
 * currency it was posted in, and its code stays a fact of that line after the
 * currency is removed from the organization's list.
 */
export async function loadCurrencyCodes(
  em: EntityManager,
  currencyIds: readonly string[],
  scope: CurrencyScope,
): Promise<Map<string, string>> {
  const ids = [...new Set(currencyIds.filter((id) => typeof id === 'string' && id.length > 0))]
  if (!ids.length) return new Map()
  const currencies = await findWithDecryption(
    em,
    Currency,
    { id: { $in: ids }, ...scope },
    { fields: ['id', 'code'] },
    scope,
  )
  const codes = new Map<string, string>()
  for (const currency of currencies) {
    const code = typeof currency.code === 'string' ? currency.code.trim() : ''
    if (code) codes.set(String(currency.id), code)
  }
  return codes
}

/**
 * The code to show for a line's currency, or the currency identifier when the
 * code cannot be resolved, so the Currency cell is never empty.
 */
export function currencyCodeOrId(codes: ReadonlyMap<string, string>, currencyId: string): string {
  return codes.get(currencyId) ?? currencyId
}
