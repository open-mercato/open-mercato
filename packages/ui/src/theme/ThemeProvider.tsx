import * as React from 'react'

/**
 * Theme color overrides that map to CSS custom properties
 */
export interface ThemeColors {
  background?: string
  foreground?: string
  primary?: string
  primaryForeground?: string
  secondary?: string
  secondaryForeground?: string
  accent?: string
  accentForeground?: string
  muted?: string
  mutedForeground?: string
  border?: string
  card?: string
  cardForeground?: string
  sidebar?: string
  sidebarForeground?: string
  sidebarPrimary?: string
  sidebarPrimaryForeground?: string
  sidebarAccent?: string
  sidebarAccentForeground?: string
  sidebarBorder?: string
}

export interface ThemeProviderProps {
  children: React.ReactNode
  /** Optional theme color overrides */
  colors?: ThemeColors
}

/**
 * Maps theme color keys to CSS custom property names
 */
const colorToCssVar: Record<keyof ThemeColors, string> = {
  background: '--background',
  foreground: '--foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  card: '--card',
  cardForeground: '--card-foreground',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
}

/**
 * Theme provider that applies custom CSS variables for brand theming.
 * Colors are applied as CSS custom properties on a wrapper element.
 */
export function ThemeProvider({ children, colors }: ThemeProviderProps) {
  const style = React.useMemo(() => {
    if (!colors) return undefined
    const cssVars: Record<string, string> = {}
    for (const [key, value] of Object.entries(colors)) {
      if (value && key in colorToCssVar) {
        cssVars[colorToCssVar[key as keyof ThemeColors]] = value
      }
    }
    return Object.keys(cssVars).length > 0 ? cssVars : undefined
  }, [colors])

  if (!style) {
    return <>{children}</>
  }

  return (
    <div style={style as React.CSSProperties} className="contents">
      {children}
    </div>
  )
}

