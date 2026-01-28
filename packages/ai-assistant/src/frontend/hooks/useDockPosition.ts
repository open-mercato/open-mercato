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
        setDockState({
          position: (migratedPosition as DockPosition) || DEFAULT_DOCK_STATE.position,
          floatingPosition: (parsed.floatingPosition as FloatingPosition) || DEFAULT_DOCK_STATE.floatingPosition,
          width: Math.min(Math.max((parsed.width as number) || DEFAULT_DOCK_STATE.width, MIN_WIDTH), MAX_WIDTH),
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

  const setPosition = useCallback((position: DockPosition) => {
    setDockState((prev) => ({ ...prev, position }))
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
    setDockState((prev) => {
      const positions: DockPosition[] = ['floating', 'right', 'left', 'bottom']
      const currentIndex = positions.indexOf(prev.position)
      const nextIndex = (currentIndex + 1) % positions.length
      return { ...prev, position: positions[nextIndex] }
    })
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
