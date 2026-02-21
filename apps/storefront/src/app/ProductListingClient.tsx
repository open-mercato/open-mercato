'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { ProductGrid } from '@/components/ProductGrid'
import { ProductFilters } from '@/components/ProductFilters'
import { FilterChips } from '@/components/FilterChips'
import { SortSelect } from '@/components/SortSelect'
import { Pagination } from '@/components/Pagination'
import { useStorefrontFilters } from '@/lib/useStorefrontFilters'
import type { ProductListResponse, StorefrontFilters } from '@/lib/types'

type ProductListingClientProps = {
  data: ProductListResponse | null
  searchParamsSnapshot: Record<string, string | string[] | undefined>
}

function ProductListingInner({ data }: ProductListingClientProps) {
  const { filters, setFilter, resetFilters } = useStorefrontFilters()

  const handleRemoveFilter = <K extends keyof StorefrontFilters>(key: K, value?: string) => {
    if (key === 'tagIds' && value) {
      setFilter('tagIds', filters.tagIds.filter((t) => t !== value))
    } else if (key === 'priceMin' || key === 'priceMax') {
      setFilter('priceMin', '')
      setFilter('priceMax', '')
    } else {
      setFilter(key, '' as StorefrontFilters[K])
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center text-gray-400 sm:px-6 lg:px-8">
        Unable to load products. Please try again later.
      </div>
    )
  }

  const hasFilters =
    !!filters.search ||
    !!filters.categoryId ||
    filters.tagIds.length > 0 ||
    !!filters.priceMin ||
    !!filters.priceMax

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-4xl font-light tracking-tight text-gray-900">Products</h1>
        {data.total > 0 && (
          <p className="mt-1 text-sm text-gray-500">{data.total} items</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        {data.filters && (
          <ProductFilters
            filtersData={data.filters}
            filters={filters}
            onFilterChange={setFilter}
          />
        )}

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <FilterChips
              filters={filters}
              filtersData={data.filters ?? null}
              onRemove={handleRemoveFilter}
              onReset={resetFilters}
            />
            <div className="ml-auto">
              <SortSelect value={filters.sort} onChange={(v) => setFilter('sort', v)} />
            </div>
          </div>

          <ProductGrid products={data.items} />

          {data.totalPages > 1 && (
            <div className="mt-10">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                onPageChange={(p) => setFilter('page', p)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ProductListingClient(props: ProductListingClientProps) {
  return (
    <Suspense>
      <ProductListingInner {...props} />
    </Suspense>
  )
}
