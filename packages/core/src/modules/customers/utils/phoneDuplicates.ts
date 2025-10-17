import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { PhoneDuplicateMatch } from '@open-mercato/ui/backend/inputs/PhoneNumberField'

type LookupOptions = {
  recordId?: string | null
}

const normalizeDigits = (value: string): string => value.replace(/\D+/g, '')

const MAX_PAGES = 3
const PAGE_SIZE = 50

export async function lookupPhoneDuplicate(
  rawDigits: string,
  { recordId }: LookupOptions = {}
): Promise<PhoneDuplicateMatch | null> {
  const digits = normalizeDigits(rawDigits)
  if (!digits) return null

  const seen = new Set<string>()

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    try {
      const url = `/api/customers/people?hasPhone=true&page=${page}&pageSize=${PAGE_SIZE}&sortField=createdAt&sortDir=desc`
      const res = await apiFetch(url)
      if (!res.ok) continue
      const payload = await res.json().catch(() => ({}))
      const items = Array.isArray(payload?.items) ? payload.items : []
      for (const item of items) {
        const id = typeof item?.id === 'string' ? item.id : null
        if (!id || seen.has(id)) continue
        seen.add(id)
        if (recordId && id === recordId) continue
        const displayName = typeof item?.display_name === 'string' ? item.display_name : null
        const phoneRaw = typeof item?.primary_phone === 'string' ? item.primary_phone : ''
        const itemDigits = normalizeDigits(phoneRaw)
        if (!displayName || !itemDigits) continue
        if (itemDigits === digits) {
          return {
            id,
            label: displayName,
            href: `/backend/customers/people/${id}`,
          }
        }
      }
      const total = typeof payload?.total === 'number' ? payload.total : null
      if (total !== null && page * PAGE_SIZE >= total) {
        break
      }
    } catch {
      // ignore and try next page
    }
  }

  return null
}
