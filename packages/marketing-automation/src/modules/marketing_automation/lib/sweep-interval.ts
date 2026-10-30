/**
 * Interval parsing for a scheduled campaign's own cadence.
 *
 * The module's tick is fixed (hourly), but a campaign declares its own interval and that value has
 * to mean something — otherwise a campaign authored as `30m` runs hourly and one authored as `1d`
 * is swept 24 times a day, with only the re-entry window preventing repeat messages. So the tick
 * is the clock and this is the gate.
 *
 * Deliberately local rather than borrowed from `@open-mercato/scheduler`: that package is an
 * optional peer, and a sweep must still respect a campaign's cadence on an installation that does
 * not have it.
 */
const INTERVAL = /^(\d+)(s|m|h|d)$/
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export function parseSweepIntervalMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = INTERVAL.exec(value.trim())
  if (!match) return null
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount * UNIT_MS[match[2]]
}

export function isSweepIntervalValid(value: string | null | undefined): boolean {
  return parseSweepIntervalMs(value) !== null
}

/**
 * True when enough time has passed since the last sweep of this campaign.
 *
 * An unparseable interval sweeps on every tick rather than never: the value was accepted at save
 * time, so refusing to run would silently disable a campaign the author believes is live.
 */
export function isSweepDue(
  scheduleValue: string | null | undefined,
  lastSweptAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastSweptAt) return true
  const intervalMs = parseSweepIntervalMs(scheduleValue)
  if (intervalMs == null) return true
  return now.getTime() - lastSweptAt.getTime() >= intervalMs
}

/**
 * Carries the sweep clock across a save.
 *
 * Triggers are saved by delete-and-reinsert, and `lastSweptAt` is the one piece of state living on those
 * rows. An absent one means "due now" — so reinserting without it made every save of a scheduled campaign
 * sweep again immediately, and an author adjusting the copy of a daily campaign three times in an afternoon
 * swept it three more times that afternoon. Where the source has no claim key (expiring quotes, the
 * population scan) each of those is a real message to the same people.
 *
 * Keyed by SOURCE AND INTERVAL together, because a schedule's identity is both — the same rule the canvas
 * node ids and the save-time duplicate check follow. Changing either is a different schedule and starts a
 * fresh clock, which is what an author changing "daily" to "hourly" means.
 */
export type SweepClockRow = {
  kind: string
  sweepSource?: string | null
  scheduleValue?: string | null
  lastSweptAt?: Date | null
}

export function sweepClockKey(source: string | null | undefined, interval: string | null | undefined): string {
  return `${source ?? ''}|${interval ?? ''}`
}

export function carrySweepClocks(existing: SweepClockRow[]): Map<string, Date> {
  const clocks = new Map<string, Date>()
  for (const row of existing) {
    if (row.kind !== 'schedule' || !row.lastSweptAt) continue
    clocks.set(sweepClockKey(row.sweepSource, row.scheduleValue), row.lastSweptAt)
  }
  return clocks
}
