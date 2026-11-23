/**
 * The "After occurrences" field keeps what the user typed as text, so it can stay
 * empty while a number is being replaced. This reads that draft: a whole number of
 * 1 or more, or null when the draft cannot be saved as a series length.
 */
export function parseRecurrenceCount(draft: string): number | null {
  const trimmed = draft.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}
