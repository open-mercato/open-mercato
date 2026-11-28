'use client'

import * as React from 'react'
import type { PreviewMode } from '@/lib/links'
import { DARK_MODE_STORAGE_KEY } from '@/lib/theme-init'

type DesignSettings = {
  mode: PreviewMode
  setMode: (mode: PreviewMode) => void
}

const DesignSettingsContext = React.createContext<DesignSettings | null>(null)

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    return
  }
}

export function DesignSettingsProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<PreviewMode>('light')

  React.useEffect(() => {
    if (readStorage(DARK_MODE_STORAGE_KEY) === 'dark') setModeState('dark')
  }, [])

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.style.colorScheme = mode
  }, [mode])

  const value = React.useMemo<DesignSettings>(
    () => ({
      mode,
      setMode: (next) => {
        setModeState(next)
        writeStorage(DARK_MODE_STORAGE_KEY, next)
      },
    }),
    [mode],
  )

  return <DesignSettingsContext.Provider value={value}>{children}</DesignSettingsContext.Provider>
}

export function useDesignSettings(): DesignSettings {
  const context = React.useContext(DesignSettingsContext)
  if (!context) throw new Error('[internal] useDesignSettings must be used inside DesignSettingsProvider')
  return context
}
