import type React from 'react'
import type { z } from 'zod'

export type GalleryVariant = {
  id: string                    // 'destructive-soft'
  title: string                 // human label; component/variant names are not translated
  render: () => React.ReactNode // live preview, real primitives only
  code: string                  // the snippet the copy button yields
}

export type GalleryUsage = {
  do?: string[]                 // when/how to use — developer-facing docs prose (English, like ui-components.md)
  dont?: string[]               // anti-patterns for this component
}

export type GalleryEntry = {
  usage?: GalleryUsage
  keywords?: string[]          // extra search aliases (e.g. 'radiobutton' for Radio)
  id: string                    // 'button' — unique across the whole gallery
  title: string                 // 'Button'
  importPath: string            // '@open-mercato/ui/primitives/button'
  descriptionKey?: string       // i18n key for the one-line summary
  docsAnchor?: string           // '#button' into .ai/ui-components.md (monorepo) — hidden when docs are absent
  figmaNodeId?: string          // node in file qCq9z6q1if0mpoRstV5OEA
  variants: GalleryVariant[]
  /**
   * Mockup-composer prop injection (spec 2026-07-05-ds-live-mockup-composer.md).
   * Optional and additive: entries without `compose` stay usable in mockups via
   * their variants' canonical `render()`, but such blocks may not supply
   * `props` (the mockup integrity test fails — silent prop-dropping would lie
   * to reviewers). `compose` is ordinary registry code: mock data only, never
   * tenant APIs.
   */
  compose?: (props: Record<string, unknown>) => React.ReactNode
  /** Validates block props at integrity-check time; drives the Phase 2 studio prop form. */
  composePropsSchema?: z.ZodTypeAny
}

export type GalleryFamily = {
  id: string                    // 'charts'
  labelKey: string              // i18n key for the family label
  icon?: React.ReactNode        // section-nav icon (lucide, size-4)
  composable?: boolean          // false: documentation sheets (foundations, icons) — never offered as mockup blocks
  load: () => Promise<{ entries: GalleryEntry[] }>   // next/dynamic-compatible loader
}
