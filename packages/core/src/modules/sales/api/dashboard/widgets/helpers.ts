export type DatePeriodOption = 'last24h' | 'last7d' | 'last30d' | 'custom'

type DateRange = { from: Date; to: Date }

function parseDate(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function resolveDateRange(period: DatePeriodOption, customFrom?: string | null, customTo?: string | null): DateRange {
  const now = new Date()

  switch (period) {
    case 'last24h':
      return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now }
    case 'last7d':
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now }
    case 'last30d':
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now }
    case 'custom': {
      const fromDate = parseDate(customFrom) ?? new Date(0)
      const toDate = parseDate(customTo) ?? now
      return { from: fromDate, to: toDate }
    }
    default:
      return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now }
  }
}

export function extractCustomerName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const record = snapshot as Record<string, unknown>
  const candidates = [
    record.display_name,
    record.displayName,
    record.name,
    record.company_name,
    record.companyName,
    record.full_name,
    record.fullName,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }

  const customer = record.customer
  if (customer && typeof customer === 'object') {
    const customerRecord = customer as Record<string, unknown>
    const nestedCandidates = [
      customerRecord.display_name,
      customerRecord.displayName,
      customerRecord.name,
      customerRecord.company_name,
      customerRecord.companyName,
      customerRecord.full_name,
      customerRecord.fullName,
    ]
    for (const candidate of nestedCandidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate
      }
    }
  }

  return null
}
