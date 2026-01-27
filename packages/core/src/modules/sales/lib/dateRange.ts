export type DatePeriodOption = 'last24h' | 'last7d' | 'last30d' | 'custom'

export const DATE_PERIOD_OPTIONS: DatePeriodOption[] = ['last24h', 'last7d', 'last30d', 'custom']

export function parseDateInput(value?: string | null): Date | null {
  if (!value || typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export function resolveDateRange(
  period: DatePeriodOption,
  customFrom?: Date | null,
  customTo?: Date | null,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const to = now
  switch (period) {
    case 'last24h': {
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      return { from, to }
    }
    case 'last7d': {
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { from, to }
    }
    case 'last30d': {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { from, to }
    }
    case 'custom': {
      const from = customFrom ?? new Date(0)
      const boundedTo = customTo ?? now
      return { from, to: boundedTo }
    }
    default: {
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      return { from, to }
    }
  }
}
