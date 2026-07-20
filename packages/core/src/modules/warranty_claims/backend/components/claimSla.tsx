"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

export type ClaimSlaTier = 'none' | 'ok' | 'at_risk' | 'overdue' | 'paused'

export type ClaimSlaState = {
  tier: ClaimSlaTier
  dueAt: Date | null
  pausedAt: Date | null
}

export const CLAIM_SLA_DEFAULT_AT_RISK_PCT = 75

const SLA_TERMINAL_STATUSES = new Set(['draft', 'resolved', 'closed', 'rejected', 'cancelled'])

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function computeClaimSlaState(input: {
  slaDueAt?: string | null
  slaPausedAt?: string | null
  submittedAt?: string | null
  status?: string | null
  atRiskThresholdPct?: number
}): ClaimSlaState {
  const dueAt = parseDate(input.slaDueAt)
  const pausedAt = parseDate(input.slaPausedAt)
  const status = typeof input.status === 'string' ? input.status : ''
  if (!dueAt || SLA_TERMINAL_STATUSES.has(status)) {
    return { tier: 'none', dueAt, pausedAt }
  }
  if (pausedAt) return { tier: 'paused', dueAt, pausedAt }
  const now = Date.now()
  if (now >= dueAt.getTime()) return { tier: 'overdue', dueAt, pausedAt }
  const submittedAt = parseDate(input.submittedAt)
  if (submittedAt && dueAt.getTime() > submittedAt.getTime()) {
    const thresholdPct = input.atRiskThresholdPct ?? CLAIM_SLA_DEFAULT_AT_RISK_PCT
    const elapsedPct = ((now - submittedAt.getTime()) / (dueAt.getTime() - submittedAt.getTime())) * 100
    if (elapsedPct >= thresholdPct) return { tier: 'at_risk', dueAt, pausedAt }
  }
  return { tier: 'ok', dueAt, pausedAt }
}

const SLA_TIER_TEXT_CLASSES: Record<Exclude<ClaimSlaTier, 'none' | 'paused'>, string> = {
  ok: 'text-sm text-muted-foreground',
  at_risk: 'text-sm font-medium text-status-warning-text',
  overdue: 'text-sm font-medium text-status-error-text',
}

export function ClaimSlaIndicator({
  slaDueAt,
  slaPausedAt,
  submittedAt,
  status,
  atRiskThresholdPct,
  className,
}: {
  slaDueAt?: string | null
  slaPausedAt?: string | null
  submittedAt?: string | null
  status?: string | null
  atRiskThresholdPct?: number
  className?: string
}) {
  const t = useT()
  const locale = useLocale()
  const state = computeClaimSlaState({ slaDueAt, slaPausedAt, submittedAt, status, atRiskThresholdPct })
  if (state.tier === 'none') {
    return <span className={className ?? 'text-sm text-muted-foreground'}>{t('warranty_claims.common.noValue')}</span>
  }
  if (state.tier === 'paused') {
    return (
      <StatusBadge variant="neutral" dot className={className}>
        {t('warranty_claims.sla.paused')}
      </StatusBadge>
    )
  }
  const relative = formatRelativeTime(state.dueAt ? state.dueAt.toISOString() : null, { locale })
  const absolute = formatDateTime(state.dueAt ? state.dueAt.toISOString() : null)
  const prefix =
    state.tier === 'overdue'
      ? `${t('warranty_claims.sla.overdue')} — `
      : state.tier === 'at_risk'
        ? `${t('warranty_claims.sla.atRisk')} — `
        : ''
  return (
    <span className={className ?? SLA_TIER_TEXT_CLASSES[state.tier]} title={absolute ?? undefined}>
      {prefix}
      {relative ?? t('warranty_claims.common.noValue')}
    </span>
  )
}
