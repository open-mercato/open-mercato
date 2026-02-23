'use client'

import * as React from 'react'
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import type { PageContext, SelectedEntity, AiFormRegistration } from '../../types'
import { usePageContext } from '../../hooks/usePageContext'
import { useCommandPalette } from '../../hooks/useCommandPalette'

interface CommandPaletteProviderProps {
  children: React.ReactNode
  tenantId: string
  organizationId: string | null
  disableKeyboardShortcut?: boolean
}

type CommandPaletteContextValue = ReturnType<typeof useCommandPalette>

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function CommandPaletteProvider({
  children,
  tenantId,
  organizationId,
  disableKeyboardShortcut = true,
}: CommandPaletteProviderProps) {
  const pageContext = usePageContext({ tenantId, organizationId })
  const [selectedEntities, setSelectedEntities] = useState<SelectedEntity[]>([])
  const formRegistrationRef = useRef<AiFormRegistration | null>(null)

  // Listen for DataTable selection events
  useEffect(() => {
    const handleSelectionChange = (event: CustomEvent<SelectedEntity[]>) => {
      setSelectedEntities(event.detail || [])
    }

    window.addEventListener('om:selection-change', handleSelectionChange as EventListener)
    return () => {
      window.removeEventListener('om:selection-change', handleSelectionChange as EventListener)
    }
  }, [])

  // Listen for AI form bridge registration/unregistration
  useEffect(() => {
    const handleRegister = (event: CustomEvent<AiFormRegistration>) => {
      formRegistrationRef.current = event.detail
    }
    const handleUnregister = () => {
      formRegistrationRef.current = null
    }

    window.addEventListener('om:ai-form-register', handleRegister as EventListener)
    window.addEventListener('om:ai-form-unregister', handleUnregister as EventListener)
    return () => {
      window.removeEventListener('om:ai-form-register', handleRegister as EventListener)
      window.removeEventListener('om:ai-form-unregister', handleUnregister as EventListener)
    }
  }, [])

  // Stable getter that reads the latest form state from the registered form.
  // Primary: global registry on window (set by useAiFormBridge, no timing issues).
  // Fallback: event-based ref (for edge cases where global is cleared first).
  const getFormState = useCallback(() => {
    const globalReg = typeof window !== 'undefined'
      ? (window as any).__omAiFormRegistration as AiFormRegistration | undefined
      : undefined
    const registration = globalReg ?? formRegistrationRef.current
    if (!registration) return null
    const state = registration.getFormState()
    if (!state) return null
    return { formType: registration.formType, ...state }
  }, [])

  const commandPalette = useCommandPalette({
    pageContext,
    selectedEntities,
    disableKeyboardShortcut,
    getFormState,
  })

  return (
    <CommandPaletteContext.Provider value={commandPalette}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPaletteContext(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext)
  if (!context) {
    throw new Error('useCommandPaletteContext must be used within CommandPaletteProvider')
  }
  return context
}
