"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  DOCUMENT_ENTITY_REGISTRY,
  readItemsArray,
  type DocumentEntityType,
  type DocumentEntityRegistryEntry,
  type EntityPickerItem,
} from '../../../lib/entityRegistry'
import { useAvailableDocumentEntityRegistry } from './useAvailableEntityRegistry'

const PAGE_SIZE = 20
const DEBOUNCE_MS = 250
export type EntitySearchItem = EntityPickerItem & { rawItem: Record<string, unknown> }

function filterEntries(typeFilter: DocumentEntityType[] | undefined): DocumentEntityRegistryEntry[] {
  if (!typeFilter) return DOCUMENT_ENTITY_REGISTRY
  const allowedTypes = new Set(typeFilter)
  return DOCUMENT_ENTITY_REGISTRY.filter((entry) => allowedTypes.has(entry.type))
}

function buildSearchUrl(entry: DocumentEntityRegistryEntry, query: string): string {
  const params = new URLSearchParams({ search: query, page: '1', pageSize: String(PAGE_SIZE) })
  return `${entry.searchPath}?${params.toString()}`
}

function buildResultContext(open: boolean, type: DocumentEntityType | null, query: string): string {
  return JSON.stringify([open, type, query.trim()])
}

export function useEntitySearch(open: boolean, typeFilter?: DocumentEntityType[]) {
  const typeFilterKey = typeFilter?.join('|') ?? ''
  const requestSequence = React.useRef(0)
  const activeRequest = React.useRef<AbortController | null>(null)
  const activeContext = React.useRef('')
  const resultContext = React.useRef<string | null>(null)
  const allEntries = React.useMemo(() => filterEntries(typeFilter), [typeFilterKey])
  const { entries: moduleAvailableEntries } = useAvailableDocumentEntityRegistry(allEntries)
  const [unavailableTypes, setUnavailableTypes] = React.useState<Set<DocumentEntityType>>(() => new Set())
  const availableEntries = React.useMemo(
    () => moduleAvailableEntries.filter((entry) => !unavailableTypes.has(entry.type)),
    [moduleAvailableEntries, unavailableTypes],
  )
  const [activeType, setActiveTypeState] = React.useState<DocumentEntityType | null>(
    moduleAvailableEntries[0]?.type ?? null,
  )
  const [searchValue, setSearchValueState] = React.useState('')
  const [items, setItems] = React.useState<EntitySearchItem[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const activeEntry = React.useMemo(
    () => availableEntries.find((entry) => entry.type === activeType) ?? availableEntries[0] ?? null,
    [activeType, availableEntries],
  )
  const currentContext = buildResultContext(open, activeEntry?.type ?? null, searchValue)
  activeContext.current = currentContext

  const invalidateResults = React.useCallback(() => {
    requestSequence.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    resultContext.current = null
    setItems([])
    setIsLoading(false)
    setHasSearched(false)
    setActiveIndex(-1)
  }, [])

  const setActiveType = React.useCallback((nextType: DocumentEntityType | null) => {
    // Invalidate before changing the active registry entry. Otherwise a fast
    // Enter/click can submit a result produced for the previous entity type,
    // and an already-resolving request can repopulate that stale selection.
    activeContext.current = buildResultContext(open, nextType, searchValue)
    invalidateResults()
    setActiveTypeState(nextType)
  }, [invalidateResults, open, searchValue])

  const setSearchValue = React.useCallback((nextValue: string) => {
    activeContext.current = buildResultContext(open, activeEntry?.type ?? null, nextValue)
    invalidateResults()
    setSearchValueState(nextValue)
  }, [activeEntry?.type, invalidateResults, open])

  React.useEffect(() => {
    invalidateResults()
    if (!open) return
    setUnavailableTypes(new Set())
    setActiveTypeState(moduleAvailableEntries[0]?.type ?? null)
    setSearchValueState('')
  }, [invalidateResults, moduleAvailableEntries, open])

  React.useEffect(() => {
    if (open && activeEntry && activeType !== activeEntry.type) setActiveType(activeEntry.type)
  }, [activeEntry, activeType, open, setActiveType])

  React.useEffect(() => {
    if (!open || !activeEntry) return
    const query = searchValue.trim()
    if (!query) {
      invalidateResults()
      return
    }
    const entry = activeEntry
    const timer = window.setTimeout(() => {
      const requestId = ++requestSequence.current
      const requestContext = buildResultContext(true, entry.type, query)
      const controller = new AbortController()
      activeRequest.current?.abort()
      activeRequest.current = controller
      resultContext.current = null
      setIsLoading(true)
      setHasSearched(false)
      void apiCall<unknown>(
        buildSearchUrl(entry, query),
        {
          headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
          signal: controller.signal,
        },
        { fallback: { items: [] } },
      ).then((call) => {
        if (requestSequence.current !== requestId || activeContext.current !== requestContext) return
        if (!call.ok) {
          resultContext.current = null
          setUnavailableTypes((current) => new Set(current).add(entry.type))
          setItems([])
          return
        }
        const next = readItemsArray(call.result).flatMap((rawItem) => {
          const item = entry.mapItem(rawItem)
          return item ? [{ ...item, rawItem }] : []
        })
        resultContext.current = requestContext
        setItems(next)
        setHasSearched(true)
        setActiveIndex(next.length > 0 ? 0 : -1)
      }).catch(() => {
        if (!controller.signal.aborted && requestSequence.current === requestId && activeContext.current === requestContext) {
          resultContext.current = null
          setUnavailableTypes((current) => new Set(current).add(entry.type))
        }
      }).finally(() => {
        if (requestSequence.current === requestId) {
          if (activeRequest.current === controller) activeRequest.current = null
          setIsLoading(false)
        }
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [activeEntry, invalidateResults, open, searchValue])

  React.useEffect(() => () => { activeRequest.current?.abort() }, [])

  const hasCurrentResult = resultContext.current !== null && resultContext.current === currentContext
  const isResultCurrent = React.useCallback(
    () => resultContext.current !== null && resultContext.current === activeContext.current,
    [],
  )

  return {
    allEntries, availableEntries, activeEntry, activeType, setActiveType,
    searchValue, setSearchValue, items: hasCurrentResult ? items : [], isLoading,
    hasSearched: hasCurrentResult && hasSearched,
    activeIndex: hasCurrentResult ? activeIndex : -1, setActiveIndex, isResultCurrent,
  }
}
