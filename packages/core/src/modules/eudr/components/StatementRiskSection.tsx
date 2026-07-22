"use client"

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react'
import { resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { ColumnDef } from '@tanstack/react-table'
import type {
  EudrRiskConclusion,
  EudrRiskTier,
} from '../data/validators'

export type CountryRiskView = {
  country: string
  tier: string
}

export type StatementLatestRisk = {
  id?: string | null
  conclusion: EudrRiskConclusion
  overallTier: EudrRiskTier
  reviewDueAt: string | null
  countryRisks?: CountryRiskView[]
} | null

type RiskHistoryRow = {
  id: string
  conclusion: EudrRiskConclusion
  overallTier: EudrRiskTier
  assessedAt: string | null
  reviewDueAt: string | null
}

type RiskHistoryResponse = {
  items?: RiskHistoryRow[]
}

export type StatementRiskSectionProps = {
  statementId: string
  latestRisk: StatementLatestRisk
  onAssess?: () => void
}

export function riskTierBadgeVariant(tier: string | null | undefined): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (tier === 'low') return 'success'
  if (tier === 'high') return 'error'
  if (tier === 'mixed') return 'warning'
  if (tier === 'standard') return 'info'
  return 'neutral'
}

export function riskConclusionBadgeVariant(conclusion: string | null | undefined): 'success' | 'warning' | 'neutral' {
  if (conclusion === 'negligible') return 'success'
  if (conclusion === 'non_negligible') return 'warning'
  return 'neutral'
}

function formatDate(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleDateString()
}

function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

function normalizeHistoryRow(raw: RiskHistoryRow): RiskHistoryRow {
  return {
    id: raw.id,
    conclusion: raw.conclusion,
    overallTier: raw.overallTier,
    assessedAt: raw.assessedAt ?? null,
    reviewDueAt: raw.reviewDueAt ?? null,
  }
}

export function StatementRiskSection({
  statementId,
  latestRisk,
  onAssess,
}: StatementRiskSectionProps) {
  const translate = useT()
  const locale = useLocale()
  const [historyRows, setHistoryRows] = React.useState<RiskHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const assessHref = `/backend/eudr/risk-assessments/create?statementId=${encodeURIComponent(statementId)}`
  const latestRiskId = latestRisk?.id ?? historyRows[0]?.id ?? null

  React.useEffect(() => {
    let cancelled = false
    async function loadHistory() {
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        const call = await apiCall<RiskHistoryResponse>(
          `/api/eudr/risk-assessments?statementId=${encodeURIComponent(statementId)}&pageSize=5&sortField=assessedAt&sortDir=desc`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setHistoryError(translate('eudr.risk.history.loadError'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (!cancelled) setHistoryRows(items.map(normalizeHistoryRow))
      } catch {
        if (!cancelled) setHistoryError(translate('eudr.risk.history.loadError'))
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }
    loadHistory()
    return () => {
      cancelled = true
    }
  }, [statementId, translate])

  const historyColumns = React.useMemo<ColumnDef<RiskHistoryRow>[]>(() => [
    {
      accessorKey: 'assessedAt',
      header: translate('eudr.risk.history.columns.assessedAt'),
      cell: ({ row }) => formatDate(row.original.assessedAt, translate('eudr.common.empty')),
    },
    {
      accessorKey: 'conclusion',
      header: translate('eudr.risk.history.columns.conclusion'),
      cell: ({ row }) => (
        <StatusBadge variant={riskConclusionBadgeVariant(row.original.conclusion)}>
          {translate(`eudr.conclusion.${row.original.conclusion}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'overallTier',
      header: translate('eudr.risk.history.columns.overallTier'),
      cell: ({ row }) => (
        <StatusBadge variant={riskTierBadgeVariant(row.original.overallTier)}>
          {translate(`eudr.riskTier.${row.original.overallTier}`)}
        </StatusBadge>
      ),
    },
  ], [translate])

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{translate('eudr.risk.statementSection.title')}</h2>
          <p className="text-sm text-muted-foreground">{translate('eudr.risk.statementSection.description')}</p>
        </div>
        <Button asChild>
          <Link href={assessHref} onClick={onAssess}>
            <ShieldCheck className="size-4" aria-hidden="true" />
            {latestRisk ? translate('eudr.risk.statementSection.reassess') : translate('eudr.risk.statementSection.assess')}
          </Link>
        </Button>
      </div>

      {!latestRisk ? (
        <EmptyState
          size="sm"
          variant="subtle"
          title={translate('eudr.risk.statementSection.emptyTitle')}
          description={translate('eudr.risk.statementSection.emptyDescription')}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={riskConclusionBadgeVariant(latestRisk.conclusion)} dot>
              {translate(`eudr.conclusion.${latestRisk.conclusion}`)}
            </StatusBadge>
            <StatusBadge variant={riskTierBadgeVariant(latestRisk.overallTier)}>
              {translate(`eudr.riskTier.${latestRisk.overallTier}`)}
            </StatusBadge>
            {isOverdue(latestRisk.reviewDueAt) ? (
              <StatusBadge variant="warning">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {translate('eudr.risk.reviewOverdue')}
              </StatusBadge>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {translate('eudr.risk.reviewDueAt', {
                date: formatDate(latestRisk.reviewDueAt, translate('eudr.common.empty')),
              })}
            </span>
          </div>
          {Array.isArray(latestRisk.countryRisks) && latestRisk.countryRisks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {latestRisk.countryRisks.map((risk) => (
                <StatusBadge key={`${risk.country}:${risk.tier}`} variant={riskTierBadgeVariant(risk.tier)}>
                  {resolveCountryName(risk.country, { locale })} ({translate(`eudr.riskTier.${risk.tier}`)})
                </StatusBadge>
              ))}
            </div>
          ) : null}
          {latestRiskId ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link href={`/backend/eudr/risk-assessments/${latestRiskId}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                {translate('eudr.risk.statementSection.viewAssessment')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
              <Link href={assessHref} onClick={onAssess} className="inline-flex items-center gap-1 font-medium hover:underline">
                {translate('eudr.risk.statementSection.reassess')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </div>
      )}

      <DataTable<RiskHistoryRow>
        title={translate('eudr.risk.history.title')}
        columns={historyColumns}
        data={historyRows}
        isLoading={historyLoading}
        error={historyError}
        emptyState={(
          <EmptyState
            size="sm"
            variant="subtle"
            title={translate('eudr.risk.history.empty')}
          />
        )}
        perspective={{ tableId: 'eudr.statements.detail.risk_history' }}
        disableRowClick
      />
    </section>
  )
}

export default StatementRiskSection
