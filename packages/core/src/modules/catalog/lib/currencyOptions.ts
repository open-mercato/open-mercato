import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { CURRENCY_OPTIONS_URL } from '@open-mercato/shared/modules/entities/kinds'
import type { DictionaryOption } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'

const CURRENCY_OPTIONS_LIMIT = 100

type CurrencyOptionsPayload = {
  items?: unknown
}

export async function loadCurrencyOptions(errorMessage: string): Promise<DictionaryOption[]> {
  const payload = await readApiResultOrThrow<CurrencyOptionsPayload>(
    `${CURRENCY_OPTIONS_URL}?limit=${CURRENCY_OPTIONS_LIMIT}`,
    undefined,
    { errorMessage },
  )
  const items = Array.isArray(payload?.items) ? payload.items : []
  const options: DictionaryOption[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const value = typeof record.value === 'string' ? record.value.trim().toUpperCase() : ''
    if (!value) continue
    const label = typeof record.label === 'string' && record.label.trim().length ? record.label.trim() : value
    options.push({ value, label, color: null, icon: null })
  }
  return options
}
