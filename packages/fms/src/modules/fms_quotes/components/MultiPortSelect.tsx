'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type SearchResultItem = {
  entityId: string
  recordId: string
  score: number
  source: string
  presenter?: {
    title: string
    subtitle?: string
    icon?: string
    badge?: string
  }
  url?: string
}

type SearchResponse = {
  results: SearchResultItem[]
  strategiesUsed: string[]
  timing: number
  query: string
  limit: number
}

export type SelectedPort = {
  id: string
  label: string
  description?: string | null
}

export type MultiPortSelectProps = {
  value: SelectedPort[]
  onChange: (ports: SelectedPort[]) => void
  placeholder?: string
  disabled?: boolean
}

export function MultiPortSelect({
  value,
  onChange,
  placeholder = 'Search for port...',
  disabled = false,
}: MultiPortSelectProps) {
  const [searchValue, setSearchValue] = React.useState('')

  const loadLocations = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      if (!query || query.trim().length === 0) return []
      const params = new URLSearchParams({
        q: query.trim(),
        limit: '20',
        entityTypes: 'fms_locations:fms_location',
      })
      const response = await apiCall<SearchResponse>(`/api/search/search?${params}`)
      if (!response.ok || !response.result?.results) return []

      // Filter out already selected ports
      const selectedIds = new Set(value.map((p) => p.id))

      return response.result.results
        .filter((item) => !selectedIds.has(item.recordId))
        .map((item) => ({
          value: item.recordId,
          label: item.presenter?.title ?? '',
          description: item.presenter?.subtitle || null,
        }))
    },
    [value]
  )

  const handleSelect = React.useCallback(
    (selectedId: string) => {
      if (!selectedId) return

      // Find the option data from the search
      // Since we don't have the label here, we need to store it when selected
      // We'll use a workaround - store the ID and resolve later, or pass it through
      setSearchValue('')
    },
    []
  )

  // Custom handler that captures the full option data
  const handleComboboxChange = React.useCallback(
    (selectedId: string, options?: ComboboxOption[]) => {
      if (!selectedId) {
        setSearchValue('')
        return
      }

      // Find the option in loaded suggestions
      // This is a bit hacky but works with the current ComboboxInput
      const option = options?.find((o) => o.value === selectedId)
      if (option) {
        onChange([
          ...value,
          {
            id: option.value,
            label: option.label,
            description: option.description,
          },
        ])
      }
      setSearchValue('')
    },
    [onChange, value]
  )

  const handleRemove = React.useCallback(
    (portId: string) => {
      onChange(value.filter((p) => p.id !== portId))
    },
    [onChange, value]
  )

  // Wrapper for combobox that captures selected option data
  const [loadedOptions, setLoadedOptions] = React.useState<ComboboxOption[]>([])

  const wrappedLoadLocations = React.useCallback(
    async (query?: string): Promise<ComboboxOption[]> => {
      const options = await loadLocations(query)
      setLoadedOptions(options)
      return options
    },
    [loadLocations]
  )

  return (
    <div className="space-y-2">
      {/* Selected ports as chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((port) => (
            <div
              key={port.id}
              className="flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-md text-sm"
            >
              <span className="text-blue-800">{port.label}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(port.id)}
                  className="text-blue-600 hover:text-blue-800 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search input for adding more ports */}
      {!disabled && (
        <ComboboxInput
          value={searchValue}
          onChange={(next) => {
            if (next && next !== searchValue) {
              // A selection was made
              const option = loadedOptions.find((o) => o.value === next)
              if (option) {
                onChange([
                  ...value,
                  {
                    id: option.value,
                    label: option.label,
                    description: option.description,
                  },
                ])
                setSearchValue('')
                setLoadedOptions([])
              }
            } else {
              setSearchValue(next)
            }
          }}
          placeholder={placeholder}
          loadSuggestions={wrappedLoadLocations}
          allowCustomValues={false}
        />
      )}
    </div>
  )
}
