"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OmnibusApplicabilityReason, OmnibusBlock } from '../lib/omnibusTypes'

const logger = createLogger('catalog').child({ component: 'PriceEditorOmnibusRow' })

const PRICE_HISTORY_VIEW_FEATURE = 'catalog.price_history.view'

const NOT_APPLICABLE_REASONS: ReadonlySet<OmnibusApplicabilityReason> = new Set([
  'no_history',
  'not_in_eu_market',
  'missing_channel_context',
  'perishable_exempt',
])

const REASON_VARIANTS: Record<OmnibusApplicabilityReason, StatusBadgeVariant> = {
  no_history: 'neutral',
  not_in_eu_market: 'neutral',
  missing_channel_context: 'warning',
  insufficient_history: 'warning',
  announced_promotion: 'info',
  not_announced: 'neutral',
  progressive_reduction_frozen: 'info',
  perishable_exempt: 'neutral',
  perishable_last_price: 'info',
  new_arrival_reduced_window: 'info',
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error' }
  | { status: 'ready'; block: OmnibusBlock }

export type PriceEditorOmnibusRowProps = {
  priceKindId: string
  currencyCode: string | null | undefined
  productId?: string | null
  variantId?: string | null
  offerId?: string | null
  channelId?: string | null
  channelSelectable?: boolean
}

function isOmnibusBlock(value: unknown): value is OmnibusBlock {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OmnibusBlock>
  return typeof candidate.applicabilityReason === 'string' && typeof candidate.lookbackDays === 'number'
}

function pickAxisAmount(block: OmnibusBlock, net: string | null, gross: string | null): string | null {
  return block.minimizationAxis === 'net' ? net ?? gross : gross ?? net
}

function formatAmount(amount: string | null, currencyCode: string, locale: string): string | null {
  if (!amount) return null
  const numeric = Number(amount)
  const code = currencyCode.toUpperCase()
  if (!Number.isFinite(numeric)) return `${code} ${amount}`
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(numeric)
  } catch {
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric)
    return `${code} ${formatted}`
  }
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

export function PriceEditorOmnibusRow({
  priceKindId,
  currencyCode,
  productId,
  variantId,
  offerId,
  channelId,
  channelSelectable = true,
}: PriceEditorOmnibusRowProps) {
  const t = useT()
  const locale = useLocale()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const canView = chromeReady && hasFeature(chromePayload?.grantedFeatures, PRICE_HISTORY_VIEW_FEATURE)
  const normalizedCurrency = typeof currencyCode === 'string' ? currencyCode.trim().toUpperCase() : ''
  const hasTarget = Boolean(productId || variantId || offerId)
  const [state, setState] = React.useState<PreviewState>({ status: 'loading' })

  React.useEffect(() => {
    if (!canView || !hasTarget || !priceKindId || !normalizedCurrency) {
      setState({ status: 'hidden' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const params = new URLSearchParams({ priceKindId, currencyCode: normalizedCurrency })
    if (productId) params.set('productId', productId)
    if (variantId) params.set('variantId', variantId)
    if (offerId) params.set('offerId', offerId)
    if (channelId) params.set('channelId', channelId)
    apiCall<unknown>(`/api/catalog/prices/omnibus-preview?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setState(call.status === 403 || call.status === 404 ? { status: 'hidden' } : { status: 'error' })
          return
        }
        setState(isOmnibusBlock(call.result) ? { status: 'ready', block: call.result } : { status: 'hidden' })
      })
      .catch((err) => {
        logger.error('catalog.omnibus.preview.load failed', { err })
        getTelemetryRuntime()?.reportError(err, { module: 'catalog', code: 'catalog.omnibus_preview_load_failed' })
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [canView, channelId, hasTarget, normalizedCurrency, offerId, priceKindId, productId, variantId])

  const reasonLabels = React.useMemo<Record<OmnibusApplicabilityReason, string>>(() => ({
    no_history: t('catalog.omnibus.reason.noHistory', 'No price history'),
    not_in_eu_market: t('catalog.omnibus.reason.notInEuMarket', 'Not an EU market'),
    missing_channel_context: t('catalog.omnibus.reason.missingChannelContext', 'Channel required'),
    insufficient_history: t('catalog.omnibus.reason.insufficientHistory', 'Insufficient history'),
    announced_promotion: t('catalog.omnibus.reason.announcedPromotion', 'Announced promotion'),
    not_announced: t('catalog.omnibus.reason.notAnnounced', 'No announced reduction'),
    progressive_reduction_frozen: t('catalog.omnibus.reason.progressiveReductionFrozen', 'Progressive reduction'),
    perishable_exempt: t('catalog.omnibus.reason.perishableExempt', 'Perishable goods exemption'),
    perishable_last_price: t('catalog.omnibus.reason.perishableLastPrice', 'Perishable goods: last price'),
    new_arrival_reduced_window: t('catalog.omnibus.reason.newArrivalReducedWindow', 'New arrival: shorter window'),
  }), [t])

  if (state.status === 'hidden') return null

  if (state.status === 'loading') {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="catalog-price-omnibus-row">
        <Spinner className="size-3" />
        {t('catalog.omnibus.priceEditor.loading', 'Loading Omnibus reference price…')}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="mt-2 text-xs text-status-error-text" data-testid="catalog-price-omnibus-row">
        {t('catalog.omnibus.priceEditor.loadError', 'Could not load the Omnibus reference price.')}
      </p>
    )
  }

  const { block } = state
  const reason = block.applicabilityReason
  const reasonBadge = (
    <StatusBadge variant={REASON_VARIANTS[reason] ?? 'neutral'}>{reasonLabels[reason] ?? reason}</StatusBadge>
  )
  const lowest = formatAmount(pickAxisAmount(block, block.lowestPriceNet, block.lowestPriceGross), block.currencyCode, locale)

  if (NOT_APPLICABLE_REASONS.has(reason) || !lowest) {
    return (
      <div className="mt-2 space-y-1 text-xs" data-testid="catalog-price-omnibus-row">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>{t('catalog.omnibus.priceEditor.notApplicable', 'Omnibus reference price not applicable')}</span>
          {reasonBadge}
        </div>
        {reason === 'missing_channel_context' ? (
          <p className="text-status-warning-text">
            {channelSelectable
              ? t('catalog.omnibus.priceEditor.missingChannel', 'Select a channel to compute the reference price.')
              : t('catalog.omnibus.priceEditor.perChannelReference', 'The reference price is computed per sales channel.')}
          </p>
        ) : null}
      </div>
    )
  }

  const isProgressive = reason === 'progressive_reduction_frozen'
  const previous = isProgressive
    ? formatAmount(pickAxisAmount(block, block.previousPriceNet, block.previousPriceGross), block.currencyCode, locale)
    : null
  const coverageStart = reason === 'insufficient_history' ? formatDate(block.coverageStartAt, locale) : null

  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="catalog-price-omnibus-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">
          {isProgressive
            ? t('catalog.omnibus.priceEditor.progressiveRef', 'Reference price (frozen for the progressive reduction)')
            : t('catalog.omnibus.priceEditor.lowestInDays', 'Lowest price in the last {{days}} days', { days: block.lookbackDays })}
        </span>
        <span className="font-medium" data-testid="catalog-price-omnibus-reference">{lowest}</span>
        {reasonBadge}
      </div>
      {previous ? (
        <p className="text-muted-foreground">
          {t('catalog.omnibus.priceEditor.previousPrice', 'Price before the reduction: {{price}}', { price: previous })}
        </p>
      ) : null}
      {reason === 'insufficient_history' ? (
        <p className="text-status-warning-text">
          {coverageStart
            ? t('catalog.omnibus.priceEditor.insufficientHistorySince', 'Price history is only available since {{date}}; the reference may be incomplete.', { date: coverageStart })
            : t('catalog.omnibus.priceEditor.insufficientHistory', 'Price history does not cover the full window; the reference may be incomplete.')}
        </p>
      ) : null}
    </div>
  )
}
