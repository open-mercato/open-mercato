'use client'

import { useState, useCallback, useEffect } from 'react'
import type { DockPosition, DockState } from '../types'

const DOCK_STATE_KEY = 'om:ai-chat:dock-state'

const DEFAULT_DOCK_STATE: DockState = {
  position: 'modal',
  width: 400,
  height: 400,
  isMinimized: false,
}

const MIN_WIDTH = 300
const MAX_WIDTH = 600
const MIN_HEIGHT = 250
const MAX_HEIGHT = 500

export function useDockPosition() {
  const [dockState, setDockState] = useState<DockState>(DEFAULT_DOCK_STATE)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DOCK_STATE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DockState>
        setDockState({
          position: parsed.position || DEFAULT_DOCK_STATE.position,
          width: Math.min(Math.max(parsed.width || DEFAULT_DOCK_STATE.width, MIN_WIDTH), MAX_WIDTH),
          height: Math.min(Math.max(parsed.height || DEFAULT_DOCK_STATE.height, MIN_HEIGHT), MAX_HEIGHT),
          isMinimized: parsed.isMinimized || false,
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
      const positions: DockPosition[] = ['modal', 'right', 'left', 'bottom']
      const currentIndex = positions.indexOf(prev.position)
      const nextIndex = (currentIndex + 1) % positions.length
      return { ...prev, position: positions[nextIndex] }
    })
  }, [])

  return {
    dockState,
    setPosition,
    setWidth,
    setHeight,
    toggleMinimized,
    setMinimized,
    cyclePosition,
    isModal: dockState.position === 'modal',
    isDocked: dockState.position !== 'modal',
    isHydrated,
  }
}
