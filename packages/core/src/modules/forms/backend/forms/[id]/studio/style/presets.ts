/**
 * Static, AA-safe `OmTheme` presets for the studio Appearance panel (spec D10).
 *
 * Pure data — no server state, no I/O. Each preset uses curated DS-role tokens
 * (always contrast- and mode-safe) or AA-checked hex literals. The
 * `displayNameKey` is an i18n key resolved by the panel with a fallback.
 */

import type { OmTheme } from '../../../../../schema/style-extensions'

export type FormThemePreset = {
  id: string
  displayNameKey: string
  fallbackName: string
  theme: OmTheme
}

export const FORM_THEME_PRESETS: ReadonlyArray<FormThemePreset> = [
  {
    // App-DS preset — every color is a curated token, so the form renders
    // identically to the unstyled default but the theme is *explicit* and can
    // be tweaked field-by-field. Differs from Reset (which clears the theme)
    // in that the preset card can highlight as active.
    id: 'default',
    displayNameKey: 'forms.studio.style.preset.default',
    fallbackName: 'Default',
    theme: {
      surface: 'surface',
      foreground: 'foreground',
      inputText: 'foreground',
      labelColor: 'foreground',
      labelWeight: 'medium',
      accent: 'accent',
      border: 'border',
      fontFamily: 'sans',
      fontScale: 'md',
      radius: 'md',
      contentWidth: 'md',
    },
  },
  {
    id: 'minimal',
    displayNameKey: 'forms.studio.style.preset.minimal',
    fallbackName: 'Minimal',
    theme: {
      surface: 'surface',
      foreground: 'foreground',
      accent: 'accent',
      border: 'border',
      fontFamily: 'system',
      fontScale: 'md',
      radius: 'md',
      contentWidth: 'md',
    },
  },
  {
    id: 'card',
    displayNameKey: 'forms.studio.style.preset.card',
    fallbackName: 'Card',
    theme: {
      background: { kind: 'color', color: 'surface-muted' },
      surface: 'surface',
      foreground: 'foreground',
      accent: 'accent',
      border: 'border',
      fontFamily: 'sans',
      fontScale: 'md',
      radius: 'lg',
      contentWidth: 'sm',
    },
  },
  {
    id: 'branded',
    displayNameKey: 'forms.studio.style.preset.branded',
    fallbackName: 'Branded',
    theme: {
      background: { kind: 'gradient', from: '#0f766e', to: '#115e59', angle: 135 },
      surface: '#ffffff',
      foreground: '#0f172a',
      accent: '#0f766e',
      border: '#cbd5e1',
      fontFamily: 'rounded',
      fontScale: 'md',
      radius: 'lg',
      contentWidth: 'md',
    },
  },
  {
    id: 'dark-friendly',
    displayNameKey: 'forms.studio.style.preset.darkFriendly',
    fallbackName: 'Dark-friendly',
    theme: {
      background: { kind: 'color', color: '#0f172a' },
      surface: '#1e293b',
      foreground: '#f1f5f9',
      accent: '#38bdf8',
      border: '#334155',
      fontFamily: 'sans',
      fontScale: 'md',
      radius: 'md',
      contentWidth: 'md',
    },
  },
]
