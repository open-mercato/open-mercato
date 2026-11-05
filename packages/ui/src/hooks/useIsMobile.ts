'use client'

import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 767

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getSnapshot() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
}

function getServerSnapshot() {
  return false
}

/**
 * SSR-safe hook that returns true when the viewport is below Tailwind's `md:` breakpoint (768px).
 * Uses `useSyncExternalStore` for correct first-render values without hydration flash.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
