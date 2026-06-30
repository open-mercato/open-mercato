'use client'

import { useState, useCallback, useEffect } from 'react'
import type { DockPosition, DockState, FloatingPosition } from '../types'

const DOCK_STATE_KEY = 'om:ai-chat:dock-state'

const DEFAULT_DOCK_STATE: DockState = {
  position: 'floating',
  floatingPosition: 'bottom-right',
  width: 550,
  height: 700,
  isMinimized: false,
}

const MIN_WIDTH = 400
const MAX_WIDTH = 900
const MIN_HEIGHT = 500
const MAX_HEIGHT = 900

// Minimum width the main backoffice content needs to stay usable while a side
// (left/right) dock overlays the viewport. Below this the dense backoffice
// screens (dashboards, KPI cards, data tables) get clipped, so the side dock
// falls back to the floating panel instead.
export const MIN_DOCKED_CONTENT_WIDTH = 640

const SIDE_DOCK_POSITIONS: DockPosition[] = ['left', 'right']

function getViewportWidth(): number {
  if (typeof window === 'undefined') return Number.POSITIVE_INFINITY
  return window.innerWidth
}

/**
 * Resolve the dock position that is safe for the current viewport. Side
 * (left/right) docks overlay the main content, so when the leftover content
 * width would fall below {@link MIN_DOCKED_CONTENT_WIDTH} we fall back to the
 * floating panel. Floating and bottom docks never reduce content width, so they
 * are always allowed.
 */
export function resolveViewportSafeDockPosition(
  position: DockPosition,
  panelWidth: number,
  viewportWidth: number,
): DockPosition {
  if (!SIDE_DOCK_POSITIONS.includes(position)) return position
  if (viewportWidth - panelWidth >= MIN_DOCKED_CONTENT_WIDTH) return position
  return 'floating'
}

const DOCK_CYCLE_ORDER: DockPosition[] = ['floating', 'right', 'left', 'bottom']

/**
 * Resolve the next dock position when cycling. Side docks that the current
 * viewport cannot fit ({@link resolveViewportSafeDockPosition} collapses them to
 * floating) are skipped so cycling always advances to a position that is both
 * viewport-safe and different from the current one. Without this, a squeezed
 * side dock collapses back to floating and the cycle gets stuck before ever
 * reaching the bottom dock, which stays valid on narrow viewports.
 */
export function resolveNextCyclePosition(
  current: DockPosition,
  panelWidth: number,
  viewportWidth: number,
): DockPosition {
  const currentIndex = DOCK_CYCLE_ORDER.indexOf(current)
  for (let step = 1; step <= DOCK_CYCLE_ORDER.length; step += 1) {
    const candidate = DOCK_CYCLE_ORDER[(currentIndex + step) % DOCK_CYCLE_ORDER.length]
    const safePosition = resolveViewportSafeDockPosition(candidate, panelWidth, viewportWidth)
    if (safePosition !== current) return safePosition
  }
  return current
}

export function useDockPosition() {
  const [dockState, setDockState] = useState<DockState>(DEFAULT_DOCK_STATE)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DOCK_STATE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, unknown>
        // Migrate 'modal' to 'floating' for existing users
        const rawPosition = parsed.position as string | undefined
        const migratedPosition = rawPosition === 'modal' ? 'floating' : rawPosition
        const width = Math.min(Math.max((parsed.width as number) || DEFAULT_DOCK_STATE.width, MIN_WIDTH), MAX_WIDTH)
        const position = (migratedPosition as DockPosition) || DEFAULT_DOCK_STATE.position
        setDockState({
          position: resolveViewportSafeDockPosition(position, width, getViewportWidth()),
          floatingPosition: (parsed.floatingPosition as FloatingPosition) || DEFAULT_DOCK_STATE.floatingPosition,
          width,
          height: Math.min(Math.max((parsed.height as number) || DEFAULT_DOCK_STATE.height, MIN_HEIGHT), MAX_HEIGHT),
          isMinimized: (parsed.isMinimized as boolean) || false,
        })
      }
    } catch {
      // Ignore localStorage errors
    }
    setIsHydrated(true)
  }, [])

  // Persist state to localStorage
  useEffect(() => {
    if (!isHydrated) return
    try {
      localStorage.setItem(DOCK_STATE_KEY, JSON.stringify(dockState))
    } catch {
      // Ignore localStorage errors
    }
  }, [dockState, isHydrated])

  // Auto-undock a side dock to floating when the viewport becomes too narrow,
  // so the backoffice content area never gets squeezed below a usable width.
  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return
    const handleResize = () => {
      setDockState((prev) => {
        const safePosition = resolveViewportSafeDockPosition(prev.position, prev.width, window.innerWidth)
        if (safePosition === prev.position) return prev
        return { ...prev, position: safePosition }
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isHydrated])

  const setPosition = useCallback((position: DockPosition) => {
    setDockState((prev) => ({
      ...prev,
      position: resolveViewportSafeDockPosition(position, prev.width, getViewportWidth()),
    }))
  }, [])

  const setFloatingPosition = useCallback((floatingPosition: FloatingPosition) => {
    setDockState((prev) => ({ ...prev, floatingPosition }))
  }, [])

  const setWidth = useCallback((width: number) => {
    setDockState((prev) => ({
      ...prev,
      width: Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH),
    }))
  }, [])

  const setHeight = useCallback((height: number) => {
    setDockState((prev) => ({
      ...prev,
      height: Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT),
    }))
  }, [])

  const toggleMinimized = useCallback(() => {
    setDockState((prev) => ({ ...prev, isMinimized: !prev.isMinimized }))
  }, [])

  const setMinimized = useCallback((isMinimized: boolean) => {
    setDockState((prev) => ({ ...prev, isMinimized }))
  }, [])

  const cyclePosition = useCallback(() => {
    setDockState((prev) => ({
      ...prev,
      position: resolveNextCyclePosition(prev.position, prev.width, getViewportWidth()),
    }))
  }, [])

  const cycleFloatingPosition = useCallback(() => {
    setDockState((prev) => {
      const positions: FloatingPosition[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right']
      const currentIndex = positions.indexOf(prev.floatingPosition)
      const nextIndex = (currentIndex + 1) % positions.length
      return { ...prev, floatingPosition: positions[nextIndex] }
    })
  }, [])

  return {
    dockState,
    setPosition,
    setFloatingPosition,
    setWidth,
    setHeight,
    toggleMinimized,
    setMinimized,
    cyclePosition,
    cycleFloatingPosition,
    isFloating: dockState.position === 'floating',
    isDocked: dockState.position !== 'floating',
    isHydrated,
  }
}
