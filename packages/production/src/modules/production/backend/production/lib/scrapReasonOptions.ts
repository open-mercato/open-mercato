'use client'

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { PRODUCTION_DICTIONARIES_MANAGE_HREF } from '../../../lib/dictionaries.js'

export { PRODUCTION_DICTIONARIES_MANAGE_HREF }

/**
 * `fetchOptions` for `DictionaryEntrySelect` (task 4.2) — the component
 * manages its own loading/caching state, so this stays a plain async
 * function instead of a bespoke caching hook (unlike
 * `useCurrencyDictionary`, which backs a different, non-`DictionaryEntrySelect`
 * consumer).
 */
export async function fetchScrapReasonOptions(): Promise<DictionaryOption[]> {
  const payload = await readApiResultOrThrow<{ entries?: Array<Record<string, unknown>> }>(
    '/api/production/dictionaries/scrap-reasons',
    undefined,
    { errorMessage: 'Failed to load scrap reasons.' },
  )
  const entries = Array.isArray(payload?.entries) ? payload.entries : []
  return entries
    .map((entry): DictionaryOption | null => {
      const value = typeof entry.value === 'string' ? entry.value : ''
      if (!value) return null
      const label = typeof entry.label === 'string' && entry.label.trim().length ? entry.label : value
      const color = typeof entry.color === 'string' && entry.color.trim().length ? entry.color : null
      const icon = typeof entry.icon === 'string' && entry.icon.trim().length ? entry.icon : null
      return { value, label, color, icon }
    })
    .filter((entry): entry is DictionaryOption => entry !== null)
}
