import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { locales } from '@open-mercato/shared/lib/i18n/config'
import { matchCountryCodes } from '@open-mercato/shared/lib/location/countries'

/**
 * Warehouse list search matches name/code/city plus both stored country values:
 * ISO codes (`PL`) and legacy free-text (`Poland`). Localized labels shown in
 * the table (`Poland` / `Polska`) must resolve back to the stored ISO code.
 */
export function buildWarehouseListSearchOr(term: string): Array<Record<string, unknown>> {
  const like = `%${escapeLikePattern(term)}%`
  const orFilters: Array<Record<string, unknown>> = [
    { name: { $ilike: like } },
    { code: { $ilike: like } },
    { city: { $ilike: like } },
    { country: { $ilike: like } },
  ]
  const matchedCountryCodes = matchCountryCodes(term, { locales })
  if (matchedCountryCodes.length > 0) {
    orFilters.push({ country: { $in: matchedCountryCodes } })
  }
  return orFilters
}
