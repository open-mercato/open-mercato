import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CodeSnippet } from '../../core/src/modules/design_system/gallery/components/CodeSnippet'
import type { GalleryEntry } from '../../core/src/modules/design_system/gallery/types'

export function EntryVariant({ entry, variantId }: { entry: GalleryEntry; variantId: string }) {
  const t = useT()
  const variant = entry.variants.find(candidate => candidate.id === variantId)
  if (!variant) throw new Error(`Unknown gallery variant: ${entry.id}/${variantId}`)
  return <div className="om-entry"><h2 className="mb-4 text-lg font-semibold">{entry.title} <span className="font-normal text-muted-foreground">/ {t(`design_system.gallery.variantTitles.${variant.title}`, variant.title)}</span></h2>
    <div className="om-entry-stage">{variant.render()}</div><CodeSnippet code={variant.code} />
  </div>
}

export function EntryOverview({ entry }: { entry: GalleryEntry }) {
  const t = useT()
  return <main className="om-entry space-y-8">
    <header className="space-y-3"><p className="text-overline uppercase tracking-widest text-muted-foreground">{t('design_system.portal.nav.components')}</p>
      <div className="flex flex-wrap items-start justify-between gap-4"><h1 className="text-3xl font-semibold tracking-tight">{entry.title}</h1></div><p className="break-all font-mono text-xs text-muted-foreground">{entry.importPath}</p>
      <p className="text-sm text-muted-foreground">{t('design_system.gallery.variantCount', { count: entry.variants.length })}</p>
    </header>
    {entry.usage && <div className="grid gap-4 md:grid-cols-2">
      {entry.usage.do && <section className="rounded-lg border border-border p-4"><h2 className="mb-2 text-sm font-semibold">{t('design_system.gallery.usageDo')}</h2><ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">{entry.usage.do.map((rule, index) => <li key={rule}>{t(`design_system.gallery.usage.${entry.id}.do.${index}`, rule)}</li>)}</ul></section>}
      {entry.usage.dont && <section className="rounded-lg border border-border p-4"><h2 className="mb-2 text-sm font-semibold">{t('design_system.gallery.usageDont')}</h2><ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">{entry.usage.dont.map((rule, index) => <li key={rule}>{t(`design_system.gallery.usage.${entry.id}.dont.${index}`, rule)}</li>)}</ul></section>}
    </div>}
    {entry.variants.map(variant => <section key={variant.id} aria-label={t(`design_system.gallery.variantTitles.${variant.title}`, variant.title)} className="space-y-3"><h2 className="text-base font-medium">{t(`design_system.gallery.variantTitles.${variant.title}`, variant.title)}</h2><div className="om-entry-stage">{variant.render()}</div><CodeSnippet code={variant.code} /></section>)}
  </main>
}
