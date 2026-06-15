export function getMondayUtc(input: Date): Date {
  const d = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

export function addUtcDays(input: Date, days: number): Date {
  const d = new Date(input)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function getFirstDayOfMonthUtc(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1))
}

export function getFirstDayOfNextMonthUtc(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + 1, 1))
}

export function getLastNWeekStarts(n: number, now: Date = new Date()): Date[] {
  const currentMonday = getMondayUtc(now)
  const starts: Date[] = []
  for (let i = n - 1; i >= 0; i--) {
    starts.push(addUtcDays(currentMonday, -i * 7))
  }
  return starts
}

export function toDateOnlyString(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
