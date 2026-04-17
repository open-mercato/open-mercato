'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

function getStorageKey(pageType: string) {
  return `om:zone1-collapsed:${pageType}`
}

export function useZoneCollapse(pageType: string) {
  const [collapsed, setCollapsed] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const saved = readJsonFromLocalStorage<string | null>(getStorageKey(pageType), null)
    if (saved !== null) {
      setCollapsed(saved === '1')
    }
  }, [pageType])

  useEffect(() => {
    if (!mounted.current) return
    writeJsonToLocalStorage(getStorageKey(pageType), collapsed ? '1' : '0')
  }, [collapsed, pageType])

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  return { collapsed, toggle, setCollapsed }
}
