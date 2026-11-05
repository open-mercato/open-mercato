export type DatePeriodOption = 'last24h' | 'last7d' | 'last30d' | 'custom'

export type SalesNewQuotesSettings = {
  pageSize: number
  datePeriod: DatePeriodOption
  customFrom?: string
  customTo?: string
}

export const DEFAULT_SETTINGS: SalesNewQuotesSettings = {
  pageSize: 5,
  datePeriod: 'last24h',
}

const VALID_PERIODS: DatePeriodOption[] = ['last24h', 'last7d', 'last30d', 'custom']

function isValidDateString(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}

export function hydrateSalesNewQuotesSettings(raw: unknown): SalesNewQuotesSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<SalesNewQuotesSettings>
  const parsedPageSize = Number(input.pageSize)
  const pageSize =
    Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
      ? Math.floor(parsedPageSize)
      : DEFAULT_SETTINGS.pageSize
  const datePeriod = VALID_PERIODS.includes(input.datePeriod as DatePeriodOption)
    ? (input.datePeriod as DatePeriodOption)
    : DEFAULT_SETTINGS.datePeriod

  let customFrom: string | undefined
  let customTo: string | undefined
  if (datePeriod === 'custom') {
    if (typeof input.customFrom === 'string' && isValidDateString(input.customFrom)) {
      customFrom = input.customFrom
    }
    if (typeof input.customTo === 'string' && isValidDateString(input.customTo)) {
      customTo = input.customTo
    }
  }

  return {
    pageSize,
    datePeriod,
    customFrom,
    customTo,
  }
}
