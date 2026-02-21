'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import type { StorefrontFilters, ProductFiltersData } from '@/lib/types'

type FilterChipsProps = {
  filters: StorefrontFilters
  filtersData: ProductFiltersData | null
  onRemove: <K extends keyof StorefrontFilters>(key: K, value?: string) => void
  onReset: () => void
}

export function FilterChips({ filters, filtersData, onRemove, onReset }: FilterChipsProps) {
  const chips: Array<{ label: string; onRemove: () => void }> = []

  if (filters.search) {
    chips.push({ label: `"${filters.search}"`, onRemove: () => onRemove('search') })
  }

  if (filters.categoryId && filtersData) {
    const cat = filtersData.categories.find((c) => c.id === filters.categoryId)
    if (cat) {
      chips.push({ label: cat.name, onRemove: () => onRemove('categoryId') })
    }
  }

  for (const tagId of filters.tagIds) {
    const tag = filtersData?.tags.find((t) => t.slug === tagId)
    chips.push({
      label: tag?.label ?? tagId,
      onRemove: () => onRemove('tagIds', tagId),
    })
  }

  if (filters.priceMin || filters.priceMax) {
    const label =
      filters.priceMin && filters.priceMax
        ? `${filters.priceMin} – ${filters.priceMax}`
        : filters.priceMin
          ? `From ${filters.priceMin}`
          : `Up to ${filters.priceMax}`
    chips.push({
      label,
      onRemove: () => {
        onRemove('priceMin')
        onRemove('priceMax')
      },
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip, index) => (
        <button
          key={index}
          onClick={chip.onRemove}
          className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100"
        >
          {chip.label}
          <X className="h-3 w-3 text-gray-400" />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          onClick={onReset}
          className="text-sm text-gray-500 underline-offset-2 hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
