import type React from 'react'

export type GalleryVariant = {
  id: string                    // 'destructive-soft'
  title: string                 // human label; component/variant names are not translated
  render: () => React.ReactNode // live preview, real primitives only
  code: string                  // the snippet the copy button yields
}

export type GalleryEntry = {
  id: string                    // 'button' — unique across the whole gallery
  title: string                 // 'Button'
  importPath: string            // '@open-mercato/ui/primitives/button'
  descriptionKey?: string       // i18n key for the one-line summary
  docsAnchor?: string           // '#button' into .ai/ui-components.md (monorepo) — hidden when docs are absent
  figmaNodeId?: string          // node in file qCq9z6q1if0mpoRstV5OEA
  variants: GalleryVariant[]
}

export type GalleryFamily = {
  id: string                    // 'charts'
  labelKey: string              // i18n key for the family label
  load: () => Promise<{ entries: GalleryEntry[] }>   // next/dynamic-compatible loader
}
