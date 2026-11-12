'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ArrowRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { GalleryEntry } from '../types'
import { CodeSnippet } from './CodeSnippet'
import { ThemeTokenReference } from './ThemeTokenReference'
import { GALLERY_BASE_PATH } from '../registry'

export function FoundationGuide({ entries }: { entries: GalleryEntry[] }) {
  const t = useT()
  return <div className="space-y-12 pb-12">
    <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{t('design_system.foundations.intro')}</p>
    {entries.some(entry => entry.id === 'brand-colors' || entry.id === 'color-tokens') ? <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
      <p className="max-w-xl text-sm text-muted-foreground">{t('design_system.styleAgents.referenceHint')}</p>
      <Button asChild variant="outline"><Link href={`${GALLERY_BASE_PATH}?view=style-agents`}>{t('design_system.styleAgents.open')}<ArrowRight aria-hidden /></Link></Button>
    </div> : null}
    {entries.map(entry => <section key={entry.id} id={`gallery-entry-${entry.id}`} aria-labelledby={`gallery-entry-${entry.id}-title`} className="min-w-0 scroll-mt-36 lg:scroll-mt-24 space-y-8 border-t border-border pt-8">
      <header className="max-w-2xl space-y-3">
        <h2 id={`gallery-entry-${entry.id}-title`} className="text-2xl font-medium tracking-tight">{t(`design_system.foundations.${entry.id}.title`, entry.title)}</h2>
        <p className="text-base leading-relaxed text-muted-foreground">{t(`design_system.foundations.${entry.id}.description`)}</p>
      </header>
      <CodeSnippet code={entry.variants.map(variant => variant.code).join('\n\n')} preview={<div className="space-y-8">{entry.variants.map(variant => <div key={variant.id} id={`gallery-variant-${entry.id}-${variant.id}`} className="min-w-0 scroll-mt-36 space-y-4 lg:scroll-mt-24">
        {entry.variants.length > 1 && entry.id !== 'typography' ? <h3 className="text-sm font-medium text-muted-foreground">{t(`design_system.foundations.variants.${variant.id}`, variant.title)}</h3> : null}
        <div className="min-w-0 overflow-x-auto py-2">{variant.render()}</div>
      </div>)}
      {entry.id === 'color-tokens' ? <ThemeTokenReference /> : null}
      </div>} />
      {entry.usage ? <section className="rounded-md border border-border">
        <h3 className="p-4 text-sm font-medium">{t('design_system.portal.nav.principles')}</h3>
        <div className="grid gap-6 border-t border-border p-4 sm:grid-cols-2">
          {(['do', 'dont'] as const).map(kind => entry.usage?.[kind]?.length ? <div key={kind} className="space-y-3">
            <h3 className="text-sm font-medium">{t(kind === 'do' ? 'design_system.gallery.usageDo' : 'design_system.gallery.usageDont')}</h3>
            <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">{entry.usage[kind]?.map((rule, index) => <li key={rule}>{t(`design_system.gallery.usage.${entry.id}.${kind}.${index}`, rule)}</li>)}</ul>
          </div> : null)}
        </div>
      </section> : null}
    </section>)}
  </div>
}
