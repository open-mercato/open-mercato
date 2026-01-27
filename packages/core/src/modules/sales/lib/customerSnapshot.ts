export function extractCustomerName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const data = snapshot as Record<string, unknown>
  const candidates = [
    data.display_name,
    data.displayName,
    data.name,
    data.company_name,
    data.companyName,
    data.full_name,
    data.fullName,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return null
}
