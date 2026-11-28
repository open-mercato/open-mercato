import type React from 'react'
import type { ZodType } from 'zod'

export type GalleryVariant = {
  id: string                    // 'destructive-soft'
  title: string                 // human label; component/variant names are not translated
  render: () => React.ReactNode // live preview, real primitives only
  code: string                  // the snippet the copy button yields
  description?: string          // one or two sentences under the example title (English, translated via variantDescriptions)
}

export type GalleryUsage = {
  do?: string[]                 // when/how to use — developer-facing docs prose (English, like ui-components.md)
  dont?: string[]               // anti-patterns for this component
}

export type GalleryFaq = {
  question: string
  answer: string
}

export type GalleryEntry = {
  usage?: GalleryUsage
  since?: string                // first Open Mercato version that ships the component
  accessibility?: string[]      // keyboard, screen reader and motion notes (English, translated)
  faq?: GalleryFaq[]            // concrete pitfalls and their fixes (English, translated)
  tokens?: string[]             // CSS custom properties the component reads, e.g. '--accent-indigo'
  keywords?: string[]          // extra search aliases (e.g. 'radiobutton' for Radio)
  id: string                    // 'button' — unique across the whole gallery
  title: string                 // 'Button'
  importPath: string            // '@open-mercato/ui/primitives/button'
  descriptionKey?: string       // i18n key for the one-line summary
  docsAnchor?: string           // '#button' into .ai/ui-components.md (monorepo) — hidden when docs are absent
  figmaNodeId?: string          // node in file qCq9z6q1if0mpoRstV5OEA
  contract?: { schema: ZodType; importPath: string; implementationPath: string }
  variants: GalleryVariant[]
}

export type GalleryFamily = {
  id: string                    // 'charts'
  labelKey: string              // i18n key for the family label
  icon?: React.ReactNode        // section-nav icon (lucide, size-4)
  load: () => Promise<{ entries: GalleryEntry[] }>   // next/dynamic-compatible loader
}
