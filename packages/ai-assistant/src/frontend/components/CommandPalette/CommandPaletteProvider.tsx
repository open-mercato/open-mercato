'use client'

import * as React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import type { PageContext, SelectedEntity } from '../../types'
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

  const commandPalette = useCommandPalette({
    pageContext,
    selectedEntities,
    disableKeyboardShortcut,
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
