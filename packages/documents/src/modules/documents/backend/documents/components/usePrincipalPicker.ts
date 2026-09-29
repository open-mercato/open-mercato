"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  buildPrincipalUrl,
  mergePrincipalOptions,
  PRINCIPAL_DEBOUNCE_MS,
  PRINCIPAL_SEARCH_MIN_LENGTH,
  readPrincipalPage,
  type PrincipalListPayload,
  type PrincipalOption,
  type PrincipalType,
} from './principalPickerModel'

const OPTIONAL_HEADERS = { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' }

function buildResultContext(documentId: string, principalType: PrincipalType, query: string): string {
  return JSON.stringify([documentId, principalType, query.trim()])
}

export function usePrincipalPicker({ documentId, principalType, value, onChange, disabled, fallbackLabel }: {
  documentId: string
  principalType: PrincipalType
  value: string | null
  onChange: (id: string | null, label: string | null) => void
  disabled: boolean
  fallbackLabel: string
}) {
  const request = React.useRef(0)
  const activeRequest = React.useRef<AbortController | null>(null)
  const activeContext = React.useRef('')
  const resultContext = React.useRef<string | null>(null)
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const [searchValue, setSearchValue] = React.useState('')
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<PrincipalOption[]>([])
  const [open, setOpenState] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [fetchError, setFetchError] = React.useState(false)
  const [hasFetched, setHasFetched] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const currentContext = buildResultContext(documentId, principalType, searchValue)
  activeContext.current = currentContext

  const invalidateResults = React.useCallback(() => {
    request.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    resultContext.current = null
    setItems([]); setLoading(false); setLoadingMore(false); setHasFetched(false)
    setPage(1); setTotal(0); setTotalPages(1); setActiveIndex(-1)
  }, [])

  React.useEffect(() => {
    if (!disabled) return
    invalidateResults()
    setOpenState(false)
    setFetchError(false)
  }, [disabled, invalidateResults])

  const reset = React.useCallback((notify: boolean) => {
    invalidateResults()
    setSearchValue(''); setSelectedLabel(null); setOpenState(false); setFetchError(false)
    if (notify) onChangeRef.current(null, null)
  }, [invalidateResults])
  React.useEffect(() => { reset(false) }, [documentId, principalType, reset])
  React.useEffect(() => { if (!value) reset(false) }, [reset, value])

  const enterError = React.useCallback(() => {
    invalidateResults()
    setFetchError(true); setOpenState(false)
  }, [invalidateResults])

  const fetchPage = React.useCallback(async (query: string, nextPage: number, append: boolean) => {
    const requestId = ++request.current
    const requestContext = buildResultContext(documentId, principalType, query)
    const controller = new AbortController()
    activeRequest.current?.abort()
    activeRequest.current = controller
    if (append) setLoadingMore(true)
    else { resultContext.current = null; setItems([]); setLoading(true); setHasFetched(false); setActiveIndex(-1) }
    setFetchError(false)
    try {
      const call = await apiCall<PrincipalListPayload>(
        buildPrincipalUrl(documentId, principalType, query, nextPage),
        { headers: OPTIONAL_HEADERS, signal: controller.signal },
        { fallback: { items: [], total: 0, totalPages: 1 } },
      )
      if (request.current !== requestId || activeContext.current !== requestContext) return
      if (!call.ok) { enterError(); return }
      const result = readPrincipalPage(call.result, principalType, nextPage, fallbackLabel)
      resultContext.current = requestContext
      setItems((current) => append ? mergePrincipalOptions(current, result.items) : result.items)
      setPage(nextPage); setTotal(result.total); setTotalPages(result.totalPages)
      setFetchError(false); setHasFetched(true); setOpenState(true)
      if (!append) setActiveIndex(result.items.length ? 0 : -1)
      else if (result.items.length) setActiveIndex((current) => current < 0 ? 0 : current)
    } catch {
      if (!controller.signal.aborted && request.current === requestId && activeContext.current === requestContext) enterError()
    } finally {
      if (request.current === requestId) {
        if (activeRequest.current === controller) activeRequest.current = null
        append ? setLoadingMore(false) : setLoading(false)
      }
    }
  }, [documentId, enterError, fallbackLabel, principalType])

  React.useEffect(() => {
    if (disabled || fetchError || !open || selectedLabel) return
    const query = searchValue.trim()
    if (query.length > 0 && query.length < PRINCIPAL_SEARCH_MIN_LENGTH) return
    const timer = window.setTimeout(() => { void fetchPage(query, 1, false) }, PRINCIPAL_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [disabled, fetchError, fetchPage, open, searchValue, selectedLabel])

  const selectOption = React.useCallback((option: PrincipalOption) => {
    if (disabled || resultContext.current === null || resultContext.current !== activeContext.current) return
    invalidateResults()
    setSelectedLabel(option.label); setSearchValue(''); setOpenState(false); setFetchError(false)
    onChangeRef.current(option.id, option.label)
  }, [disabled, invalidateResults])
  const changeSearch = React.useCallback((next: string) => {
    if (selectedLabel || value) onChangeRef.current(null, null)
    activeContext.current = buildResultContext(documentId, principalType, next)
    invalidateResults()
    setSelectedLabel(null); setSearchValue(next); setFetchError(false); setOpenState(true)
  }, [documentId, invalidateResults, principalType, selectedLabel, value])
  const setOpen = React.useCallback((nextOpen: boolean) => {
    if (disabled && nextOpen) return
    if (!nextOpen) invalidateResults()
    setOpenState(nextOpen)
  }, [disabled, invalidateResults])
  const loadMore = React.useCallback(() => {
    if (!disabled && resultContext.current === activeContext.current && !loading && !loadingMore && page < totalPages) {
      void fetchPage(searchValue.trim(), page + 1, true)
    }
  }, [disabled, fetchPage, loading, loadingMore, page, searchValue, totalPages])
  const retry = React.useCallback(() => { setFetchError(false); setOpenState(false); void fetchPage(searchValue.trim(), 1, false) }, [fetchPage, searchValue])
  const hasCurrentResult = resultContext.current !== null && resultContext.current === currentContext
  const visibleItems = hasCurrentResult ? items : []
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (!open || !visibleItems.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, visibleItems.length - 1)); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); return }
    if (event.key === 'Enter' && visibleItems[activeIndex]) { event.preventDefault(); selectOption(visibleItems[activeIndex]) }
  }, [activeIndex, open, selectOption, setOpen, visibleItems])

  React.useEffect(() => () => { activeRequest.current?.abort() }, [])

  return {
    searchValue, selectedLabel, items: visibleItems, open, setOpen, loading, loadingMore, fetchError,
    hasFetched: hasCurrentResult && hasFetched, page, total, totalPages,
    activeIndex: hasCurrentResult ? activeIndex : -1, setActiveIndex,
    displayValue: selectedLabel ?? searchValue, changeSearch, clear: () => reset(true),
    selectOption, loadMore, retry, handleKeyDown,
  }
}
