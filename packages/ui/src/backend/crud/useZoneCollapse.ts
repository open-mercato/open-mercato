'use client'
import { useCallback } from 'react'
import { usePersistedBooleanFlag } from './usePersistedBooleanFlag'

function getStorageKey(pageType: string) {
  return `om:zone1-collapsed:${pageType}`
}

export function useZoneCollapse(pageType: string) {
  const { value: collapsed, toggle, setValue, isHydrated } = usePersistedBooleanFlag(
    getStorageKey(pageType),
    false,
  )
  const setCollapsed = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    if (typeof next === 'function') {
      setValue((prev) => (next as (prev: boolean) => boolean)(prev))
    } else {
      setValue(next)
    }
  }, [setValue])
  return { collapsed, toggle, setCollapsed, isHydrated }
}
