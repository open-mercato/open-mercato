export type OrderableDocumentLine = {
  id?: string | null
  lineNumber?: number | null
}

function renumber<T extends OrderableDocumentLine>(lines: T[]): T[] {
  return lines.map((line, index) => ({ ...line, lineNumber: index + 1 }))
}

function sortByLineNumber<T extends OrderableDocumentLine>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
}

/**
 * Order a document's lines after one of them was upserted, then renumber them
 * `1..n`.
 *
 * A supplied `targetLineNumber` is a destination *position*, not a sort key: the
 * upserted line is lifted out of the set and spliced back in there. Sorting on
 * it instead made a move onto an occupied position a no-op — the two lines tied,
 * the stable sort kept the incumbent first, and the renumbering put the upserted
 * line back where it started, so a caller reordering lines through repeated
 * upserts never converged. The value is clamped into `1..n`, because the
 * contiguous renumbering leaves no number outside that range to aim at.
 *
 * `null` means the caller did not ask for a position, and the stored numbers
 * stay the ordering.
 *
 * `storedLineNumber` is the upserted line's number *before* this call (`null`
 * when the line is new). A document created with non-contiguous numbers — the
 * accepted `10/20/30` — round-trips a record's current `lineNumber` on every
 * ordinary edit, and that value names a stored number, not an ordinal position.
 * Reading it as a position clamped `20` to the third slot and returned
 * `a=1,c=2,b=3`; when the requested value equals the stored one the current
 * order is kept instead.
 */
export function resequenceLinesForUpsert<T extends OrderableDocumentLine>(
  lines: readonly T[],
  upsertedLineId: string,
  targetLineNumber: number | null,
  storedLineNumber: number | null = null,
): T[] {
  if (targetLineNumber == null) return renumber(sortByLineNumber(lines))
  const upsertedLine = lines.find((line) => line.id === upsertedLineId)
  if (!upsertedLine) return renumber(sortByLineNumber(lines))
  if (storedLineNumber != null && targetLineNumber === storedLineNumber) {
    return renumber(sortByLineNumber(lines))
  }
  const others = sortByLineNumber(lines.filter((line) => line.id !== upsertedLineId))
  const targetIndex = Math.min(Math.max(targetLineNumber, 1), others.length + 1) - 1
  others.splice(targetIndex, 0, upsertedLine)
  return renumber(others)
}
