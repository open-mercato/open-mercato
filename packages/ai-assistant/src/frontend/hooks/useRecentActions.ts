'use client'

import { useState, useCallback, useEffect } from 'react'
import type { RecentAction } from '../types'
import { RECENT_ACTIONS_KEY, MAX_RECENT_ACTIONS } from '../constants'

function loadRecentActions(): RecentAction[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(RECENT_ACTIONS_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX_RECENT_ACTIONS)
  } catch {
    return []
  }
}

function saveRecentActions(actions: RecentAction[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(RECENT_ACTIONS_KEY, JSON.stringify(actions.slice(0, MAX_RECENT_ACTIONS)))
  } catch {
    // Ignore localStorage errors
  }
}

export function useRecentActions() {
  const [recentActions, setRecentActions] = useState<RecentAction[]>([])

  // Load from localStorage on mount
  useEffect(() => {
    setRecentActions(loadRecentActions())
  }, [])

  const addRecentAction = useCallback((action: Omit<RecentAction, 'id' | 'timestamp'>) => {
    setRecentActions((prev) => {
      const newAction: RecentAction = {
        ...action,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      }
      // Remove duplicates by toolName, add new at start
      const filtered = prev.filter((a) => a.toolName !== action.toolName)
      const updated = [newAction, ...filtered].slice(0, MAX_RECENT_ACTIONS)
      saveRecentActions(updated)
      return updated
    })
  }, [])

  const clearRecentActions = useCallback(() => {
    setRecentActions([])
    if (typeof window !== 'undefined') {
      localStorage.removeItem(RECENT_ACTIONS_KEY)
    }
  }, [])

  return {
    recentActions,
    addRecentAction,
    clearRecentActions,
  }
}
