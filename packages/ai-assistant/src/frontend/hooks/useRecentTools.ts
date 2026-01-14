'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { ToolInfo } from '../types'

const RECENT_TOOLS_KEY = 'om:command-palette:recent-tools'
const MAX_RECENT_TOOLS = 5

function loadRecentToolIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(RECENT_TOOLS_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX_RECENT_TOOLS)
  } catch {
    return []
  }
}

function saveRecentToolIds(toolIds: string[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(RECENT_TOOLS_KEY, JSON.stringify(toolIds.slice(0, MAX_RECENT_TOOLS)))
  } catch {
    // Ignore localStorage errors
  }
}

export function useRecentTools(allTools: ToolInfo[]) {
  const [recentIds, setRecentIds] = useState<string[]>([])

  // Load from localStorage on mount
  useEffect(() => {
    setRecentIds(loadRecentToolIds())
  }, [])

  const saveRecentTool = useCallback((toolName: string) => {
    setRecentIds((prev) => {
      // Add new tool at start, remove duplicates
      const updated = [toolName, ...prev.filter((t) => t !== toolName)].slice(0, MAX_RECENT_TOOLS)
      saveRecentToolIds(updated)
      return updated
    })
  }, [])

  const clearRecentTools = useCallback(() => {
    setRecentIds([])
    if (typeof window !== 'undefined') {
      localStorage.removeItem(RECENT_TOOLS_KEY)
    }
  }, [])

  // Map recent tool IDs to actual tool objects
  const recentTools = useMemo(
    () =>
      recentIds
        .map((id) => allTools.find((t) => t.name === id))
        .filter((t): t is ToolInfo => t !== undefined),
    [recentIds, allTools]
  )

  return {
    recentTools,
    saveRecentTool,
    clearRecentTools,
  }
}
