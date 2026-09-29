/**
 * Run-list date filtering (spec §8.3: "Run list: filters by definition, status,
 * correlationKey, date") — PURE.
 *
 * The filter bar's date-range control emits calendar days (`yyyy-MM-dd`), not
 * instants, so `to` has to cover the WHOLE day or "started on the 3rd" silently
 * excludes everything after midnight. Callers may also pass a full ISO
 * timestamp, which is taken verbatim.
 *
 * An unparseable value is an ERROR, never a silently dropped filter: handing
 * `new Date('garbage')` to the ORM is an Invalid Date, and a query built from
 * one answers nothing while looking like it answered something.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

export type DateBoundaryResult =
  | { ok: true; value: Date | null }
  | { ok: false; error: string }

function parseBoundary(raw: string | null | undefined, edge: 'start' | 'end'): DateBoundaryResult {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  const normalized = CALENDAR_DAY.test(raw)
    ? `${raw}${edge === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`
    : raw
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: `Invalid date value: ${raw}` }
  }
  return { ok: true, value: parsed }
}

export type StartedAtRangeResult =
  | { ok: true; range: { $gte?: Date; $lte?: Date } | null }
  | { ok: false; error: string }

export function buildStartedAtRange(
  from: string | null | undefined,
  to: string | null | undefined
): StartedAtRangeResult {
  const parsedFrom = parseBoundary(from, 'start')
  if (!parsedFrom.ok) return { ok: false, error: parsedFrom.error }
  const parsedTo = parseBoundary(to, 'end')
  if (!parsedTo.ok) return { ok: false, error: parsedTo.error }

  if (!parsedFrom.value && !parsedTo.value) return { ok: true, range: null }

  if (parsedFrom.value && parsedTo.value && parsedFrom.value.getTime() > parsedTo.value.getTime()) {
    return { ok: false, error: 'startedFrom must not be after startedTo' }
  }

  const range: { $gte?: Date; $lte?: Date } = {}
  if (parsedFrom.value) range.$gte = parsedFrom.value
  if (parsedTo.value) range.$lte = parsedTo.value
  return { ok: true, range }
}
