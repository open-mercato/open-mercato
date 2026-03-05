"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export default function StripeConfigWidget(_props: InjectionWidgetComponentProps) {
  const t = useT()
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        {t('gateway_stripe.config.help', 'Configure credentials in Integration details and assign Stripe payment methods in Sales configuration.')}
      </p>
      <Button type="button" variant="outline" onClick={() => { window.location.href = '/backend/sales/configuration?tab=payment-methods&provider=stripe' }}>
        {t('gateway_stripe.config.openPaymentMethods', 'Open payment methods')}
      </Button>
    </div>
  )
}
