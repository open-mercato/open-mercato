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
 */
export function resequenceLinesForUpsert<T extends OrderableDocumentLine>(
  lines: readonly T[],
  upsertedLineId: string,
  targetLineNumber: number | null,
): T[] {
  if (targetLineNumber == null) return renumber(sortByLineNumber(lines))
  const upsertedLine = lines.find((line) => line.id === upsertedLineId)
  if (!upsertedLine) return renumber(sortByLineNumber(lines))
  const others = sortByLineNumber(lines.filter((line) => line.id !== upsertedLineId))
  const targetIndex = Math.min(Math.max(targetLineNumber, 1), others.length + 1) - 1
  others.splice(targetIndex, 0, upsertedLine)
  return renumber(others)
}
