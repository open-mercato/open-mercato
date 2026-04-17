'use client'
import { useCallback } from 'react'
import { usePersistedBooleanFlag } from './usePersistedBooleanFlag'

function getStorageKey(pageType: string, groupId: string) {
  return `om:collapsible:${pageType}:${groupId}`
}

export function useGroupCollapse(pageType: string, groupId: string, defaultExpanded = true) {
  const { value: expanded, toggle, setValue } = usePersistedBooleanFlag(
    getStorageKey(pageType, groupId),
    defaultExpanded,
  )
  const setExpanded = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    if (typeof next === 'function') {
      setValue((prev) => (next as (prev: boolean) => boolean)(prev))
    } else {
      setValue(next)
    }
  }, [setValue])
  return { expanded, toggle, setExpanded }
}
