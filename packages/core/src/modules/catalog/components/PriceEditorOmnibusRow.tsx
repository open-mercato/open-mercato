"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'

type OmnibusBlock = {
  presentedPriceKindId: string
  lookbackDays: number
  minimizationAxis: 'gross' | 'net'
  promotionAnchorAt: string | null
  windowStart: string
  windowEnd: string
  coverageStartAt: string | null
  lowestPriceNet: string | null
  lowestPriceGross: string | null
  previousPriceNet: string | null
  previousPriceGross: string | null
  currencyCode: string
  applicable: boolean
  applicabilityReason: string
}

export type PriceEditorOmnibusRowProps = {
  priceKindId: string
  currencyCode: string
  productId?: string | null
  variantId?: string | null
  offerId?: string | null
  channelId?: string | null
}

function isOmnibusBlock(value: unknown): value is OmnibusBlock {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.applicabilityReason === 'string' && typeof record.lookbackDays === 'number'
}

export function PriceEditorOmnibusRow({
  priceKindId,
  currencyCode,
  productId,
  variantId,
  offerId,
  channelId,
}: PriceEditorOmnibusRowProps) {
  const t = useT()
  const locale = useLocale()
  const [block, setBlock] = React.useState<OmnibusBlock | null>(null)
  const [loading, setLoading] = React.useState(false)

  const hasScope = Boolean(productId || variantId || offerId)

  React.useEffect(() => {
    if (!priceKindId || !currencyCode || !hasScope) {
      setBlock(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ priceKindId, currencyCode })
    if (productId) params.set('productId', productId)
    if (variantId) params.set('variantId', variantId)
    if (offerId) params.set('offerId', offerId)
    if (channelId) params.set('channelId', channelId)
    apiCall<unknown>(`/api/catalog/prices/omnibus-preview?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        setBlock(call.ok && isOmnibusBlock(call.result) ? call.result : null)
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
  }, [priceKindId, currencyCode, productId, variantId, offerId, channelId, hasScope])

  if (loading) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t('catalog.omnibus.priceEditor.loading', 'Checking Omnibus reference price…')}
      </p>
    )
  }

  if (!block) return null

  const formatDate = (value: string | null): string | null => {
    if (!value) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toLocaleDateString(locale)
  }

  const formatMoney = (value: string | null): string | null =>
    value == null ? null : `${value} ${block.currencyCode || currencyCode}`

  const reason = block.applicabilityReason
  const lowestPrice = formatMoney(block.lowestPriceGross ?? block.lowestPriceNet)
  const previousPrice = formatMoney(block.previousPriceGross ?? block.previousPriceNet)
  const coverageDate = formatDate(block.coverageStartAt)
  const anchorDate = formatDate(block.promotionAnchorAt)

  // Progressive reduction (Art. 6a(5)): the reference stays frozen at the pre-campaign
  // baseline (`lowestPrice*`) while the current campaign step is carried in `previousPrice*`.
  if (reason === 'progressive_reduction_frozen') {
    return (
      <div className="mt-2 space-y-1">
        {lowestPrice ? (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.progressiveRef', 'Reference price (before reduction):')}{' '}
            <span className="font-medium text-foreground">{lowestPrice}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              'catalog.omnibus.priceEditor.progressiveRefUnavailable',
              'No reference price recorded before the promotion started.',
            )}
          </p>
        )}
        {previousPrice ? (
          <p className="text-xs text-muted-foreground">
            {t('catalog.omnibus.priceEditor.progressiveCurrent', 'Current (progressive reduction, Art. 6a(5)):')}{' '}
            <span className="font-medium text-foreground">{previousPrice}</span>
          </p>
        ) : null}
      </div>
    )
  }

  if (reason === 'not_in_eu_market') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          'catalog.omnibus.reason.notInEuMarket',
          'Channel is not configured for an EU market — add a country code in Omnibus settings.',
        )}
      </p>
    )
  }

  if (reason === 'missing_channel_context') {
    return (
      <p className="mt-2 text-xs text-status-warning-text">
        {t(
          'catalog.omnibus.reason.missingChannelContext',
          'Select a sales channel to compute the Omnibus reference price (channel is required).',
        )}
      </p>
    )
  }

  if (reason === 'perishable_exempt') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t('catalog.omnibus.reason.perishableExempt', 'Exempt from Omnibus (perishable goods rule).')}
      </p>
    )
  }

  if (reason === 'perishable_last_price') {
    return (
      <div className="mt-2 space-y-1">
        <p className="text-xs text-muted-foreground">
          {t(
            'catalog.omnibus.reason.perishableLastPrice',
            'Reference price: immediately preceding price (perishable goods rule).',
          )}
        </p>
        {lowestPrice ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{lowestPrice}</span>
          </p>
        ) : null}
      </div>
    )
  }

  if (reason === 'no_history') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t('catalog.omnibus.reason.noHistory', 'No price history recorded yet for this price kind.')}
      </p>
    )
  }

  if (reason === 'not_announced') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          'catalog.omnibus.reason.notAnnounced',
          'No announced price reduction — the prior-price reference is not displayed to customers.',
        )}
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-1">
      {lowestPrice ? (
        <p className="text-xs text-muted-foreground">
          {coverageDate
            ? t('catalog.omnibus.priceEditor.lowestSince', 'Lowest price since {date}', { date: coverageDate })
            : t('catalog.omnibus.priceEditor.lowestInDays', 'Lowest price in the last {days} days', {
                days: block.lookbackDays,
              })}
          {': '}
          <span className="font-medium text-foreground">{lowestPrice}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('catalog.omnibus.reason.noHistory', 'No price history recorded yet for this price kind.')}
        </p>
      )}
      {reason === 'new_arrival_reduced_window' ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'catalog.omnibus.reason.newArrivalReducedWindow',
            'New product — a shorter lookback window of {days} days was applied.',
            { days: block.lookbackDays },
          )}
        </p>
      ) : null}
      {anchorDate ? (
        <p className="text-xs text-muted-foreground">
          {t('catalog.omnibus.priceEditor.anchoredWindow', 'Reference window anchored to promotion start: {date}', {
            date: anchorDate,
          })}
        </p>
      ) : null}
      {reason === 'insufficient_history' ? (
        <p className="text-xs text-status-warning-text">
          {coverageDate
            ? t(
                'catalog.omnibus.reason.insufficientHistory',
                'History only covers from {date} — present it as "lowest since {date}", not as a full {days}-day window.',
                { date: coverageDate, days: block.lookbackDays },
              )
            : t(
                'catalog.omnibus.reason.insufficientHistoryNoDate',
                'Price history does not cover the full lookback window yet.',
              )}
        </p>
      ) : null}
    </div>
  )
}
