export const DEFAULT_LIST_COUNT_CAP = 10_000

/**
 * Cap on how many matching rows a list COUNT may visit before reporting
 * `total: cap` with `meta.listCountCapWarning` (surfaced to clients as
 * `totalIsCapped`). Mirrors `resolveEncryptedSortMaxRows`: returns the cap as
 * a number, or `null` when capping is disabled.
 *
 * Resolution of `OM_LIST_COUNT_CAP`:
 * - unset / blank → `DEFAULT_LIST_COUNT_CAP` (the cap is on by default)
 * - `0` (or negative) → `null` — capping disabled, exact counts everywhere
 * - unparseable → `DEFAULT_LIST_COUNT_CAP`; bad input must not silently
 *   disable the cap
 */
export function resolveListCountCap(): number | null {
  const raw = process.env.OM_LIST_COUNT_CAP
  if (raw === undefined || raw.trim() === '') return DEFAULT_LIST_COUNT_CAP
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_LIST_COUNT_CAP
  if (parsed <= 0) return null
  return Math.floor(parsed)
}
