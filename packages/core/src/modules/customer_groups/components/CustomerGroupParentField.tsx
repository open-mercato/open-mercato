"use client"

import * as React from 'react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CUSTOMER_GROUP_DEPTH_WARNING_THRESHOLD,
  mapListItemsToSummaries,
  type CustomerGroupSummary,
} from './customerGroupTree'

const MAX_ANCESTOR_LOOKUPS = 16

export type CustomerGroupParentFieldProps = {
  value: unknown
  setValue: (value: unknown) => void
  disabled?: boolean
  // The group being edited. It is never offered as its own parent, and a
  // candidate whose ancestor chain contains it (i.e. one of its descendants) is
  // rejected so an edit can never introduce a cycle.
  excludeId?: string | null
}

async function fetchGroupById(id: string): Promise<CustomerGroupSummary | null> {
  const call = await apiCall<{ items?: unknown[] }>(
    `/api/customer_groups/customer-groups?ids=${encodeURIComponent(id)}&pageSize=1`,
  )
  if (!call.ok || !call.result) return null
  const [group] = mapListItemsToSummaries(call.result.items)
  return group ?? null
}

function formatGroupLabel(group: CustomerGroupSummary): string {
  return group.code ? `${group.name} (${group.code})` : group.name
}

// Walks up from `startId` via `parentId` one lookup per level. The hierarchy is
// capped at depth 5, so this stays a handful of requests; the visited set and the
// lookup cap keep it bounded even against already-corrupt cyclical data.
async function loadAncestorChain(startId: string): Promise<string[]> {
  const chain: string[] = []
  const visited = new Set<string>()
  let currentId: string | null = startId
  while (currentId && !visited.has(currentId) && chain.length < MAX_ANCESTOR_LOOKUPS) {
    visited.add(currentId)
    chain.push(currentId)
    const group = await fetchGroupById(currentId)
    currentId = group?.parentId ?? null
  }
  return chain
}

export function CustomerGroupParentField({
  value,
  setValue,
  disabled,
  excludeId,
}: CustomerGroupParentFieldProps) {
  const t = useT()
  const selectedId = typeof value === 'string' && value.length ? value : ''
  const [chainLength, setChainLength] = React.useState(0)
  const [cycleRejected, setCycleRejected] = React.useState(false)
  const [validating, setValidating] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setChainLength(0)
      return
    }
    loadAncestorChain(selectedId)
      .then((chain) => {
        if (!cancelled) setChainLength(chain.length)
      })
      .catch(() => {
        if (!cancelled) setChainLength(0)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const loadSuggestions = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const params = new URLSearchParams({ pageSize: '20', sortField: 'name', sortDir: 'asc' })
      const trimmed = (query ?? '').trim()
      if (trimmed) params.set('search', trimmed)
      const call = await apiCall<{ items?: unknown[] }>(`/api/customer_groups/customer-groups?${params.toString()}`)
      if (!call.ok || !call.result) return []
      return mapListItemsToSummaries(call.result.items)
        .filter((group) => group.id !== excludeId)
        .map((group) => ({ value: group.id, label: formatGroupLabel(group) }))
    },
    [excludeId],
  )

  const resolveLabel = React.useCallback(async (id: string) => {
    const group = await fetchGroupById(id)
    return group ? formatGroupLabel(group) : id
  }, [])

  const handleChange = React.useCallback(
    async (next: string) => {
      if (!next) {
        setCycleRejected(false)
        setValue(null)
        return
      }
      if (!excludeId) {
        setCycleRejected(false)
        setValue(next)
        return
      }
      setValidating(true)
      try {
        const chain = await loadAncestorChain(next)
        if (chain.includes(excludeId)) {
          setCycleRejected(true)
          return
        }
        setCycleRejected(false)
        setValue(next)
      } finally {
        setValidating(false)
      }
    },
    [excludeId, setValue],
  )

  const showDepthWarning = Boolean(selectedId) && chainLength >= CUSTOMER_GROUP_DEPTH_WARNING_THRESHOLD

  return (
    <div className="space-y-2">
      <ComboboxInput
        value={selectedId}
        onChange={(next) => {
          void handleChange(next)
        }}
        disabled={disabled || validating}
        allowCustomValues={false}
        clearable
        placeholder={t('customer_groups.groups.form.field.parentPlaceholder', 'No parent (top level)')}
        loadSuggestions={loadSuggestions}
        resolveLabel={resolveLabel}
      />
      {cycleRejected ? (
        <Alert status="error" size="xs">
          {t(
            'customer_groups.groups.form.field.parentCycle',
            'A group cannot be moved under one of its own subgroups.',
          )}
        </Alert>
      ) : null}
      {showDepthWarning ? (
        <Alert status="warning" size="xs">
          {t(
            'customer_groups.groups.form.field.parentDepthWarning',
            'This parent is already deeply nested — this group would land at hierarchy depth 5 or deeper.',
          )}
        </Alert>
      ) : null}
    </div>
  )
}
