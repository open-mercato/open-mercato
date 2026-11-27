"use client"

import { useSyncExternalStore } from 'react'

const WIDE_VIEWPORT_QUERY = '(min-width: 1280px)'
const ROOMY_VIEWPORT_QUERY = '(min-width: 1536px)'

function matchMediaAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

function createViewportStore(query: string) {
  return {
    subscribe(callback: () => void) {
      if (!matchMediaAvailable()) return () => undefined
      const mediaQuery = window.matchMedia(query)
      mediaQuery.addEventListener('change', callback)
      return () => mediaQuery.removeEventListener('change', callback)
    },
    getSnapshot() {
      return matchMediaAvailable() && window.matchMedia(query).matches
    },
  }
}

const wideViewport = createViewportStore(WIDE_VIEWPORT_QUERY)
const roomyViewport = createViewportStore(ROOMY_VIEWPORT_QUERY)

function getServerSnapshot() {
  return false
}

export function useWideViewport(): boolean {
  return useSyncExternalStore(wideViewport.subscribe, wideViewport.getSnapshot, getServerSnapshot)
}

/** Room for the review workspace outline column next to the paper and the side panel. */
export function useRoomyViewport(): boolean {
  return useSyncExternalStore(roomyViewport.subscribe, roomyViewport.getSnapshot, getServerSnapshot)
}
