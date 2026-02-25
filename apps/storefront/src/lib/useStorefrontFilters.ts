'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { StorefrontFilters } from './types'

const DEFAULT_FILTERS: StorefrontFilters = {
  search: '',
  categoryId: '',
  tagIds: [],
  priceMin: '',
  priceMax: '',
  sort: '',
  page: 1,
}

export function useStorefrontFilters(): {
  filters: StorefrontFilters
  setFilter: <K extends keyof StorefrontFilters>(key: K, value: StorefrontFilters[K]) => void
  resetFilters: () => void
  buildApiParams: () => Record<string, string>
} {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filters = React.useMemo<StorefrontFilters>(() => ({
    search: searchParams.get('search') ?? '',
    categoryId: searchParams.get('categoryId') ?? '',
    tagIds: searchParams.getAll('tagId'),
    priceMin: searchParams.get('priceMin') ?? '',
    priceMax: searchParams.get('priceMax') ?? '',
    sort: searchParams.get('sort') ?? '',
    page: Number(searchParams.get('page') ?? '1') || 1,
  }), [searchParams])

  const updateUrl = React.useCallback((updates: Partial<StorefrontFilters>) => {
    const next = { ...filters, ...updates }
    const params = new URLSearchParams()
    if (next.search) params.set('search', next.search)
    if (next.categoryId) params.set('categoryId', next.categoryId)
    for (const tag of next.tagIds) params.append('tagId', tag)
    if (next.priceMin) params.set('priceMin', next.priceMin)
    if (next.priceMax) params.set('priceMax', next.priceMax)
    if (next.sort) params.set('sort', next.sort)
    if (next.page > 1) params.set('page', String(next.page))
    const qs = params.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ''}`)
  }, [filters, router, pathname])

  const setFilter = React.useCallback(<K extends keyof StorefrontFilters>(key: K, value: StorefrontFilters[K]) => {
    const reset = key !== 'page' ? { page: 1 } : {}
    updateUrl({ [key]: value, ...reset })
  }, [updateUrl])

  const resetFilters = React.useCallback(() => {
    router.push(pathname)
  }, [router, pathname])

  const buildApiParams = React.useCallback((): Record<string, string> => {
    const params: Record<string, string> = {}
    if (filters.search) params.search = filters.search
    if (filters.categoryId) params.categoryId = filters.categoryId
    if (filters.tagIds.length) params.tagIds = filters.tagIds.join(',')
    if (filters.priceMin) params.priceMin = filters.priceMin
    if (filters.priceMax) params.priceMax = filters.priceMax
    if (filters.sort) params.sort = filters.sort
    if (filters.page > 1) params.page = String(filters.page)
    return params
  }, [filters])

  return { filters, setFilter, resetFilters, buildApiParams }
}

export { DEFAULT_FILTERS }
