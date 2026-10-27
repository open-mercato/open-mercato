"use client"

import * as React from 'react'
import { TagsInput, type TagsInputOption } from '@open-mercato/ui/backend/inputs/TagsInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { managerLabel, type ManagerRecord } from './buildingRecord'

type CandidatesResponse = { items?: ManagerRecord[] }

export type ManagersFieldProps = {
  value: unknown
  setValue: (value: unknown) => void
  canManageAll: boolean
  initialManagers: readonly ManagerRecord[]
  disabled?: boolean
}

function toOption(manager: ManagerRecord): TagsInputOption {
  return { value: manager.userId, label: managerLabel(manager), description: manager.name && manager.email ? manager.email : null }
}

export function ManagersField({ value, setValue, canManageAll, initialManagers, disabled }: ManagersFieldProps) {
  const t = useT()
  const [known, setKnown] = React.useState<TagsInputOption[]>(() => initialManagers.map(toOption))
  const selected = React.useMemo(
    () => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []),
    [value],
  )

  const loadSuggestions = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams()
    if (query?.trim()) params.set('search', query.trim())
    const call = await apiCall<CandidatesResponse>(`/api/property_management/manager-candidates?${params.toString()}`, undefined, {
      fallback: { items: [] },
    })
    const options = (call.ok && Array.isArray(call.result?.items) ? call.result.items : []).map(toOption)
    setKnown((current) => {
      const merged = new Map(current.map((option) => [option.value, option]))
      for (const option of options) merged.set(option.value, option)
      return Array.from(merged.values())
    })
    return options
  }, [])

  const selectedOptions = React.useMemo(
    () => known.filter((option) => selected.includes(option.value)),
    [known, selected],
  )

  if (!canManageAll) {
    return (
      <div className="space-y-1">
        <p className="text-sm">
          {initialManagers.length
            ? initialManagers.map(managerLabel).join(', ')
            : t('property_management.buildings.form.noManagers', 'No managers assigned')}
        </p>
      </div>
    )
  }

  return (
    <TagsInput
      value={selected}
      onChange={(next) => setValue(next)}
      loadSuggestions={loadSuggestions}
      selectedOptions={selectedOptions}
      resolveLabel={(id) => known.find((option) => option.value === id)?.label ?? id}
      allowCustomValues={false}
      showSuggestionsOnFocus
      placeholder={t('property_management.buildings.form.addManager', 'Add manager')}
      disabled={disabled}
    />
  )
}
