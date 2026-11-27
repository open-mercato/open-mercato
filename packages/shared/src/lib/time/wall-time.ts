const formatters = new Map<string, Intl.DateTimeFormat>()

export type WallTime = { date: string; time: string }

function formatter(timezone: string): Intl.DateTimeFormat {
  let result = formatters.get(timezone)
  if (!result) {
    result = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!)
    formatters.set(timezone, result)
  }
  return result
}

export function parseWallTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const wall = new Date(`${date}T${time}:00Z`)
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== `${date}T${time}`) return null
  return wall
}

export function wallTimeOffsets(wall: Date, timezone: string): number[] {
  const offsets = new Set<number>()
  for (const hour of [-36, -12, 0, 12, 36]) {
    const sample = new Date(wall.getTime() + hour * 3600000)
    const local = instantToWallTime(sample, timezone)
    offsets.add(new Date(`${local.date}T${local.time}:00Z`).getTime() - sample.getTime())
  }
  return [...offsets]
}

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /^[+-]/.test(value)) return false
  try {
    formatter(value).format()
    return true
  } catch {
    return false
  }
}

export function resolveBrowserTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isValidTimezone(timezone) ? timezone : 'UTC'
}

export function instantToWallTime(instant: Date, timezone: string): WallTime {
  const parts = formatter(timezone).formatToParts(instant)
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

/** DST gap (non-existent local time) → null; DST overlap (ambiguous) → the earlier instant. */
export function wallTimeToInstant(date: string, time: string, timezone: string): Date | null {
  if (!isValidTimezone(timezone)) return null
  const wall = parseWallTime(date, time)
  if (!wall) return null
  const candidates = wallTimeOffsets(wall, timezone).map((offset) => new Date(wall.getTime() - offset))
    .filter((instant) => {
      const local = instantToWallTime(instant, timezone)
      return local.date === date && local.time === time
    }).sort((left, right) => left.getTime() - right.getTime())
  return candidates[0] ?? null
}
