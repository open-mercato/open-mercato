"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type EntitlementClaim = {
  id?: string | null
  orderId: string | null
}

type EntitlementLine = {
  productId: string | null
  sku: string | null
  serialNumber: string | null
  purchaseDate: string | null
}

type EntitlementResult = {
  warrantyStatus?: 'in_warranty' | 'out_of_warranty' | 'unknown'
  coverageType?: 'standard' | 'extended' | 'none' | null
  expiresAt?: string | null
  source?: 'registration' | 'order' | 'manual' | 'resolver' | null
  hasPriorClaims?: boolean
  priorClaimCount?: number
  priorRegistrationCount?: number
  relatedClaimNumbers?: string[]
}

const MAX_LINKED_CLAIM_NUMBERS = 3

type EntitlementLookupBadgeProps = {
  claim: EntitlementClaim
  lines: EntitlementLine[]
}

function buildEntitlementQuery(claim: EntitlementClaim, lines: EntitlementLine[]): string | null {
  const sourceLine = lines.find((line) => line.serialNumber)
    ?? lines.find((line) => line.productId || line.sku)
    ?? (claim.orderId ? lines.find((line) => line.purchaseDate) : null)
    ?? null
  if (!claim.orderId && !sourceLine?.serialNumber && !sourceLine?.productId && !sourceLine?.sku) return null
  const params = new URLSearchParams()
  if (sourceLine?.serialNumber) params.set('serialNumber', sourceLine.serialNumber)
  if (claim.orderId) params.set('orderId', claim.orderId)
  if (sourceLine?.productId) params.set('productId', sourceLine.productId)
  if (sourceLine?.sku) params.set('sku', sourceLine.sku)
  if (sourceLine?.purchaseDate) params.set('purchaseDate', sourceLine.purchaseDate)
  if (claim.id) params.set('excludeClaimId', claim.id)
  const query = params.toString()
  return query.length ? query : null
}

function statusVariant(status: string | null | undefined): StatusBadgeVariant {
  if (status === 'in_warranty') return 'success'
  if (status === 'out_of_warranty') return 'warning'
  return 'neutral'
}

function formatDateLabel(value: string, fallback: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function EntitlementLookupBadge({ claim, lines }: EntitlementLookupBadgeProps) {
  const t = useT()
  const query = buildEntitlementQuery(claim, lines)
  const [debouncedQuery, setDebouncedQuery] = React.useState<string | null>(query)
  const [result, setResult] = React.useState<EntitlementResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!query) {
      setDebouncedQuery(null)
      setResult(null)
      setError(null)
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [query])

  React.useEffect(() => {
    if (!debouncedQuery) {
      setResult(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiCall<EntitlementResult>(
      `/api/warranty_claims/entitlement?${debouncedQuery}`,
      undefined,
      { fallback: { warrantyStatus: 'unknown' } },
    )
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setResult(null)
          setError(t('warranty_claims.entitlement.error.load', 'Failed to resolve warranty entitlement.'))
          return
        }
        setResult(call.result ?? { warrantyStatus: 'unknown' })
      })
      .catch(() => {
        if (cancelled) return
        setResult(null)
        setError(t('warranty_claims.entitlement.error.load', 'Failed to resolve warranty entitlement.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, t])

  if (!query) return null
  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t('warranty_claims.entitlement.loading', 'Checking entitlement...')}
      </span>
    )
  }
  if (error) return <span className="text-xs text-muted-foreground">{error}</span>
  if (!result) return null

  const status = result.warrantyStatus ?? 'unknown'
  const coverage = result.coverageType
    ? t(`warranty_claims.entitlement.coverage.${result.coverageType}`, result.coverageType)
    : null
  const source = result.source
    ? t(`warranty_claims.entitlement.source.${result.source}`, result.source)
    : null
  const priorClaimCount = typeof result.priorClaimCount === 'number' ? result.priorClaimCount : null
  const relatedClaimNumbers = Array.isArray(result.relatedClaimNumbers)
    ? result.relatedClaimNumbers.filter((claimNumber): claimNumber is string => typeof claimNumber === 'string' && claimNumber.trim().length > 0)
    : []
  const linkedClaimNumbers = relatedClaimNumbers.slice(0, MAX_LINKED_CLAIM_NUMBERS)
  const hiddenClaimNumberCount = relatedClaimNumbers.length - linkedClaimNumbers.length

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge variant={statusVariant(status)}>
        {t(`warranty_claims.entitlement.status.${status}`, status)}
      </StatusBadge>
      {coverage ? <StatusBadge variant="neutral">{coverage}</StatusBadge> : null}
      {result.expiresAt ? (
        <span className="text-xs text-muted-foreground">
          {t('warranty_claims.entitlement.expiresAt', 'Expires {date}', {
            date: formatDateLabel(result.expiresAt, result.expiresAt),
          })}
        </span>
      ) : null}
      {source ? (
        <span className="text-xs text-muted-foreground">
          {t('warranty_claims.entitlement.sourceLabel', 'Source: {source}', { source })}
        </span>
      ) : null}
      {result.hasPriorClaims || priorClaimCount ? (
        <>
          <StatusBadge variant="warning">
            {t('warranty_claims.entitlement.priorClaims', '{count} prior claims', {
              count: priorClaimCount ?? 1,
            })}
          </StatusBadge>
          {linkedClaimNumbers.map((claimNumber) => (
            <Link
              key={claimNumber}
              href={`/backend/warranty_claims?search=${encodeURIComponent(claimNumber)}`}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              {claimNumber}
            </Link>
          ))}
          {hiddenClaimNumberCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('warranty_claims.entitlement.priorClaims.more', '+{count} more', {
                count: hiddenClaimNumberCount,
              })}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  )
}
