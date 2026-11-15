'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ArrowRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { GALLERY_BASE_PATH } from '../registry'
import type { GalleryEntry, GalleryFamily } from '../types'
import { FamilyEntryPreview } from './FamilyEntryPreview'

const representativeEntries: Record<string, string> = {
  inputs: 'input',
  dates: 'date-picker',
  filters: 'quick-filters',
  scaffolding: 'section-header',
  notifications: 'notification-item',
  schedule: 'schedule-agenda',
  messages: 'message-object-preview',
}

export function ComponentIndex({ families, loaded, failed, onRetry }: {
  families: GalleryFamily[]
  loaded: Record<string, GalleryEntry[]>
  failed: Record<string, boolean>
  onRetry: (family: GalleryFamily) => void
}) {
  const t = useT()
  return <div className="columns-1 gap-6 @3xl:columns-2">
    {families.map(family => {
      const entries = loaded[family.id]
      const entry = entries?.find(candidate => candidate.id === representativeEntries[family.id]) ?? entries?.[0]
      return <section key={family.id} aria-labelledby={`gallery-family-${family.id}`} className="relative mb-6 min-w-0 break-inside-avoid rounded-lg border border-border bg-card">
        <h2 id={`gallery-family-${family.id}`} className="text-base font-semibold">
          <Link href={`${GALLERY_BASE_PATH}?family=${family.id}`} className="flex items-center justify-between gap-3 p-5 after:absolute after:inset-0 after:rounded-lg hover:bg-muted/30 focus-visible:outline-none focus-visible:after:shadow-focus">
            <span className="flex items-center gap-3">{family.icon}{t(family.labelKey, family.id)}</span>
            <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </h2>
        <div className="min-h-40 border-t border-border bg-muted/20 p-5">
          {entry ? <div inert aria-hidden="true" className="flex min-h-28 min-w-0 flex-wrap items-center gap-3 [&>*]:max-w-full"><FamilyEntryPreview entry={entry} /></div> : failed[family.id] ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{t('design_system.gallery.loadFailed', 'Could not load this family')}</p><Button type="button" variant="outline" size="sm" className="relative z-10" onClick={() => onRetry(family)}>{t('design_system.gallery.retry', 'Retry')}</Button></div> : <Skeleton className="h-28 w-full" />}
        </div>
      </section>
    })}
  </div>
}
