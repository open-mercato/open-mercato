'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

function getStorageKey(pageType: string, groupId: string) {
  return `om:collapsible:${pageType}:${groupId}`
}

export function useGroupCollapse(pageType: string, groupId: string, defaultExpanded = true) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    try {
      const saved = localStorage.getItem(getStorageKey(pageType, groupId))
      if (saved !== null) {
        setExpanded(saved === '1')
      }
    } catch { /* localStorage may be unavailable in private browsing or SSR — fall back to default */ }
  }, [pageType, groupId])

  useEffect(() => {
    if (!mounted.current) return
    try {
      localStorage.setItem(getStorageKey(pageType, groupId), expanded ? '1' : '0')
    } catch { /* localStorage may be unavailable — preference not persisted, non-critical */ }
  }, [expanded, pageType, groupId])

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return { expanded, toggle, setExpanded }
}
