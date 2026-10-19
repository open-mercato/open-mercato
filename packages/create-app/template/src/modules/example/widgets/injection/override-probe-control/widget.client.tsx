"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function OverrideProbeControlWidget() {
  const t = useT()
  return (
    <div
      data-testid="example-override-probe-control"
      className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground"
    >
      {t('example.umes.extensions.phaseI.control', 'Override probe control widget — no override, always visible.')}
    </div>
  )
}
