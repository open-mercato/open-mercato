'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type OrderContext = {
  metadata?: Record<string, unknown> | null
  [key: string]: unknown
}

export default function StorefrontOrderSourceWidget({
  context,
}: InjectionWidgetComponentProps<OrderContext, unknown>) {
  const t = useT()

  const sourceStoreId = context?.metadata?.sourceStoreId as string | null | undefined
  const sourceCartId = context?.metadata?.sourceCartId as string | null | undefined

  if (!sourceStoreId) {
    return null
  }

  const cartShort = sourceCartId ? sourceCartId.slice(0, 8) : null

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-sm font-semibold text-foreground mb-1">
        {t('ecommerce.widgets.storefrontSource.title', 'Storefront')}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <div>
          <span className="font-medium">{t('ecommerce.widgets.storefrontSource.storeId', 'Store')}:</span>{' '}
          <span className="font-mono">{sourceStoreId.slice(0, 8)}…</span>
        </div>
        {cartShort ? (
          <div>
            <span className="font-medium">{t('ecommerce.widgets.storefrontSource.cartId', 'Cart')}:</span>{' '}
            <span className="font-mono">{cartShort}…</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
