"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

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

export type UsageBlockerRow = { kind: 'lease' | 'booking'; id: string; label: string; unitId: string; until: string | null }

export type UnitProductInfo = {
  periods: UnitProductPeriodRow[]
  productLocked: boolean
  activeLeases: UsageBlockerRow[]
  upcomingBookings: UsageBlockerRow[]
}

export function useUnitProductInfo(unitId: string | null): { info: UnitProductInfo | null; loading: boolean } {
  const [info, setInfo] = React.useState<UnitProductInfo | null>(null)
  const [loading, setLoading] = React.useState(Boolean(unitId))
  React.useEffect(() => {
    if (!unitId) {
      setLoading(false)
      return
    }
    let cancelled = false
    apiCall<UnitProductInfo>(`/api/property_management/units/${encodeURIComponent(unitId)}/product`)
      .then((call) => {
        if (!cancelled && call.ok && call.result) setInfo(call.result)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [unitId])
  return { info, loading }
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

export function UnitProductHistory({ periods }: { periods: UnitProductPeriodRow[] }) {
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
      {periods.length ? (
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
