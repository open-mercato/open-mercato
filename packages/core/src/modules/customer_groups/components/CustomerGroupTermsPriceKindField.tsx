"use client"

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups').child({ component: 'CustomerGroupTermsPriceKindField' })

type RemotePriceKind = Record<string, unknown>

// Mirrors `pickString`/`loadOptions`/`resolveOne` in
// `catalog/components/prices/PriceScopeSelectors.tsx` (`PricePriceKindSelect`) — the
// terms `priceKindId` field is an FK-id into `catalog`'s price kinds (spec: "a picker
// sourced from catalog price kinds, not free text"), sourced via the public
// `/api/catalog/price-kinds` route rather than an ORM relationship.
function pickString(item: RemotePriceKind, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.length) return value
  }
  return ''
}

function mapPriceKindItem(item: RemotePriceKind): ComboboxOption | null {
  const id = pickString(item, 'id')
  if (!id) return null
  const title = pickString(item, 'title') || id
  const code = pickString(item, 'code')
  return { value: id, label: code ? `${title} (${code})` : title }
}

async function loadPriceKindOptions(query?: string): Promise<ComboboxOption[]> {
  try {
    const params = new URLSearchParams({ search: (query ?? '').trim(), pageSize: '20' })
    const payload = await readApiResultOrThrow<{ items?: RemotePriceKind[] }>(
      `/api/catalog/price-kinds?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map(mapPriceKindItem).filter((option): option is ComboboxOption => option !== null)
  } catch (err) {
    logger.error('customer_groups.terms.priceKind.load', { err })
    return []
  }
}

async function resolvePriceKindLabel(id: string): Promise<string> {
  try {
    const params = new URLSearchParams({ id, pageSize: '1' })
    const payload = await readApiResultOrThrow<{ items?: RemotePriceKind[] }>(
      `/api/catalog/price-kinds?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    const option = items.map(mapPriceKindItem).find((candidate): candidate is ComboboxOption => candidate !== null)
    return option?.label ?? id
  } catch {
    return id
  }
}

export function CustomerGroupTermsPriceKindField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const t = useT()
  const currentId = typeof value === 'string' ? value.trim() : ''
  // Mirrors `GroupPickerField`'s resolve-in-flight guard: disable the combobox while a
  // pre-selected id's label is still resolving so the field never briefly shows the raw
  // uuid as interactive text.
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!currentId) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    resolvePriceKindLabel(currentId).then(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

  return (
    <ComboboxInput
      value={currentId}
      onChange={onChange}
      disabled={disabled || isLoading}
      allowCustomValues={false}
      clearable
      placeholder={t('customer_groups.groups.form.terms.field.priceKindPlaceholder', 'Search price kinds…')}
      loadSuggestions={loadPriceKindOptions}
      resolveLabel={resolvePriceKindLabel}
    />
  )
}

export default CustomerGroupTermsPriceKindField
