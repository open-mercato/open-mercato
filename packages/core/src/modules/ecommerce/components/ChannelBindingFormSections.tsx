'use client'

import * as React from 'react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { ChannelAssortmentCountPanel } from './ChannelAssortmentCount'
import { buildAssortmentCountDraft, isPriceSortFallback, PRICE_SORT_CAP } from './storeChannels'
import { useChannelAssortmentCount } from './useChannelAssortmentCount'

type FormValuesProps = { values: Record<string, unknown> }

export function ChannelBindingLiveCount({ bindingId, values }: FormValuesProps & { bindingId: string | null }) {
  const draft = buildAssortmentCountDraft(values)
  const state = useChannelAssortmentCount(bindingId, draft)
  return <ChannelAssortmentCountPanel state={state} unrestricted={draft.scope === null} />
}

export function PriceSortFallbackConsequence({ values }: FormValuesProps) {
  const t = useT()
  const locale = useLocale()
  const cap = new Intl.NumberFormat(locale).format(PRICE_SORT_CAP)
  const fallback = isPriceSortFallback(values.priceSortFallback) ? values.priceSortFallback : 'approximate'
  const text =
    fallback === 'unavailable'
      ? t(
          'ecommerce.backend.store.channels.priceSortFallback.unavailableConsequence',
          'When more than {cap} products match, price sorting is withdrawn on this channel: price ascending and descending are no longer offered, and a buyer arriving on a shared price-sorted link gets the catalogue in the default order rather than an error.',
          { cap },
        )
      : t(
          'ecommerce.backend.store.channels.priceSortFallback.approximateConsequence',
          "When more than {cap} products match, the price order is computed from the default price kind, not from the buyer's own prices. The only signal is a response header no shopper sees, so contract-priced buyers may see an order that does not match what they pay.",
          { cap },
        )
  return (
    <Alert status="information" data-testid="price-sort-fallback-consequence">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
