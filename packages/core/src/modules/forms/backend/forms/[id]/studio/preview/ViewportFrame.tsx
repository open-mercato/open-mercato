'use client'

import type * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export type PreviewViewport = 'mobile' | 'tablet' | 'desktop'

const VIEWPORT_CLASS: Record<PreviewViewport, string> = {
  mobile: 'max-w-sm',
  tablet: 'max-w-2xl',
  desktop: 'max-w-5xl',
}

export function ViewportFrame({
  viewport,
  onViewportChange,
  t,
  children,
}: {
  viewport: PreviewViewport
  onViewportChange: (viewport: PreviewViewport) => void
  t: TranslateFn
  children: React.ReactNode
}) {
  const viewports: PreviewViewport[] = ['mobile', 'tablet', 'desktop']
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {viewports.map((entry) => (
          <Button
            key={entry}
            type="button"
            variant={viewport === entry ? 'default' : 'outline'}
            size="sm"
            onClick={() => onViewportChange(entry)}
          >
            {t(`forms.studio.preview.viewport.${entry}`)}
          </Button>
        ))}
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-muted/20 p-4">
        <div className={`mx-auto rounded-md bg-background p-4 shadow-sm ${VIEWPORT_CLASS[viewport]}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
