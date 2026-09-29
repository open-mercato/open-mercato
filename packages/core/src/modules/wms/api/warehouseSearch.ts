import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { getSupportedLocales } from '@open-mercato/shared/lib/i18n/locale-set'
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
  // The served set, not the shipped baseline: an operator searching in a locale
  // their app registered should match country names in that locale too.
  // `resolveCountryName` goes through `Intl.DisplayNames`, so any code the
  // runtime has region data for resolves without shipping a table.
  const matchedCountryCodes = matchCountryCodes(term, { locales: [...getSupportedLocales()] })
  if (matchedCountryCodes.length > 0) {
    orFilters.push({ country: { $in: matchedCountryCodes } })
  }
  return orFilters
}
