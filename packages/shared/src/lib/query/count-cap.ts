import { parseNumberWithDefault } from '../number'

export const DEFAULT_LIST_COUNT_CAP = 10_000

/**
 * Cap on how many matching rows a list COUNT may visit before reporting
 * `total: cap` with `meta.listCountCapWarning` (surfaced to clients as
 * `totalIsCapped`). Returns the cap as a number, or `null` when capping is
 * disabled.
 *
 * Resolution of `OM_LIST_COUNT_CAP`:
 * - unset / blank / unparseable → `DEFAULT_LIST_COUNT_CAP` (the cap is on by
 *   default, and bad input must not silently disable it)
 * - `0` (or negative) → `null` — capping disabled, exact counts everywhere
 */
export function resolveListCountCap(): number | null {
  const parsed = parseNumberWithDefault(process.env.OM_LIST_COUNT_CAP, DEFAULT_LIST_COUNT_CAP, { integer: true })
  return parsed <= 0 ? null : parsed
}
