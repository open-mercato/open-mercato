'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { ExternalLink } from 'lucide-react'
import { previewHref } from '@/lib/links'
import { CodeBlock } from './CodeBlock'
import { useDesignSettings } from './DesignSettings'
import { PreviewFrame } from './PreviewFrame'

type VariantExampleProps = {
  entryId: string
  variant: { id: string; title: string; code: string; description?: string }
}

export function VariantExample({ entryId, variant }: VariantExampleProps) {
  const t = useT()
  const { mode } = useDesignSettings()
  const [view, setView] = React.useState<'preview' | 'code'>('preview')
  const headingId = `example-${variant.id}`
  return (
    <section aria-labelledby={headingId} className="min-w-0 scroll-mt-20 space-y-3" id={`variant-${variant.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl space-y-1">
          <h3 id={headingId} className="text-lg font-normal text-foreground">{variant.title}</h3>
          {variant.description ? <p className="text-sm text-muted-foreground">{variant.description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
        <a
          href={previewHref(entryId, variant.id, mode)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus"
          aria-label={t('design.entry.openStandalone', { title: variant.title })}
          title={t('design.entry.openStandalone', { title: variant.title })}
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
        <SegmentedControl
          className="om-design-switch"
          size="sm"
          aria-label={t('design.entry.viewLabel')}
          value={view}
          onValueChange={(value) => setView(value === 'code' ? 'code' : 'preview')}
        >
          <SegmentedControlItem value="preview">{t('design.entry.preview')}</SegmentedControlItem>
          <SegmentedControlItem value="code">{t('design.entry.code')}</SegmentedControlItem>
        </SegmentedControl>
        </div>
      </div>
      {view === 'preview' ? (
        <PreviewFrame entryId={entryId} variantId={variant.id} title={variant.title} />
      ) : (
        <CodeBlock code={variant.code} />
      )}
    </section>
  )
}
