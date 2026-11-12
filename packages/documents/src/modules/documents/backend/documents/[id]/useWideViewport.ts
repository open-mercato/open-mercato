"use client"

import { useSyncExternalStore } from 'react'

const WIDE_VIEWPORT_QUERY = '(min-width: 1280px)'

function matchMediaAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

function subscribe(callback: () => void) {
  if (!matchMediaAvailable()) return () => undefined
  const mediaQuery = window.matchMedia(WIDE_VIEWPORT_QUERY)
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getSnapshot() {
  return matchMediaAvailable() && window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

function getServerSnapshot() {
  return false
}

export function useWideViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
