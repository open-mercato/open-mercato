'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'om:ai-assistant:visibility'

export interface AiAssistantVisibility {
  enabled: boolean
}

const DEFAULT_VISIBILITY: AiAssistantVisibility = {
  enabled: false, // Hidden by default
}

/**
 * Hook to manage AI Assistant visibility setting.
 * Persists to localStorage and emits events for cross-component sync.
 */
export function useAiAssistantVisibility() {
  const [visibility, setVisibilityState] = useState<AiAssistantVisibility>(DEFAULT_VISIBILITY)
  const [isLoaded, setIsLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as AiAssistantVisibility
        setVisibilityState(parsed)
      }
    } catch {
      // Use defaults on error
    }
    setIsLoaded(true)
  }, [])

  // Listen for changes from other components/tabs
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as AiAssistantVisibility
          setVisibilityState(parsed)
        } catch {
          // Ignore invalid data
        }
      }
    }

    const handleVisibilityChange = (event: CustomEvent<AiAssistantVisibility>) => {
      setVisibilityState(event.detail)
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('om:ai-assistant-visibility-change', handleVisibilityChange as EventListener)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('om:ai-assistant-visibility-change', handleVisibilityChange as EventListener)
    }
  }, [])

  const setVisibility = useCallback((newVisibility: Partial<AiAssistantVisibility>) => {
    setVisibilityState((prev) => {
      const updated = { ...prev, ...newVisibility }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
        // Emit event for same-window components
        window.dispatchEvent(
          new CustomEvent('om:ai-assistant-visibility-change', { detail: updated })
        )
      } catch {
        // Ignore storage errors
      }
      return updated
    })
  }, [])

  const toggleEnabled = useCallback(() => {
    setVisibility({ enabled: !visibility.enabled })
  }, [visibility.enabled, setVisibility])

  return {
    visibility,
    isLoaded,
    setVisibility,
    toggleEnabled,
    isEnabled: visibility.enabled,
  }
}
