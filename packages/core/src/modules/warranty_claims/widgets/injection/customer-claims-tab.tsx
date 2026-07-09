"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, FileText, Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  StatusBadge,
  type StatusBadgeVariant,
} from '@open-mercato/ui/primitives/status-badge'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { WarrantyClaimStatus } from '../../data/validators'
import { CLAIM_STATUS_BADGE_VARIANTS } from '../../backend/components/ClaimStatusBadge'

const CUSTOMER_CLAIMS_RESOURCE_KINDS = new Set(['customers.person', 'customers.company'])

type CustomerClaimsContext = {
  resourceKind: string
  resourceId: string
}

type ClaimListItem = {
  id: string | null
  claimNumber: string | null
  claimType: string | null
  status: WarrantyClaimStatus | string | null
  updatedAt: string | null
}

type ClaimsResponse = {
  items?: ClaimListItem[]
  total?: number
}

function isValidContext(ctx: unknown): ctx is CustomerClaimsContext {
  if (!ctx || typeof ctx !== 'object') return false
  const candidate = ctx as { resourceKind?: unknown; resourceId?: unknown }
  if (typeof candidate.resourceKind !== 'string' || !CUSTOMER_CLAIMS_RESOURCE_KINDS.has(candidate.resourceKind)) return false
  return typeof candidate.resourceId === 'string' && candidate.resourceId.trim().length > 0
}

function titleize(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function claimStatusVariant(status: string | null | undefined): StatusBadgeVariant {
  if (!status) return 'neutral'
  return CLAIM_STATUS_BADGE_VARIANTS[status as WarrantyClaimStatus] ?? 'neutral'
}

function ClaimStatusBadge({ status }: { status: string | null | undefined }) {
  const t = useT()
  const label = status
    ? t(`warranty_claims.status.${status}`, titleize(status))
    : t('warranty_claims.widgets.customerClaims.unknownStatus', 'Unknown')
  return (
    <StatusBadge variant={claimStatusVariant(status)} dot>
      {label}
    </StatusBadge>
  )
}

function ClaimRow({ claim }: { claim: ClaimListItem }) {
  const t = useT()
  const href = claim.id ? `/backend/warranty_claims/${claim.id}` : '/backend/warranty_claims'
  const relativeUpdatedAt = formatRelativeTime(claim.updatedAt)
  const absoluteUpdatedAt = formatDateTime(claim.updatedAt)
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={href}
            className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            <span className="truncate">{claim.claimNumber ?? t('warranty_claims.widgets.customerClaims.unnumbered', 'Unnumbered claim')}</span>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{claim.claimType ? t(`warranty_claims.claimType.${claim.claimType}`, titleize(claim.claimType)) : t('warranty_claims.widgets.customerClaims.unknownType', 'Unknown type')}</span>
            <span aria-hidden>·</span>
            <span title={absoluteUpdatedAt ?? undefined}>
              {relativeUpdatedAt ?? absoluteUpdatedAt ?? t('warranty_claims.widgets.customerClaims.notUpdated', 'Not updated')}
            </span>
          </div>
        </div>
        <ClaimStatusBadge status={claim.status} />
      </div>
    </li>
  )
}

export function CustomerClaimsTabWidget({
  context,
}: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const [claims, setClaims] = React.useState<ClaimListItem[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const customerId = isValidContext(context) ? context.resourceId : null

  React.useEffect(() => {
    if (!customerId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({
      customerId,
      page: '1',
      pageSize: '20',
      sortField: 'updatedAt',
      sortDir: 'desc',
    })
    apiCall<ClaimsResponse>(`/api/warranty_claims?${query.toString()}`)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          const items = Array.isArray(response.result.items) ? response.result.items : []
          setClaims(items)
          setTotal(typeof response.result.total === 'number' ? response.result.total : items.length)
          return
        }
        if (response.status === 403) {
          setClaims([])
          setTotal(0)
          return
        }
        setError(t('warranty_claims.widgets.customerClaims.error', 'Failed to load claims.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('warranty_claims.widgets.customerClaims.error', 'Failed to load claims.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, t])

  if (!customerId) return null

  const createHref = '/backend/warranty_claims/create'
  const countLabel = t('warranty_claims.widgets.customerClaims.count', '{count} claims', { count: total })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <FileText className="size-4" aria-hidden />
            {countLabel}
          </Badge>
        </div>
        <Button asChild size="sm">
          <Link href={createHref}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('warranty_claims.widgets.customerClaims.newClaim', 'New claim')}
          </Link>
        </Button>
      </div>

      {loading ? (
        <LoadingMessage label={t('warranty_claims.widgets.customerClaims.loading', 'Loading claims...')} />
      ) : error ? (
        <ErrorMessage label={error} />
      ) : claims.length === 0 ? (
        <EmptyState
          size="sm"
          variant="subtle"
          icon={<FileText className="h-5 w-5" aria-hidden />}
          title={t('warranty_claims.widgets.customerClaims.empty.title', 'No claims for this customer')}
          description={t('warranty_claims.widgets.customerClaims.empty.description', 'Create a warranty or RMA claim for this customer when they report an issue.')}
          actions={(
            <Button asChild size="sm" variant="outline">
              <Link href={createHref}>
                <Plus className="h-4 w-4" aria-hidden />
                {t('warranty_claims.widgets.customerClaims.newClaim', 'New claim')}
              </Link>
            </Button>
          )}
          className="border border-dashed border-border"
        />
      ) : (
        <ul className={cn('space-y-2')} aria-label={t('warranty_claims.widgets.customerClaims.listLabel', 'Customer claims')}>
          {claims.map((claim, index) => (
            <ClaimRow key={claim.id ?? `${claim.claimNumber ?? 'claim'}-${index}`} claim={claim} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default CustomerClaimsTabWidget
