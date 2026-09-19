"use client"

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { useDisplayProfile } from '@open-mercato/ui/backend/markets/MarketProfileProvider'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { PriceWithCurrency } from '../PriceWithCurrency'

export type TaxJurisdictionRow = {
  jurisdictionCode?: string | null
  jurisdictionName?: string | null
  jurisdictionType?: string | null
  taxName?: string | null
  rate?: number | null
  taxableAmount?: number | null
  taxAmount?: number | null
  exemptAmount?: number | null
}

export type TaxInfoView = {
  providerKey?: string | null
  status?: string | null
  calculatedAt?: string | null
  breakdown?: TaxJurisdictionRow[] | null
  transaction?: { reference?: string | null; state?: string | null; externalUrl?: string | null } | null
  messages?: Array<{ level?: string | null; code?: string | null; text?: string | null }> | null
  failure?: { code?: string | null; message?: string | null; at?: string | null; providerKey?: string | null } | null
}

/** Mirrors the settings section: built in provider keys get a translated name. */
const BUILT_IN_PROVIDER_LABELS: Record<string, string> = {
  'table-rates': 'sales.providers.tax.tableRates.label',
  'fixed-rate': 'sales.providers.tax.fixedRate.label',
}

const statusVariants: Record<string, StatusBadgeVariant> = {
  calculated: 'success',
  exempt: 'info',
  fallback: 'warning',
  external: 'neutral',
}

type TaxBreakdownSectionProps = {
  taxStatus?: string | null
  taxStrategyKey?: string | null
  taxCalculatedAt?: string | null
  taxTransactionRef?: string | null
  taxInfo?: TaxInfoView | null
  currency?: string | null
  /** Absent for invoices and credit memos, which inherit rather than recalculate. */
  onRecalculate?: () => void | Promise<void>
  recalculating?: boolean
  className?: string
}

function formatTimestamp(
  value: string | null | undefined,
  locale: string,
  profile?: DisplayProfile | null,
): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return formatDisplayDateTime(parsed, locale, profile) ?? parsed.toLocaleString(locale)
}

/**
 * Shows where a document's tax came from: which provider produced it, whether
 * it is a firm figure or an estimate, and the per jurisdiction detail behind the
 * total. A `fallback` is the case this exists for — a provider outage must be
 * visible rather than silently becoming a mispriced invoice.
 */
export function TaxBreakdownSection({
  taxStatus,
  taxStrategyKey,
  taxCalculatedAt,
  taxTransactionRef,
  taxInfo,
  currency,
  onRecalculate,
  recalculating = false,
  className,
}: TaxBreakdownSectionProps) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)

  const status = taxStatus ?? taxInfo?.status ?? null
  const providerKey = taxStrategyKey ?? taxInfo?.providerKey ?? null
  const calculatedAt = taxCalculatedAt ?? taxInfo?.calculatedAt ?? null
  const transactionRef = taxTransactionRef ?? taxInfo?.transaction?.reference ?? null
  const breakdown = taxInfo?.breakdown ?? []
  const failure = taxInfo?.failure ?? null

  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'
  const displayProfile = useDisplayProfile()
  const calculatedAtLabel = formatTimestamp(calculatedAt, locale, displayProfile)

  if (!status && !providerKey && !taxInfo) {
    return (
      <div className={cn('space-y-3', className)}>
        <EmptyState
          title={t('sales.documents.detail.tax.title', 'Tax')}
          description={t(
            'sales.documents.detail.tax.status.none',
            'No tax provenance recorded for this document.'
          )}
        />
      </div>
    )
  }

  const variant: StatusBadgeVariant = (status ? statusVariants[status] : undefined) ?? 'neutral'
  const statusLabel = status
    ? t(`sales.documents.detail.tax.status.${status}`, status)
    : t('sales.documents.detail.tax.status.none', 'No tax provenance recorded for this document.')

  // A decline is an expected outcome, not an incident, so it reads as info.
  const isDecline = failure?.code === 'unsupported'
  const failureText = failure
    ? t(`sales.documents.detail.tax.failure.${failure.code ?? 'provider_error'}`, failure.message ?? '')
    : null

  return (
    <div className={cn('space-y-3', className)}>
      {status === 'fallback' && failure ? (
        <Alert status={isDecline ? 'information' : 'warning'}>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                {isDecline
                  ? t(
                      'sales.documents.detail.tax.declinedBanner',
                      'The tax provider declined this document; table rates were applied.'
                    )
                  : t(
                      'sales.documents.detail.tax.estimateBanner',
                      'Tax is an estimate: the provider did not answer, so table rates were applied.'
                    )}
              </p>
              {failureText ? <p className="text-xs">{failureText}</p> : null}
              {calculatedAtLabel ? (
                <p className="text-xs">
                  {t('sales.documents.detail.tax.calculatedAt', 'Calculated')}: {calculatedAtLabel}
                </p>
              ) : null}
              {onRecalculate ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onRecalculate()}
                  disabled={recalculating}
                  aria-label={t('sales.documents.detail.tax.recalculate', 'Recalculate tax')}
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', recalculating && 'animate-spin')} aria-hidden="true" />
                  {recalculating
                    ? t('sales.documents.detail.tax.recalculating', 'Recalculating…')
                    : t('sales.documents.detail.tax.recalculate', 'Recalculate tax')}
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('sales.documents.detail.tax.title', 'Tax')}
          </span>
          <div className="flex items-center gap-2">
            {providerKey ? (
              <span className="text-xs text-muted-foreground">
                {t('sales.documents.detail.tax.provider', 'Provider')}:{' '}
                {BUILT_IN_PROVIDER_LABELS[providerKey]
                  ? t(BUILT_IN_PROVIDER_LABELS[providerKey], providerKey)
                  : providerKey}
              </span>
            ) : null}
            <StatusBadge variant={variant} dot>
              {statusLabel}
            </StatusBadge>
          </div>
        </div>

        <dl className="divide-y divide-border/80 text-sm">
          {calculatedAtLabel ? (
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-muted-foreground">
                {t('sales.documents.detail.tax.calculatedAt', 'Calculated')}
              </dt>
              <dd className="font-medium">{calculatedAtLabel}</dd>
            </div>
          ) : null}
          {transactionRef ? (
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-muted-foreground">
                {t('sales.documents.detail.tax.transactionRef', 'Transaction reference')}
              </dt>
              <dd className="font-mono text-xs">
                {taxInfo?.transaction?.externalUrl ? (
                  <a
                    className="text-primary underline-offset-2 hover:underline"
                    href={taxInfo.transaction.externalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {transactionRef}
                  </a>
                ) : (
                  transactionRef
                )}
              </dd>
            </div>
          ) : null}
        </dl>

        {breakdown.length ? (
          <>
            <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('sales.documents.detail.tax.breakdown', 'Tax breakdown')}
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
              >
                {expanded
                  ? t('sales.documents.detail.totals.hideDetails', 'Hide details')
                  : t('sales.documents.detail.totals.showDetails', 'Show details')}
              </button>
            </div>
            {expanded ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">
                      {t('sales.documents.detail.tax.jurisdiction', 'Jurisdiction')}
                    </th>
                    <th className="px-4 py-2 text-right font-semibold">
                      {t('sales.documents.detail.tax.rate', 'Rate')}
                    </th>
                    <th className="px-4 py-2 text-right font-semibold">
                      {t('sales.documents.detail.tax.taxable', 'Taxable')}
                    </th>
                    <th className="px-4 py-2 text-right font-semibold">
                      {t('sales.documents.detail.tax.amount', 'Tax')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/80">
                  {breakdown.map((row, index) => (
                    <tr
                      key={`${row.jurisdictionCode ?? 'jurisdiction'}-${row.rate ?? 0}-${index}`}
                      className="bg-background/80"
                    >
                      <td className="px-4 py-2">
                        {row.jurisdictionName ?? row.taxName ?? row.jurisdictionCode ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {row.rate === null || row.rate === undefined ? '—' : `${row.rate}%`}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <PriceWithCurrency
                          amount={row.taxableAmount ?? null}
                          currency={currency}
                          className="font-mono"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <PriceWithCurrency
                          amount={row.taxAmount ?? null}
                          currency={currency}
                          className="font-mono"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
