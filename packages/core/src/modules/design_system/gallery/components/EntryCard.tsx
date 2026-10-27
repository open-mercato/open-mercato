'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ArrowRight, Check, ExternalLink, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import type { GalleryEntry } from '../types'
import { DS_DOCS_URL } from '../registry'
import { VariantPreview } from './VariantPreview'
import { CodeSnippet } from './CodeSnippet'
import { FamilyEntryPreview } from './FamilyEntryPreview'
import { EntryHeader } from './EntryHeader'

type EntryCardProps = {
  entry: GalleryEntry
  href?: string
  summary?: boolean
  summaryPreview?: boolean
  onNavigate?: () => void
  hideTitle?: boolean
  fullWidth?: boolean
}

export function EntryCard({ entry, href, summary = false, summaryPreview = false, onNavigate, hideTitle = false, fullWidth = false }: EntryCardProps) {
  const t = useT()
  const availableVariants = React.useMemo(() => entry.id === 'file-upload' ? entry.variants.filter(variant => variant.id !== 'drag-and-drop') : entry.variants, [entry.id, entry.variants])


  return (
    <section
      id={`gallery-entry-${entry.id}`}
      aria-label={hideTitle ? entry.title : undefined}
      aria-labelledby={hideTitle ? undefined : `gallery-entry-${entry.id}-title`}
      className={summary ? `relative min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5 ${summaryPreview ? `flex flex-col gap-4 ${fullWidth ? '@3xl:col-span-2' : ''}` : 'space-y-4'}` : 'min-w-0 space-y-6'}
    >
      {!hideTitle ? <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={`gallery-entry-${entry.id}-title`} className="text-base font-semibold leading-tight">
            {href ? <Link href={href} onNavigate={onNavigate} className="flex items-center justify-between gap-3 rounded-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:shadow-focus">{entry.title}{summaryPreview ? <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}</Link> : entry.title}
          </h3>
          {entry.descriptionKey && !summaryPreview ? (
            <p className="text-sm text-muted-foreground">{t(entry.descriptionKey, entry.title)}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {entry.docsAnchor && !summary ? (
            <LinkButton asChild size="sm" variant="gray">
              <a href={`${DS_DOCS_URL}${entry.docsAnchor}`} target="_blank" rel="noreferrer">
                {t('design_system.gallery.viewDocs', 'View docs')}
                <ExternalLink />
              </a>
            </LinkButton>
          ) : null}
        </div>
      </div> : null}
      {summary && summaryPreview && entry.variants.length ? <div inert aria-hidden="true" className="flex flex-1">
        <div className="flex min-h-32 min-w-0 flex-1 flex-wrap items-center gap-4 rounded-md bg-muted/20 p-4 [&>*]:max-w-full">
          <FamilyEntryPreview entry={entry} />
        </div>
      </div> : null}
      {!summary ? <EntryHeader entry={entry} variants={availableVariants} /> : null}
      {!summary ? <div className="space-y-8">
        {availableVariants.map((variant) => (
          <div key={variant.id} id={`gallery-variant-${entry.id}-${variant.id}`} className="scroll-mt-36 lg:scroll-mt-24 space-y-3">
            {availableVariants.length > 1 ? <h2 className="text-lg font-medium">{t(`design_system.gallery.variantTitles.${variant.title}`, variant.title)}</h2> : null}
            <CodeSnippet code={variant.code} preview={<VariantPreview framed={!fullWidth}>{variant.render()}</VariantPreview>} />
          </div>
        ))}
      </div> : null}
      {!summary && entry.usage && (entry.usage.do?.length || entry.usage.dont?.length) ? (
        <section className="rounded-md border border-border">
          <h3 className="p-4 text-sm font-medium">{t('design_system.portal.nav.principles')}</h3>
          <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
          {entry.usage.do?.length ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('design_system.gallery.usageDo', 'Do')}
              </div>
              <ul className="space-y-1.5">
                {entry.usage.do.map((rule, index) => (
                  <li key={rule} className="flex items-start gap-2 text-sm text-foreground">
                    <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-success-icon" />
                    <span>{t(`design_system.gallery.usage.${entry.id}.do.${index}`, rule)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {entry.usage.dont?.length ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('design_system.gallery.usageDont', "Don't")}
              </div>
              <ul className="space-y-1.5">
                {entry.usage.dont.map((rule, index) => (
                  <li key={rule} className="flex items-start gap-2 text-sm text-foreground">
                    <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-error-icon" />
                    <span>{t(`design_system.gallery.usage.${entry.id}.dont.${index}`, rule)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          </div>
        </section>
      ) : null}
    </section>
  )
}
