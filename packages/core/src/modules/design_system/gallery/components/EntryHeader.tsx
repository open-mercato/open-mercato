'use client'

import * as React from 'react'
import { Copy, LayoutTemplate } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { GalleryEntry, GalleryVariant } from '../types'
import { GALLERY_BASE_PATH } from '../registry'
import { GalleryLink as Link } from './GalleryLink'
import { copyTextToClipboard } from './CodeSnippet'

const VARIANT_INDEX_THRESHOLD = 4

export function isPatternEntry(entry: GalleryEntry): boolean {
  return entry.importPath.includes('/design_system/gallery/')
}

export function resolveImportStatement(entry: GalleryEntry): string {
  const escapedPath = entry.importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const statement = new RegExp(`import[^;'"]*?from\\s+['"]${escapedPath}['"]`)
  for (const variant of entry.variants) {
    const match = variant.code.match(statement)
    if (match) return match[0].replace(/\s+/g, ' ')
  }
  return entry.importPath
}

export function EntryHeader({ entry, variants }: { entry: GalleryEntry; variants: GalleryVariant[] }) {
  const t = useT()
  const searchParams = useSearchParams()
  const familyId = searchParams?.get('family') ?? null
  const importStatement = React.useMemo(() => resolveImportStatement(entry), [entry])
  const copyLabel = t('design_system.gallery.copyImport', 'Copy import')

  const onCopy = React.useCallback(async () => {
    try {
      await copyTextToClipboard(importStatement)
      flash(t('design_system.gallery.importCopied', 'Import copied to clipboard'), 'success')
    } catch {
      flash(t('design_system.gallery.copyFailed', 'Could not copy the snippet'), 'error')
    }
  }, [importStatement, t])

  return (
    <div className="space-y-4" data-testid="gallery-entry-header">
      {isPatternEntry(entry) ? (
        <p className="flex items-start gap-2 rounded-md border border-status-info-border bg-status-info-bg p-3 text-sm text-status-info-text">
          <LayoutTemplate aria-hidden className="mt-0.5 size-4 shrink-0 text-status-info-icon" />
          <span>{t('design_system.gallery.patternNote', 'This is a sample layout composed from library components, not an importable component. Use it as a pattern.')}</span>
        </p>
      ) : (
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/50 py-1 pl-3 pr-1">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('design_system.gallery.importLabel', 'Import')}</span>
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 text-xs">{importStatement}</code>
          <IconButton type="button" variant="ghost" size="sm" aria-label={copyLabel} title={copyLabel} onClick={onCopy}><Copy /></IconButton>
        </div>
      )}
      {variants.length >= VARIANT_INDEX_THRESHOLD ? (
        <nav aria-label={t('design_system.gallery.variantsNav', 'Variants')} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('design_system.gallery.variantsNav', 'Variants')} ({variants.length})</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {variants.map((variant) => {
              const label = t(`design_system.gallery.variantTitles.${variant.title}`, variant.title)
              const className = 'rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:shadow-focus'
              return (
                <li key={variant.id}>
                  {familyId
                    ? <Link href={`${GALLERY_BASE_PATH}?family=${familyId}&entry=${entry.id}&variant=${variant.id}`} className={className}>{label}</Link>
                    : <a href={`#gallery-variant-${entry.id}-${variant.id}`} className={className}>{label}</a>}
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
