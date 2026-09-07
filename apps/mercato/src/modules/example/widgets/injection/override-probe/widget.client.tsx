"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function OverrideProbeWidget() {
  const t = useT()
  return (
    <div
      data-testid="example-override-probe"
      className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground"
    >
      {t('example.umes.extensions.phaseI.probe', 'Override probe widget — disabled through modules.ts.')}
    </div>
  )
}
