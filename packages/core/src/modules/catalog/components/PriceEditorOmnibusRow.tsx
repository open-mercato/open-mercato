"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type OmnibusBlock = {
  lowestPriceNet: string | null
  lowestPriceGross: string | null
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

  const lowestPrice = block.lowestPriceGross ?? block.lowestPriceNet
  const coverageDate = block.coverageStartAt
    ? new Date(block.coverageStartAt).toLocaleDateString()
    : null
  const anchorDate = block.promotionAnchorAt
    ? new Date(block.promotionAnchorAt).toLocaleDateString()
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
      {block.applicabilityReason === 'insufficient_history' && coverageDate ? (
        <p className="text-xs text-amber-600">
          {t('catalog.omnibus.priceEditor.insufficientHistory', "Coverage starts {date} — display as 'lowest since {date}', not 'lowest in 30 days'")
            .replace(/\{date\}/g, coverageDate)}
        </p>
      ) : null}
    </div>
  )
}
