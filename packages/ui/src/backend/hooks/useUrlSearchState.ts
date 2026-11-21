"use client"
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export type UseUrlSearchStateOptions = {
  paramName?: string
}

export type UrlSearchState = [string, React.Dispatch<React.SetStateAction<string>>]

export const DEFAULT_URL_SEARCH_PARAM = 'search'

export function normalizeUrlSearchValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildUrlWithSearch(
  pathname: string,
  currentQuery: string,
  value: string,
  paramName: string = DEFAULT_URL_SEARCH_PARAM,
): string {
  const params = new URLSearchParams(currentQuery)
  const normalized = normalizeUrlSearchValue(value)
  if (normalized) params.set(paramName, normalized)
  else params.delete(paramName)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function useUrlSearchState(options: UseUrlSearchStateOptions = {}): UrlSearchState {
  const paramName = options.paramName ?? DEFAULT_URL_SEARCH_PARAM
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlSearch = normalizeUrlSearchValue(searchParams?.get(paramName))
  const [search, setSearch] = React.useState<string>(urlSearch)
  const syncedValueRef = React.useRef(urlSearch)
  const navigationRef = React.useRef({ router, pathname, query: searchParams?.toString() ?? '' })
  navigationRef.current = { router, pathname, query: searchParams?.toString() ?? '' }

  React.useEffect(() => {
    if (urlSearch === syncedValueRef.current) return
    syncedValueRef.current = urlSearch
    setSearch(urlSearch)
  }, [urlSearch])

  React.useEffect(() => {
    const next = normalizeUrlSearchValue(search)
    if (next === syncedValueRef.current) return
    const { router: currentRouter, pathname: currentPathname, query } = navigationRef.current
    if (!currentPathname) return
    syncedValueRef.current = next
    currentRouter.replace(buildUrlWithSearch(currentPathname, query, next, paramName), { scroll: false })
  }, [search, paramName])

  return [search, setSearch]
}
