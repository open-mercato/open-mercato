'use client'

import * as React from 'react'
import type { PreviewMode, PreviewTheme } from '@/lib/links'
import { DARK_MODE_STORAGE_KEY, PREVIEW_THEME_STORAGE_KEY } from '@/lib/theme-init'

type DesignSettings = {
  theme: PreviewTheme
  mode: PreviewMode
  setTheme: (theme: PreviewTheme) => void
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
  const [theme, setThemeState] = React.useState<PreviewTheme>('admin')
  const [mode, setModeState] = React.useState<PreviewMode>('light')

  React.useEffect(() => {
    if (readStorage(PREVIEW_THEME_STORAGE_KEY) === 'storefront') setThemeState('storefront')
    if (readStorage(DARK_MODE_STORAGE_KEY) === 'dark') setModeState('dark')
  }, [])

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.style.colorScheme = mode
  }, [mode])

  const value = React.useMemo<DesignSettings>(
    () => ({
      theme,
      mode,
      setTheme: (next) => {
        setThemeState(next)
        writeStorage(PREVIEW_THEME_STORAGE_KEY, next)
      },
      setMode: (next) => {
        setModeState(next)
        writeStorage(DARK_MODE_STORAGE_KEY, next)
      },
    }),
    [theme, mode],
  )

  return <DesignSettingsContext.Provider value={value}>{children}</DesignSettingsContext.Provider>
}

export function useDesignSettings(): DesignSettings {
  const context = React.useContext(DesignSettingsContext)
  if (!context) throw new Error('[internal] useDesignSettings must be used inside DesignSettingsProvider')
  return context
}
