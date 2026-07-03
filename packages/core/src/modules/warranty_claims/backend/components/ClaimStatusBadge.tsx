"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

export type ClaimStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'info_requested'
  | 'approved'
  | 'awaiting_return'
  | 'received'
  | 'inspecting'
  | 'resolved'
  | 'rejected'
  | 'closed'
  | 'cancelled'

export type ClaimLineStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'inspected'
  | 'resolved'

const claimStatusVariants: Record<ClaimStatus, StatusBadgeVariant> = {
  draft: 'neutral',
  submitted: 'info',
  in_review: 'info',
  info_requested: 'neutral',
  approved: 'warning',
  awaiting_return: 'warning',
  received: 'warning',
  inspecting: 'warning',
  resolved: 'success',
  rejected: 'error',
  closed: 'success',
  cancelled: 'error',
}

const lineStatusVariants: Record<ClaimLineStatus, StatusBadgeVariant> = {
  pending: 'neutral',
  approved: 'info',
  rejected: 'error',
  received: 'warning',
  inspected: 'warning',
  resolved: 'success',
}

function isClaimStatus(value: string): value is ClaimStatus {
  return Object.prototype.hasOwnProperty.call(claimStatusVariants, value)
}

function isClaimLineStatus(value: string): value is ClaimLineStatus {
  return Object.prototype.hasOwnProperty.call(lineStatusVariants, value)
}

export function getClaimStatusBadgeVariant(status: ClaimStatus): StatusBadgeVariant {
  return claimStatusVariants[status]
}

export function getClaimLineStatusBadgeVariant(status: ClaimLineStatus): StatusBadgeVariant {
  return lineStatusVariants[status]
}

export function ClaimStatusBadge({
  status,
  dot = true,
  className,
}: {
  status: ClaimStatus | string | null | undefined
  dot?: boolean
  className?: string
}) {
  const t = useT()
  const normalized = typeof status === 'string' && isClaimStatus(status) ? status : 'draft'
  return (
    <StatusBadge variant={getClaimStatusBadgeVariant(normalized)} dot={dot} className={className}>
      {t(`warranty_claims.status.${normalized}`)}
    </StatusBadge>
  )
}

export function ClaimLineStatusBadge({
  status,
  dot = true,
  className,
}: {
  status: ClaimLineStatus | string | null | undefined
  dot?: boolean
  className?: string
}) {
  const t = useT()
  const normalized = typeof status === 'string' && isClaimLineStatus(status) ? status : 'pending'
  return (
    <StatusBadge variant={getClaimLineStatusBadgeVariant(normalized)} dot={dot} className={className}>
      {t(`warranty_claims.lineStatus.${normalized}`)}
    </StatusBadge>
  )
}
