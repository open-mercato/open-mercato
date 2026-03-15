"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function StripeConfigWidget(_props: InjectionWidgetComponentProps) {
  const t = useT()
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        {t('gateway_stripe.config.help', 'Configure credentials in Integration details. Consumer modules decide how to bind Stripe to their payment UIs.')}
      </p>
    </div>
  )
}
