"use client"

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CustomFieldProps } from '@open-mercato/shared/modules/widgets/injection'

const logger = createLogger('customer_groups').child({ component: 'GroupPickerField' })

type RemoteGroup = Record<string, unknown>

function pickString(item: RemoteGroup, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.length) return value
  }
  return ''
}

function pickNumber(item: RemoteGroup, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function mapGroup(item: RemoteGroup): ComboboxOption | null {
  const id = pickString(item, 'id')
  if (!id) return null
  const code = pickString(item, 'code')
  const name = pickString(item, 'name') || id
  const priority = pickNumber(item, 'priority')
  return {
    value: id,
    label: code ? `${name} (${code})` : name,
    description: priority !== null ? `Priority ${priority}` : null,
  }
}

async function loadGroups(query: string | undefined, pageSize: string): Promise<ComboboxOption[]> {
  try {
    const params = new URLSearchParams({ pageSize, sortField: 'priority', sortDir: 'asc' })
    const trimmed = (query ?? '').trim()
    if (trimmed) params.set('search', trimmed)
    const payload = await readApiResultOrThrow<{ items?: RemoteGroup[] }>(
      `/api/customer_groups/customer-groups?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map(mapGroup).filter((option): option is ComboboxOption => option !== null)
  } catch (err) {
    logger.error('customer_groups.groupPicker.load failed', { err })
    return []
  }
}

async function lookupGroup(id: string): Promise<RemoteGroup | null> {
  try {
    const payload = await readApiResultOrThrow<{ items?: RemoteGroup[] }>(
      `/api/customer_groups/customer-groups?ids=${encodeURIComponent(id)}&pageSize=1`,
      undefined,
      { fallback: { items: [] } },
    )
    const items = Array.isArray(payload.items) ? payload.items : []
    return items[0] ?? null
  } catch (err) {
    logger.error('customer_groups.groupPicker.lookup failed', { err, id })
    return null
  }
}

/**
 * Injected `crud-form:<entityId>:fields` custom field — replaces the free-text
 * `customerGroupId` UUID input on the catalog price editor and (once that host
 * form is updated to expose the field — see Step 1.11 gap note) the sales
 * tax-rate form with a searchable picker sourced from `/api/customer_groups/customer-groups`.
 *
 * A stored value that does not resolve to any group is never silently hidden —
 * it renders an explicit "Unknown group (<uuid>)" chip alongside the picker so
 * the gap stays visible (spec §7.3: "it is not hidden").
 */
export function GroupPickerField({ value, onChange, disabled }: CustomFieldProps) {
  const t = useT()
  const currentId = typeof value === 'string' ? value.trim() : ''
  const [unknownId, setUnknownId] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!currentId) {
      setUnknownId(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    lookupGroup(currentId).then((group) => {
      if (cancelled) return
      setUnknownId(group ? null : currentId)
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

  return (
    <div className="space-y-2" data-crud-field-id="customerGroupId">
      <Label htmlFor="customerGroupId">
        {t('customer_groups.widgets.groupPicker.label', 'Customer group')}
      </Label>
      <ComboboxInput
        value={currentId}
        onChange={(next) => onChange(next || null)}
        disabled={disabled || isLoading}
        allowCustomValues={false}
        clearable
        placeholder={t('customer_groups.widgets.groupPicker.placeholder', 'Search customer groups…')}
        loadSuggestions={(query) => loadGroups(query, '20')}
        resolveLabel={async (id) => {
          const group = await lookupGroup(id)
          return group ? mapGroup(group)?.label ?? id : id
        }}
      />
      {unknownId ? (
        <Tag variant="error" dot>
          {t('customer_groups.widgets.groupPicker.unknownGroup', 'Unknown group ({id})', { id: unknownId })}
        </Tag>
      ) : null}
    </div>
  )
}

export default GroupPickerField
