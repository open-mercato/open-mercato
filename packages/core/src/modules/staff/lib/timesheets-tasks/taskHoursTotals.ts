/**
 * Column totals for the board (screen 6, `kcol-hours`).
 *
 * Every card already carries the inclusive rollup (D-2), which makes a column total a
 * client-side sum of rows the board is holding anyway — no second endpoint, and no way
 * for the header to disagree with the cards under it.
 *
 * It also makes the total the one place risk R10 can bite: adding a parent's
 * `loggedMinutes` to its child's adds the child twice, because the parent's figure
 * already contains it. The board never renders a child as its own card, so in practice
 * the set is parent-only — but "in practice" is not a guarantee a caller can rely on,
 * so this helper drops any row whose parent is present in the same set instead of
 * trusting the caller to have filtered it.
 */

export type TaskHoursRow = {
  id: string
  parentTaskId?: string | null
  loggedMinutes?: number | null
}

function toMinutes(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0
  return value
}

/**
 * Sums `loggedMinutes` across a set of tasks without double-counting.
 *
 * Never sum the raw field yourself — use this, or sum `ownMinutes` instead. Those are
 * the only two ways to total a mixed set correctly.
 */
export function sumTaskLoggedMinutes(rows: readonly TaskHoursRow[]): number {
  const presentIds = new Set(rows.map((row) => row.id))
  let total = 0
  for (const row of rows) {
    // The parent's rollup already contains this row's minutes.
    if (row.parentTaskId && presentIds.has(row.parentTaskId)) continue
    total += toMinutes(row.loggedMinutes)
  }
  return total
}
