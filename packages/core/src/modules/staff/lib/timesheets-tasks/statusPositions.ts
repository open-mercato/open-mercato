/**
 * Gap-based ordering arithmetic for the Kanban columns of screen 6.
 *
 * Positions are integers spaced `STATUS_POSITION_GAP` apart rather than a dense
 * 0..n-1 sequence. That is what keeps a drag cheap: the board hands the server a
 * midpoint between the two columns the pointer was released over, so moving one
 * column writes exactly one row instead of renumbering every column on the board.
 *
 * The dense renumber still exists, but only as the fallback for the one case the
 * midpoint scheme cannot express — a gap narrow enough that no integer fits
 * between two neighbours. Then the whole board is compacted back onto the gap
 * grid, which restores room for the next few thousand drags.
 */

export const STATUS_POSITION_GAP = 1000

/**
 * Mirrors the ceiling `positionSchema` accepts in `data/validators.ts`, so a
 * server-computed position can always be round-tripped back through the API.
 */
export const MAX_STATUS_POSITION = 1_000_000

export type StatusPosition = {
  id: string
  position: number
}

export type StatusReorderPlan = {
  /** Only the rows whose stored position actually has to change. */
  updates: StatusPosition[]
  /** True when the gap ran out and the whole board was re-spaced. */
  compacted: boolean
  /** Requested ids that do not belong to the project — the caller rejects these. */
  unknownIds: string[]
}

/**
 * Position for a column appended to the right-hand end of the board (the
 * mockup's "Nowa kolumna / Dodaj status" affordance).
 */
export function nextStatusPosition(positions: readonly number[]): number {
  const finite = positions.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return STATUS_POSITION_GAP
  const highest = Math.max(...finite)
  const next = highest + STATUS_POSITION_GAP
  if (next <= MAX_STATUS_POSITION) return next
  // Past the ceiling the board is out of headroom; fall back to the tightest
  // step that still preserves ordering. A reorder will compact it back later.
  return Math.min(highest + 1, MAX_STATUS_POSITION)
}

/** Re-spaces an ordered id list back onto the gap grid. */
export function compactStatusPositions(ids: readonly string[]): StatusPosition[] {
  return ids.map((id, index) => ({ id, position: (index + 1) * STATUS_POSITION_GAP }))
}

type DesiredRow = {
  id: string
  currentPosition: number
  targetPosition: number
  requested: boolean
}

function isUsablePosition(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_STATUS_POSITION
}

/**
 * Turns a reorder request into the minimal set of position writes.
 *
 * `current` is every live column of the project; `requested` is the subset the
 * client moved, carrying its intended sort key. Columns absent from the request
 * keep the position they already have, so a board can be reordered one column at
 * a time without the client having to restate the rest.
 */
export function planStatusReorder(
  current: readonly StatusPosition[],
  requested: readonly StatusPosition[],
): StatusReorderPlan {
  const currentById = new Map(current.map((row) => [row.id, row.position]))
  const unknownIds: string[] = []
  const requestedById = new Map<string, number>()
  for (const row of requested) {
    if (!currentById.has(row.id)) {
      if (!unknownIds.includes(row.id)) unknownIds.push(row.id)
      continue
    }
    requestedById.set(row.id, row.position)
  }

  const desired: DesiredRow[] = current.map((row) => ({
    id: row.id,
    currentPosition: row.position,
    targetPosition: requestedById.get(row.id) ?? row.position,
    requested: requestedById.has(row.id),
  }))

  desired.sort((left, right) => {
    if (left.targetPosition !== right.targetPosition) return left.targetPosition - right.targetPosition
    // A dragged column dropped exactly onto a settled column's key lands ahead of
    // it, which is where the pointer was released. Two settled columns keep their
    // previous relative order, then sort by id — so the outcome never depends on
    // the order rows happened to arrive in.
    if (left.requested !== right.requested) return left.requested ? -1 : 1
    if (left.currentPosition !== right.currentPosition) return left.currentPosition - right.currentPosition
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

  const fitsOnGrid = desired.every(
    (row, index) =>
      isUsablePosition(row.targetPosition) &&
      (index === 0 || row.targetPosition > desired[index - 1].targetPosition),
  )

  if (fitsOnGrid) {
    return {
      updates: desired
        .filter((row) => row.targetPosition !== row.currentPosition)
        .map((row) => ({ id: row.id, position: row.targetPosition })),
      compacted: false,
      unknownIds,
    }
  }

  const compactedPositions = compactStatusPositions(desired.map((row) => row.id))
  const currentPositionById = new Map(desired.map((row) => [row.id, row.currentPosition]))
  return {
    updates: compactedPositions.filter((row) => currentPositionById.get(row.id) !== row.position),
    compacted: true,
    unknownIds,
  }
}
