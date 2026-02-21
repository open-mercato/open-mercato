'use client'

import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ProductFiltersData, StorefrontFilters } from '@/lib/types'

type ProductFiltersProps = {
  filtersData: ProductFiltersData
  filters: StorefrontFilters
  onFilterChange: <K extends keyof StorefrontFilters>(key: K, value: StorefrontFilters[K]) => void
}

export function ProductFilters({ filtersData, filters, onFilterChange }: ProductFiltersProps) {
  return (
    <aside className="space-y-6">
      {filtersData.categories.length > 0 && (
        <FilterSection title="Category">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="category"
                checked={!filters.categoryId}
                onChange={() => onFilterChange('categoryId', '')}
                className="accent-gray-900"
              />
              <span className="text-gray-700">All</span>
            </label>
            {filtersData.categories.map((cat) => (
              <label key={cat.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="category"
                  checked={filters.categoryId === cat.id}
                  onChange={() => onFilterChange('categoryId', cat.id)}
                  className="accent-gray-900"
                />
                <span className="flex-1 text-gray-700">{cat.name}</span>
                <span className="text-xs text-gray-400">{cat.count}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      )}

      {filtersData.priceRange && (
        <FilterSection title="Price">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Min"
                value={filters.priceMin}
                onChange={(e) => onFilterChange('priceMin', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-300 focus:border-gray-400 focus:outline-none"
                min={0}
              />
              <span className="text-gray-300">–</span>
              <input
                type="number"
                placeholder="Max"
                value={filters.priceMax}
                onChange={(e) => onFilterChange('priceMax', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-300 focus:border-gray-400 focus:outline-none"
                min={0}
              />
            </div>
          </div>
        </FilterSection>
      )}

      {filtersData.tags.length > 0 && (
        <FilterSection title="Tags">
          <div className="space-y-2">
            {filtersData.tags.map((tag) => (
              <label key={tag.slug} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.tagIds.includes(tag.slug)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...filters.tagIds, tag.slug]
                      : filters.tagIds.filter((t) => t !== tag.slug)
                    onFilterChange('tagIds', next)
                  }}
                  className="accent-gray-900"
                />
                <span className="flex-1 text-gray-700">{tag.label}</span>
                <span className="text-xs text-gray-400">{tag.count}</span>
              </label>
            ))}
          </div>
        </FilterSection>
      )}

      {filtersData.options.map((option) => (
        <FilterSection key={option.code} title={option.label}>
          <div className="flex flex-wrap gap-2">
            {option.values.map((val) => (
              <button
                key={val.code}
                className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700 transition-colors hover:border-gray-400"
              >
                {val.label}
                <span className="ml-1 text-gray-400">({val.count})</span>
              </button>
            ))}
          </div>
        </FilterSection>
      ))}
    </aside>
  )
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true)
  return (
    <div className="border-b border-gray-100 pb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-sm font-semibold text-gray-900"
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}
