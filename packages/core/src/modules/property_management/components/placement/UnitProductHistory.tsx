"use client"

import * as React from 'react'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { UsageBlockerRow } from '../usageBlockers'

export type UnitProductPeriodRow = {
  id: string
  catalogProductId: string
  productName: string
  use: 'leasable' | 'bookable'
  billingUnit: 'month' | 'hour' | 'day'
  priceAmount: string | null
  currencyCode: string | null
  validFrom: string | null
  validTo: string | null
}

export type { UsageBlockerRow }

export type UnitProductInfo = {
  periods: UnitProductPeriodRow[]
  productLocked: boolean
  activeLeases: UsageBlockerRow[]
  upcomingBookings: UsageBlockerRow[]
}

export type UnitProductInfoState = { info: UnitProductInfo | null; loading: boolean; failed: boolean; retry: () => void }

export function useUnitProductInfo(unitId: string | null): UnitProductInfoState {
  const [info, setInfo] = React.useState<UnitProductInfo | null>(null)
  const [loading, setLoading] = React.useState(Boolean(unitId))
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!unitId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    apiCall<UnitProductInfo>(`/api/property_management/units/${encodeURIComponent(unitId)}/product`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) setInfo(call.result)
        else setFailed(true)
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unit_product_info_load_failed' })
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt, unitId])
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { info, loading, failed, retry }
}

export function unitProductLockedReason(t: TranslateFn, unitId: string | null, state: Pick<UnitProductInfoState, 'info' | 'loading' | 'failed'>): string | null {
  if (state.info?.productLocked) return t('property_management.units.form.productLocked', 'Locked while the unit is leased — the lease was signed for this product.')
  if (!unitId || state.info) return null
  if (state.failed) return t('property_management.units.form.productLockUnknown', 'Locked until we can check whether the unit is leased. Retry loading the product history below.')
  return t('property_management.units.form.productLockChecking', 'Checking whether the unit is leased…')
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(locale || undefined)
}

function formatPrice(row: UnitProductPeriodRow, locale: string): string | null {
  if (!row.priceAmount) return null
  const amount = Number(row.priceAmount)
  if (!Number.isFinite(amount)) return null
  if (!row.currencyCode) return amount.toLocaleString(locale || undefined)
  try {
    return amount.toLocaleString(locale || undefined, { style: 'currency', currency: row.currencyCode })
  } catch {
    return `${amount} ${row.currencyCode}`
  }
}

export type UnitProductHistoryProps = { periods: UnitProductPeriodRow[]; failed?: boolean; onRetry?: () => void }

export function UnitProductHistory({ periods, failed = false, onRetry }: UnitProductHistoryProps) {
  const t = useT()
  const locale = useLocale()
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="pm-unit-product-history">
      <div>
        <h2 id="pm-unit-product-history" className="text-base font-semibold">
          {t('property_management.units.history.title', 'Product history')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('property_management.units.history.description', 'Every product this unit has had. Leases and bookings keep the product and price they were made at.')}
        </p>
      </div>
      {failed ? (
        <Alert status="error" data-testid="unit-product-history-error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('property_management.units.history.loadError', 'Could not load the product history.')}</span>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('property_management.common.retry', 'Try again')}</Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : periods.length ? (
        <ul className="divide-y" data-testid="unit-product-history">
          {periods.map((row) => {
            const from = formatDate(row.validFrom, locale)
            const to = formatDate(row.validTo, locale)
            const price = formatPrice(row, locale)
            return (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="font-medium">{row.productName}</span>
                <span className="text-muted-foreground">
                  {t(`property_management.units.use.${row.use}`, row.use)}
                  {price ? ` · ${price} / ${t(`property_management.units.billingUnit.${row.billingUnit}`, row.billingUnit)}` : ''}
                </span>
                <span className="text-muted-foreground">
                  {to
                    ? t('property_management.units.history.range', '{from} – {to}', { from: from ?? '—', to })
                    : t('property_management.units.history.current', 'Since {from} (current)', { from: from ?? '—' })}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('property_management.units.history.empty', 'No product history yet.')}</p>
      )}
    </section>
  )
}
