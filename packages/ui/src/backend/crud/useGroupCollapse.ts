'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

function getStorageKey(pageType: string, groupId: string) {
  return `om:collapsible:${pageType}:${groupId}`
}

export function useGroupCollapse(pageType: string, groupId: string, defaultExpanded = true) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const saved = readJsonFromLocalStorage<string | null>(getStorageKey(pageType, groupId), null)
    if (saved !== null) {
      setExpanded(saved === '1')
    }
  }, [pageType, groupId])

  useEffect(() => {
    if (!mounted.current) return
    writeJsonToLocalStorage(getStorageKey(pageType, groupId), expanded ? '1' : '0')
  }, [expanded, pageType, groupId])

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return { expanded, toggle, setExpanded }
}
