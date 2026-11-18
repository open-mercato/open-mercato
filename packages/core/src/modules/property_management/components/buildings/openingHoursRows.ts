import type { OpeningHoursRecord } from './buildingRecord'

export type OpeningRow = { weekday: number; open: boolean; opensAt: string; closesAt: string }

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const WORKDAY_COUNT = 5
const DEFAULT_OPENS_AT = '09:00'
const DEFAULT_CLOSES_AT = '18:00'
const LAST_CLOSE_BEFORE_MIDNIGHT = '23:45'
export const MIDNIGHT_CLOSE = '24:00'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function openingRowsOf(hours: readonly OpeningHoursRecord[], enabled = false): OpeningRow[] {
  const workdayDefault = !enabled && !hours.length
  return WEEKDAYS.map((weekday) => {
    const entry = hours.find((item) => item.weekday === weekday)
    if (entry) return { weekday, open: true, opensAt: entry.opensAt, closesAt: entry.closesAt }
    return { weekday, open: workdayDefault && weekday < WORKDAY_COUNT, opensAt: DEFAULT_OPENS_AT, closesAt: DEFAULT_CLOSES_AT }
  })
}

export function readOpeningRows(value: unknown): OpeningRow[] {
  const rows = Array.isArray(value) ? value.filter(isRecord) : []
  return WEEKDAYS.map((weekday) => {
    const row = rows.find((item) => item.weekday === weekday)
    return {
      weekday,
      open: row?.open === true,
      opensAt: typeof row?.opensAt === 'string' ? row.opensAt : DEFAULT_OPENS_AT,
      closesAt: typeof row?.closesAt === 'string' ? row.closesAt : DEFAULT_CLOSES_AT,
    }
  })
}

export function fallbackClosingTime(opensAt: string): string {
  if (DEFAULT_CLOSES_AT > opensAt) return DEFAULT_CLOSES_AT
  if (LAST_CLOSE_BEFORE_MIDNIGHT > opensAt) return LAST_CLOSE_BEFORE_MIDNIGHT
  return MIDNIGHT_CLOSE
}

export function openingHoursPayload(rows: readonly OpeningRow[]): { entries: OpeningHoursRecord[]; invalidWeekday: number | null } {
  const open = rows.filter((row) => row.open)
  const invalid = open.find((row) => row.closesAt <= row.opensAt)
  return {
    entries: open.map((row) => ({ weekday: row.weekday, opensAt: row.opensAt, closesAt: row.closesAt })),
    invalidWeekday: invalid ? invalid.weekday : null,
  }
}
