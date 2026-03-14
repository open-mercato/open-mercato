"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function InpostConfigWidget(_props: InjectionWidgetComponentProps) {
  const t = useT()
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        {t('carrier_inpost.config.help', 'Configure your InPost API token and organization ID in Integration credentials. Available services: Paczkomat lockers (standard & express) and courier delivery.')}
      </p>
    </div>
  )
}
