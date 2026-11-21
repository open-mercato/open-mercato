// Pure UTC date-only arithmetic shared by the deals timeline endpoint and page, so bucket and
// shift rules have one source of truth. Dates travel as `YYYY-MM-DD` keys of the UTC calendar
// date: `customer_deals.expected_close_at` is `timestamptz`, and the deal form stores UTC midnight.

export const DEAL_TIMELINE_BUCKETS = ['week', 'month', 'quarter'] as const
export type DealTimelineBucket = (typeof DEAL_TIMELINE_BUCKETS)[number]

export const DEAL_TIMELINE_GROUP_BY = ['owner', 'stage'] as const
export type DealTimelineGroupBy = (typeof DEAL_TIMELINE_GROUP_BY)[number]

export const DEAL_TIMELINE_MIN_COLUMNS = 1
export const DEAL_TIMELINE_MAX_COLUMNS = 8
export const DEAL_TIMELINE_WEEK_STARTS_ON = 1

export const DEAL_TIMELINE_UNASSIGNED_LANE = '__unassigned'
export const DEAL_TIMELINE_NO_STAGE_LANE_PREFIX = '__nostage:'

export type DealTimelineColumn = {
  index: number
  from: string
  to: string
  isCurrent: boolean
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function fromParts(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day))
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function isDealTimelineBucket(value: unknown): value is DealTimelineBucket {
  return typeof value === 'string' && (DEAL_TIMELINE_BUCKETS as readonly string[]).includes(value)
}

export function isDealTimelineGroupBy(value: unknown): value is DealTimelineGroupBy {
  return typeof value === 'string' && (DEAL_TIMELINE_GROUP_BY as readonly string[]).includes(value)
}

export function isValidDateKey(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month - 1)
}

export function toUtcDateKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (isValidDateKey(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) return null
    return fromParts(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  }
  if (Number.isNaN(value.getTime())) return null
  return fromParts(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
}

function parseDateKey(key: string): { year: number; monthIndex: number; day: number } {
  const match = DATE_KEY_PATTERN.exec(key)
  if (!match) throw new Error(`[internal] invalid date key: ${key}`)
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1, day: Number(match[3]) }
}

function requireDateKey(value: Date | string): string {
  const key = toUtcDateKey(value)
  if (!key) throw new Error('[internal] invalid date')
  return key
}

export function dateKeyToUtcDate(key: string): Date {
  const { year, monthIndex, day } = parseDateKey(key)
  return new Date(Date.UTC(year, monthIndex, day))
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function addDays(value: Date | string, days: number): string {
  const { year, monthIndex, day } = parseDateKey(requireDateKey(value))
  return fromParts(year, monthIndex, day + days)
}

export function addMonthsClamped(value: Date | string, months: number): string {
  const { year, monthIndex, day } = parseDateKey(requireDateKey(value))
  const targetMonthIndex = monthIndex + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12
  const clampedDay = Math.min(day, daysInMonth(targetYear, normalizedMonth))
  return fromParts(targetYear, normalizedMonth, clampedDay)
}

export function compareDateKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function alignToBucketStart(value: Date | string, bucket: DealTimelineBucket): string {
  const key = requireDateKey(value)
  const { year, monthIndex, day } = parseDateKey(key)
  if (bucket === 'week') {
    const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay()
    const offset = (weekday - DEAL_TIMELINE_WEEK_STARTS_ON + 7) % 7
    return fromParts(year, monthIndex, day - offset)
  }
  if (bucket === 'month') return fromParts(year, monthIndex, 1)
  return fromParts(year, monthIndex - (monthIndex % 3), 1)
}

export function addBuckets(value: Date | string, bucket: DealTimelineBucket, count: number): string {
  const start = alignToBucketStart(value, bucket)
  if (bucket === 'week') return addDays(start, count * 7)
  if (bucket === 'month') return addMonthsClamped(start, count)
  return addMonthsClamped(start, count * 3)
}

export function defaultColumnCount(bucket: DealTimelineBucket): number {
  return bucket === 'week' ? 5 : 4
}

export function defaultTimelineFrom(bucket: DealTimelineBucket, today: Date | string = new Date()): string {
  const current = alignToBucketStart(today, bucket)
  return bucket === 'week' ? addBuckets(current, 'week', -1) : current
}

export function buildTimelineColumns(
  bucket: DealTimelineBucket,
  from: Date | string,
  count: number,
  today: Date | string = new Date(),
): DealTimelineColumn[] {
  const safeCount = Math.max(DEAL_TIMELINE_MIN_COLUMNS, Math.min(DEAL_TIMELINE_MAX_COLUMNS, Math.trunc(count)))
  const start = alignToBucketStart(from, bucket)
  const todayKey = requireDateKey(today)
  const columns: DealTimelineColumn[] = []
  for (let index = 0; index < safeCount; index += 1) {
    const columnFrom = addBuckets(start, bucket, index)
    const columnTo = addBuckets(start, bucket, index + 1)
    columns.push({
      index,
      from: columnFrom,
      to: columnTo,
      isCurrent: compareDateKeys(columnFrom, todayKey) <= 0 && compareDateKeys(todayKey, columnTo) < 0,
    })
  }
  return columns
}

export function bucketIndexFor(value: Date | string | null | undefined, columns: DealTimelineColumn[]): number {
  const key = toUtcDateKey(value ?? null)
  if (!key) return -1
  for (const column of columns) {
    if (compareDateKeys(column.from, key) <= 0 && compareDateKeys(key, column.to) < 0) return column.index
  }
  return -1
}

export function shiftCloseDate(value: Date | string, bucket: DealTimelineBucket, delta: number): string {
  const key = requireDateKey(value)
  if (bucket === 'week') return addDays(key, delta * 7)
  if (bucket === 'month') return addMonthsClamped(key, delta)
  return addMonthsClamped(key, delta * 3)
}

export function isoWeekNumber(value: Date | string): number {
  const key = requireDateKey(value)
  const { year, monthIndex, day } = parseDateKey(key)
  const date = new Date(Date.UTC(year, monthIndex, day))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7)
}

export function endOfMonth(value: Date | string): string {
  const { year, monthIndex } = parseDateKey(requireDateKey(value))
  return fromParts(year, monthIndex, daysInMonth(year, monthIndex))
}

export function endOfQuarter(value: Date | string): string {
  const { year, monthIndex } = parseDateKey(requireDateKey(value))
  const lastMonth = monthIndex - (monthIndex % 3) + 2
  return fromParts(year, lastMonth, daysInMonth(year, lastMonth))
}

export function noStageLaneKey(pipelineId: string | null): string {
  return `${DEAL_TIMELINE_NO_STAGE_LANE_PREFIX}${pipelineId ?? ''}`
}

export function parseNoStageLaneKey(key: string): { pipelineId: string | null } | null {
  if (!key.startsWith(DEAL_TIMELINE_NO_STAGE_LANE_PREFIX)) return null
  const pipelineId = key.slice(DEAL_TIMELINE_NO_STAGE_LANE_PREFIX.length)
  return { pipelineId: pipelineId.length ? pipelineId : null }
}
