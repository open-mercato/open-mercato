"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'

/**
 * Dashboard tiles and cross-screen links arrive as query parameters
 * (`?status=confirmed`), so a list has to seed its filter state from the URL or
 * the link lands on an unfiltered page that looks like it ignored the click.
 * Only the allowlisted keys are read — the query string is otherwise surface
 * area the table has no business interpreting.
 */
export function pickInitialFilters(query: string, allowlist: readonly string[]): FilterValues {
  const out: FilterValues = {}
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  for (const key of allowlist) {
    const value = params.get(key)
    if (typeof value === 'string' && value.trim().length) out[key] = value.trim()
  }
  return out
}

export function useInitialFilters(allowlist: readonly string[]): FilterValues {
  const searchParams = useSearchParams()
  const query = searchParams?.toString() ?? ''
  const allowlistKey = allowlist.join(',')
  return React.useMemo(
    () => pickInitialFilters(query, allowlistKey.length ? allowlistKey.split(',') : []),
    [query, allowlistKey],
  )
}
