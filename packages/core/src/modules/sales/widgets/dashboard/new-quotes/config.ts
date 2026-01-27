import type { DatePeriodOption } from '../../../lib/dateRange'

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

export function hydrateSalesNewQuotesSettings(raw: unknown): SalesNewQuotesSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<SalesNewQuotesSettings>
  const parsedPageSize = Number(input.pageSize)
  let pageSize = DEFAULT_SETTINGS.pageSize
  if (Number.isFinite(parsedPageSize)) {
    if (parsedPageSize < 1) {
      pageSize = DEFAULT_SETTINGS.pageSize
    } else if (parsedPageSize > 20) {
      pageSize = 20
    } else {
      pageSize = Math.floor(parsedPageSize)
    }
  }

  const datePeriod: DatePeriodOption =
    input.datePeriod === 'last24h' ||
    input.datePeriod === 'last7d' ||
    input.datePeriod === 'last30d' ||
    input.datePeriod === 'custom'
      ? input.datePeriod
      : DEFAULT_SETTINGS.datePeriod

  let customFrom: string | undefined
  let customTo: string | undefined
  if (datePeriod === 'custom') {
    if (typeof input.customFrom === 'string' && !Number.isNaN(new Date(input.customFrom).getTime())) {
      customFrom = input.customFrom
    }
    if (typeof input.customTo === 'string' && !Number.isNaN(new Date(input.customTo).getTime())) {
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
