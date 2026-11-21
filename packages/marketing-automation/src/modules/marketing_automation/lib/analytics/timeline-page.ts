/**
 * The customer timeline's cursor and page cut, pulled out of the route so the tiebreak is testable without
 * mocking seven ORM finders.
 *
 * The timeline merges rows from seven different tables, in memory, sorted by `at`. Two rows from DIFFERENT
 * sources can share the exact same millisecond — a send and its own delivery event, two score entries
 * awarded in the same batch — and an instant-only cursor cannot place a tied pair on two different pages:
 * `before` has to either keep both or drop both, because it excludes an instant wholesale. A row that
 * should have opened "Show older"'s next page instead vanished between the two requests.
 */
export type TimelineEntryLike = { id: string; at: string }

export type TimelineCursor = { at: Date; id: string | null }

/**
 * Parses the `before`/`beforeId` query parameters into one cursor. Returns `null` for an absent or
 * unparseable `before` — the first page has no cursor at all.
 */
export function readTimelineCursor(searchParams: URLSearchParams): TimelineCursor | null {
  const raw = searchParams.get('before')
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return { at: parsed, id: searchParams.get('beforeId') }
}

/**
 * The total order every step below agrees on: descending `at`, then descending `id` as a stable tiebreak.
 * Both the page's own sort and the cursor cut below MUST compare entries this same way, or the two
 * disagree about which side of the boundary a tied entry falls on.
 */
export function compareTimelineEntries(left: TimelineEntryLike, right: TimelineEntryLike): number {
  const atCompare = right.at.localeCompare(left.at)
  return atCompare !== 0 ? atCompare : right.id.localeCompare(left.id)
}

/**
 * Whether an entry belongs on THIS page relative to a cursor from the previous one.
 *
 * Strictly newer than the cursor: always excluded (it was on an earlier page). Strictly older: always
 * included. Exactly at the cursor's instant: only the entries that sort AFTER the cursor's own id, in
 * {@link compareTimelineEntries}'s order, were not yet shown — `entry.id < cursor.id` lexicographically,
 * because `compareTimelineEntries` sorts a HIGHER id first for a tie. Without a `cursor.id` (no previous
 * page, or an older caller that cannot send it) the whole tied instant is excluded, which is strictly
 * worse but not a regression for a caller that was never given the tiebreaker.
 */
export function isOlderThanCursor(entry: TimelineEntryLike, cursor: TimelineCursor | null): boolean {
  if (!cursor) return true
  const entryAt = new Date(entry.at).getTime()
  const cursorAt = cursor.at.getTime()
  if (entryAt > cursorAt) return false
  if (entryAt < cursorAt) return true
  if (!cursor.id) return false
  return entry.id.localeCompare(cursor.id) < 0
}

export type TimelinePage<T extends TimelineEntryLike> = {
  pageEntries: T[]
  hasMore: boolean
  nextBefore: string | null
  nextBeforeId: string | null
}

/**
 * Sorts the merged entries and cuts one page, with the cursor for the next one.
 *
 * `entries` is mutated in place by the sort (the caller's array is the merged accumulator and nothing else
 * reads it unsorted), matching the route's own prior behaviour.
 */
export function pageTimelineEntries<T extends TimelineEntryLike>(entries: T[], limit: number): TimelinePage<T> {
  entries.sort(compareTimelineEntries)
  const pageEntries = entries.slice(0, limit)
  const hasMore = entries.length > limit
  const lastEntry = hasMore ? pageEntries[pageEntries.length - 1] : null
  return {
    pageEntries,
    hasMore,
    nextBefore: lastEntry?.at ?? null,
    nextBeforeId: lastEntry?.id ?? null,
  }
}
