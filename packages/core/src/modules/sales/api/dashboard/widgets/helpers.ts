export type DatePeriodOption = 'last24h' | 'last7d' | 'last30d' | 'custom'

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
