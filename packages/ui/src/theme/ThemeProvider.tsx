import * as React from 'react'

// Minimal theme provider placeholder to keep UI package independent.
// It can later wire dark mode or design tokens.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

