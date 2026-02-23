'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { AiFormSuggestion, AiFormSuggestionSection } from '../types'

interface AiFormBridgeOptions {
  formType: string
  getFormState: () => Record<string, unknown> | null
}

interface PendingSuggestion {
  suggestion: AiFormSuggestion
  stateSnapshot: Record<string, unknown> | null
  receivedAt: Date
}

type FormGeneratingEvent = { generating: true; sectionIds: string[] } | { generating: false }

// ---------------------------------------------------------------------------
// Global form registration registry — avoids useEffect timing issues.
// Uses window property so CommandPaletteProvider can read it without an import
// (avoids HMR cascade since the provider wraps the entire app).
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__omAiFormRegistration' as const

interface FormRegistrationEntry {
  formType: string
  getFormState: () => Record<string, unknown> | null
}

function setGlobalFormRegistration(reg: FormRegistrationEntry | null): void {
  if (typeof window !== 'undefined') {
    ;(window as any)[GLOBAL_KEY] = reg
  }
}

function getGlobalFormRegistration(): FormRegistrationEntry | null {
  if (typeof window === 'undefined') return null
  return (window as any)[GLOBAL_KEY] ?? null
}

/**
 * Hook for bidirectional communication between page forms and the AI assistant.
 *
 * 1. Registers the form via a global registry (immediate) + `om:ai-form-register` event (for listeners)
 * 2. Listens for AI-generated suggestions via `om:ai-form-suggestion` CustomEvent
 * 3. Provides accept/reject callbacks for per-section suggestion handling
 * 4. Tracks stale state: snapshots form values when suggestion arrives, compares to current
 * 5. Tracks generating state for loading indicators via `om:ai-form-generating` CustomEvent
 *
 * Usage:
 *   const bridge = useAiFormBridge({
 *     formType: 'business_rules',
 *     getFormState: () => ({ conditionExpression, successActions, failureActions }),
 *   })
 */
export function useAiFormBridge(options: AiFormBridgeOptions) {
  const { formType, getFormState } = options
  const getFormStateRef = useRef(getFormState)
  getFormStateRef.current = getFormState

  const [pendingSuggestion, setPendingSuggestion] = useState<PendingSuggestion | null>(null)
  const [generatingSections, setGeneratingSections] = useState<Set<string>>(new Set())

  // Register form state globally (immediate, no timing issues) and via event (for listeners)
  useEffect(() => {
    const registration = {
      formType,
      getFormState: () => getFormStateRef.current(),
    }

    // Write to global registry — CommandPaletteProvider reads this directly
    setGlobalFormRegistration(registration)

    // Also dispatch event for any other listeners
    window.dispatchEvent(
      new CustomEvent('om:ai-form-register', { detail: registration })
    )

    return () => {
      // Only clear if we're still the active registration
      if (getGlobalFormRegistration()?.formType === formType) {
        setGlobalFormRegistration(null)
      }
      window.dispatchEvent(
        new CustomEvent('om:ai-form-unregister', { detail: { formType } })
      )
    }
  }, [formType])

  // Listen for form suggestions dispatched by useCommandPalette
  useEffect(() => {
    const handleSuggestion = (event: CustomEvent<AiFormSuggestion>) => {
      try {
        const suggestion = event.detail
        if (!suggestion || !Array.isArray(suggestion.sections) || suggestion.sections.length === 0) {
          return
        }
        // Snapshot current form state for stale detection
        const snapshot = getFormStateRef.current()
        setPendingSuggestion({
          suggestion,
          stateSnapshot: snapshot,
          receivedAt: new Date(),
        })
      } catch {
        console.warn('[useAiFormBridge] Invalid suggestion event')
      }
    }

    window.addEventListener('om:ai-form-suggestion', handleSuggestion as EventListener)
    return () => {
      window.removeEventListener('om:ai-form-suggestion', handleSuggestion as EventListener)
    }
  }, [])

  // Listen for generating state events from useCommandPalette
  useEffect(() => {
    const handleGenerating = (event: CustomEvent<FormGeneratingEvent>) => {
      const detail = event.detail
      if (detail.generating) {
        const sectionIds = detail.sectionIds
        setGeneratingSections(prev => {
          const next = new Set(prev)
          for (const id of sectionIds) next.add(id)
          return next
        })
      } else {
        setGeneratingSections(new Set())
      }
    }

    window.addEventListener('om:ai-form-generating', handleGenerating as EventListener)
    return () => {
      window.removeEventListener('om:ai-form-generating', handleGenerating as EventListener)
    }
  }, [])

  // Clear generating for sections that receive suggestions
  useEffect(() => {
    if (pendingSuggestion) {
      const suggestedIds = pendingSuggestion.suggestion.sections.map(s => s.sectionId)
      setGeneratingSections(prev => {
        const next = new Set(prev)
        for (const id of suggestedIds) next.delete(id)
        if (next.size === prev.size) return prev
        return next
      })
    }
  }, [pendingSuggestion])

  // Get the suggestion section for a given sectionId
  const getSuggestionSection = useCallback((sectionId: string): AiFormSuggestionSection | null => {
    if (!pendingSuggestion) return null
    return pendingSuggestion.suggestion.sections.find(s => s.sectionId === sectionId) ?? null
  }, [pendingSuggestion])

  // Check if a specific section's value has changed since the suggestion was generated
  const isSectionStale = useCallback((sectionId: string, currentValue: unknown): boolean => {
    if (!pendingSuggestion?.stateSnapshot) return false
    const snapshotValue = pendingSuggestion.stateSnapshot[sectionId]
    return JSON.stringify(snapshotValue) !== JSON.stringify(currentValue)
  }, [pendingSuggestion])

  // Check if a section is currently being generated by the AI
  const isSectionGenerating = useCallback((sectionId: string): boolean => {
    return generatingSections.has(sectionId)
  }, [generatingSections])

  // Accept a single section — removes it from pending, returns the section value
  const acceptSection = useCallback((sectionId: string): AiFormSuggestionSection | null => {
    if (!pendingSuggestion) return null
    const section = pendingSuggestion.suggestion.sections.find(s => s.sectionId === sectionId)
    if (!section) return null

    // Remove accepted section; clear suggestion if last one
    setPendingSuggestion(prev => {
      if (!prev) return null
      const remaining = prev.suggestion.sections.filter(s => s.sectionId !== sectionId)
      if (remaining.length === 0) return null
      return { ...prev, suggestion: { ...prev.suggestion, sections: remaining } }
    })

    return section
  }, [pendingSuggestion])

  // Reject a single section — removes it from pending
  const rejectSection = useCallback((sectionId: string) => {
    setPendingSuggestion(prev => {
      if (!prev) return null
      const remaining = prev.suggestion.sections.filter(s => s.sectionId !== sectionId)
      if (remaining.length === 0) return null
      return { ...prev, suggestion: { ...prev.suggestion, sections: remaining } }
    })
  }, [])

  // Reject all pending sections
  const rejectAll = useCallback(() => {
    setPendingSuggestion(null)
  }, [])

  return {
    pendingSuggestion,
    getSuggestionSection,
    isSectionStale,
    isSectionGenerating,
    acceptSection,
    rejectSection,
    rejectAll,
  }
}
