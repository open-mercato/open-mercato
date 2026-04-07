'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

function getStorageKey(pageType: string) {
  return `om:zone1-collapsed:${pageType}`
}

export function useZoneCollapse(pageType: string) {
  const [collapsed, setCollapsed] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    try {
      const saved = localStorage.getItem(getStorageKey(pageType))
      if (saved !== null) {
        setCollapsed(saved === '1')
      }
    } catch {}
  }, [pageType])

  useEffect(() => {
    if (!mounted.current) return
    try {
      localStorage.setItem(getStorageKey(pageType), collapsed ? '1' : '0')
    } catch {}
  }, [collapsed, pageType])

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  return { collapsed, toggle, setCollapsed }
}
