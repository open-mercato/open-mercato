'use client'

import { useState, useEffect } from 'react'

const MOBILE_BREAKPOINT = 767

/**
 * SSR-safe hook that returns true when the viewport is below Tailwind's `md:` breakpoint (768px).
 * Uses `matchMedia` for efficient, event-driven detection.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const handleChange = () => setIsMobile(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return isMobile
}
