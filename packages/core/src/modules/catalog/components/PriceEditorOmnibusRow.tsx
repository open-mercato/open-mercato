"use client"

import * as React from 'react'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type OmnibusBlock = {
  lowestPriceNet: string | null
  lowestPriceGross: string | null
  previousPriceNet: string | null
  previousPriceGross: string | null
  lookbackDays: number
  coverageStartAt: string | null
  applicabilityReason: string
  applicable: boolean
  promotionAnchorAt: string | null
}

type Props = {
  productId?: string | null
  variantId?: string | null
  offerId?: string | null
  priceKindId: string
  currencyCode: string
  channelId?: string | null
}

export function PriceEditorOmnibusRow({
  productId,
  variantId,
  offerId,
  priceKindId,
  currencyCode,
  channelId,
}: Props) {
  const t = useT()
  const locale = useLocale()
  const [block, setBlock] = React.useState<OmnibusBlock | null | undefined>(undefined)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!priceKindId || !currencyCode) {
      setBlock(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ priceKindId, currencyCode })
    if (productId) params.set('productId', productId)
    if (variantId) params.set('variantId', variantId)
    if (offerId) params.set('offerId', offerId)
    if (channelId) params.set('channelId', channelId)
    readApiResultOrThrow<OmnibusBlock | null>(`/api/catalog/prices/omnibus-preview?${params.toString()}`)
      .then((result) => {
        if (!cancelled) setBlock(result ?? null)
      })
      .catch(() => {
        if (!cancelled) setBlock(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [priceKindId, currencyCode, productId, variantId, offerId, channelId])

  if (loading) return <p className="text-xs text-muted-foreground mt-1">…</p>
  if (!block) return null

  const reason = block.applicabilityReason

  // Progressive reduction: show reference price (before the sequence) and current price separately.
  if (reason === 'progressive_reduction_frozen') {
    const refPrice = block.previousPriceGross ?? block.previousPriceNet
    const currentPrice = block.lowestPriceGross ?? block.lowestPriceNet
    return (
      <div className="mt-1 space-y-0.5">
        {refPrice ? (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.progressiveRef', 'Reference price (before reduction):')}
            {' '}
            <span className="font-medium">{refPrice} {currencyCode}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.progressiveRefUnavailable', 'No reference price recorded before the promotion started.')}
          </p>
        )}
        {currentPrice && (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.progressiveCurrent', 'Current (progressive reduction, Art. 6a(5)):')}
            {' '}
            <span className="font-medium">{currentPrice} {currencyCode}</span>
          </p>
        )}
      </div>
    )
  }

  // Failure / non-applicable reason codes — show a specific message instead of the generic "no history".
  if (reason === 'not_in_eu_market') {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        {t('catalog.omnibus.priceEditor.notInEuMarket', 'Channel not configured for EU market — add a country code in Omnibus settings.')}
      </p>
    )
  }

  if (reason === 'missing_channel_context') {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        {t('catalog.omnibus.priceEditor.missingChannelContext', 'Select a sales channel to view Omnibus data (channel is required).')}
      </p>
    )
  }

  if (reason === 'perishable_exempt') {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        {t('catalog.omnibus.priceEditor.perishableExempt', 'Exempt from Omnibus (perishable goods rule).')}
      </p>
    )
  }

  const lowestPrice = block.lowestPriceGross ?? block.lowestPriceNet
  const coverageDate = block.coverageStartAt
    ? new Date(block.coverageStartAt).toLocaleDateString(locale)
    : null
  const anchorDate = block.promotionAnchorAt
    ? new Date(block.promotionAnchorAt).toLocaleDateString(locale)
    : null

  return (
    <div className="mt-1 space-y-0.5">
      {lowestPrice ? (
        coverageDate ? (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.lowestPriceSince', 'Lowest price since {date}').replace('{date}', coverageDate)}
            {': '}
            <span className="font-medium">{lowestPrice} {currencyCode}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.lowestPriceLabel', 'Lowest price in last {days} days').replace('{days}', String(block.lookbackDays))}
            {': '}
            <span className="font-medium">{lowestPrice} {currencyCode}</span>
          </p>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('catalog.omnibus.priceEditor.noHistory', 'No price history recorded yet')}
        </p>
      )}
      {anchorDate ? (
        <p className="text-xs text-muted-foreground">
          {t('catalog.omnibus.priceEditor.anchoredWindow', 'Reference window anchored to promotion start: {date}').replace('{date}', anchorDate)}
        </p>
      ) : null}
      {reason === 'insufficient_history' && coverageDate ? (
        <p className="text-xs text-amber-600">
          {t('catalog.omnibus.priceEditor.insufficientHistory', "Coverage starts {date} — display as 'lowest since {date}', not 'lowest in 30 days'")
            .replace(/\{date\}/g, coverageDate)}
        </p>
      ) : null}
    </div>
  )
}
