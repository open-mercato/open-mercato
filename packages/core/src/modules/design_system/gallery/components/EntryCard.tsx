'use client'

import * as React from 'react'
import { Check, ExternalLink, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import type { GalleryEntry } from '../types'
import { DS_DOCS_URL, figmaNodeUrl } from '../registry'
import { VariantPreview } from './VariantPreview'
import { CodeSnippet } from './CodeSnippet'

export function EntryCard({ entry }: { entry: GalleryEntry }) {
  const t = useT()

  return (
    <section
      id={`gallery-entry-${entry.id}`}
      aria-labelledby={`gallery-entry-${entry.id}-title`}
      className="scroll-mt-4 space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 id={`gallery-entry-${entry.id}-title`} className="text-base font-semibold leading-tight">
            {entry.title}
          </h3>
          {entry.descriptionKey ? (
            <p className="text-sm text-muted-foreground">{t(entry.descriptionKey, entry.title)}</p>
          ) : null}
          <code className="block truncate text-xs text-muted-foreground">{entry.importPath}</code>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {entry.figmaNodeId ? (
            <LinkButton asChild size="sm">
              <a href={figmaNodeUrl(entry.figmaNodeId)} target="_blank" rel="noreferrer">
                {t('design_system.gallery.openInFigma', 'Open in Figma')}
                <ExternalLink />
              </a>
            </LinkButton>
          ) : null}
          {entry.docsAnchor ? (
            <LinkButton asChild size="sm" variant="gray">
              <a href={`${DS_DOCS_URL}${entry.docsAnchor}`} target="_blank" rel="noreferrer">
                {t('design_system.gallery.viewDocs', 'View docs')}
                <ExternalLink />
              </a>
            </LinkButton>
          ) : null}
        </div>
      </div>
      {entry.usage && (entry.usage.do?.length || entry.usage.dont?.length) ? (
        <div className="grid gap-4 rounded-md border border-border bg-muted/30 p-4 sm:grid-cols-2">
          {entry.usage.do?.length ? (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('design_system.gallery.usageDo', 'Do')}
              </div>
              <ul className="space-y-1.5">
                {entry.usage.do.map((rule) => (
                  <li key={rule} className="flex items-start gap-2 text-sm text-foreground">
                    <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-success-icon" />
                    <span>{rule}</span>
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
                {entry.usage.dont.map((rule) => (
                  <li key={rule} className="flex items-start gap-2 text-sm text-foreground">
                    <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-error-icon" />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-4">
        {entry.variants.map((variant) => (
          <div key={variant.id} className="space-y-2">
            <div className="text-sm font-medium text-foreground">{variant.title}</div>
            <VariantPreview>{variant.render()}</VariantPreview>
            <CodeSnippet code={variant.code} />
          </div>
        ))}
      </div>
    </section>
  )
}
