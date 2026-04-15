import type { AccessibilityPreferences } from '@open-mercato/core/modules/auth/data/validators'

export const ACCESSIBILITY_PREFERENCES_CHANGED_EVENT = 'accessibility-preferences-changed'

export const FONT_SCALE: Record<NonNullable<AccessibilityPreferences['fontSize']>, string> = {
  sm: '0.875',
  md: '1',
  lg: '1.125',
  xl: '1.25',
}

export function applyAccessibilityPreferences(
  preferences: AccessibilityPreferences | null | undefined,
  options?: {
    root?: HTMLElement
    systemReducedMotion?: boolean
  },
): void {
  if (typeof document === 'undefined') return

  const root = options?.root ?? document.documentElement
  const fontSize = preferences?.fontSize ?? 'md'
  const fontScale = FONT_SCALE[fontSize] ?? FONT_SCALE.md
  const systemReducedMotion = options?.systemReducedMotion ?? (
    typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  root.style.setProperty('--font-scale', fontScale)
  root.classList.toggle('high-contrast', preferences?.highContrast ?? false)
  root.classList.toggle(
    'reduce-motion',
    Boolean(preferences?.reducedMotion) || systemReducedMotion,
  )
}

export function dispatchAccessibilityPreferencesChanged(
  preferences: AccessibilityPreferences | null | undefined,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<AccessibilityPreferences | null>(
      ACCESSIBILITY_PREFERENCES_CHANGED_EVENT,
      { detail: preferences ?? null },
    ),
  )
}
