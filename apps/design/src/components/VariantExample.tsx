'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { CodeBlock } from './CodeBlock'
import { PreviewFrame } from './PreviewFrame'

type VariantExampleProps = {
  entryId: string
  variant: { id: string; title: string; code: string }
}

export function VariantExample({ entryId, variant }: VariantExampleProps) {
  const t = useT()
  const [view, setView] = React.useState<'preview' | 'code'>('preview')
  const headingId = `example-${variant.id}`
  return (
    <section aria-labelledby={headingId} className="min-w-0 scroll-mt-20 space-y-3" id={`variant-${variant.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="text-lg font-normal text-foreground">{variant.title}</h3>
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
      {view === 'preview' ? (
        <PreviewFrame entryId={entryId} variantId={variant.id} title={variant.title} />
      ) : (
        <CodeBlock code={variant.code} />
      )}
    </section>
  )
}
