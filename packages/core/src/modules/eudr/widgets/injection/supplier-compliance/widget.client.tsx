"use client"

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { statusBadgeVariant } from '../../../components/formConfig'
import { EUDR_SUBMISSION_STATUSES } from '../../../data/validators'

const logger = createLogger('eudr')

type SupplierCompliance = {
  submissions: {
    total: number
    byStatus: Record<string, number>
    avgCompleteness: number | null
  }
  lastSubmissionAt: string | null
  plots?: {
    total: number
    withWarnings: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readNestedCompanyId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.company)) return null
  return readId(value.company.id)
}

function resolveCompanyId(context: unknown, data: unknown): string | null {
  if (!isRecord(context)) return readNestedCompanyId(data)
  return readId(context.companyId)
    ?? readId(context.resourceId)
    ?? readId(context.entityId)
    ?? readId(context.recordId)
    ?? readNestedCompanyId(context.data)
    ?? readNestedCompanyId(data)
}

function formatDate(value: string | null, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? emptyLabel : date.toLocaleDateString()
}

async function loadSupplierCompliance(supplierEntityId: string): Promise<SupplierCompliance | null> {
  try {
    const call = await apiCall<SupplierCompliance>(
      `/api/eudr/suppliers/compliance?supplierEntityId=${encodeURIComponent(supplierEntityId)}`,
      {
        headers: {
          'x-om-forbidden-redirect': '0',
          'x-om-unauthorized-redirect': '0',
        },
      },
    )
    if (!call.ok || !call.result) {
      throw new Error(`[internal] EUDR supplier compliance request failed with status ${call.status}`)
    }
    return call.result
  } catch (err) {
    logger.debug('Supplier compliance widget data unavailable', {
      component: 'supplier-compliance',
      err,
    })
    return null
  }
}

export default function SupplierComplianceWidget({
  context,
  data,
}: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const companyId = resolveCompanyId(context, data)
  const { data: compliance } = useQuery({
    queryKey: ['eudr-supplier-compliance', companyId],
    queryFn: () => companyId ? loadSupplierCompliance(companyId) : Promise.resolve(null),
    enabled: Boolean(companyId),
    staleTime: 5_000,
  })

  if (!companyId || !compliance) return null
  if (compliance.submissions.total === 0 && (!compliance.plots || compliance.plots.total === 0)) return null

  const emptyLabel = t('eudr.common.empty')
  const statusCounts = EUDR_SUBMISSION_STATUSES.flatMap((status) => {
    const count = compliance.submissions.byStatus[status] ?? 0
    return count > 0 ? [{ status, count }] : []
  })

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-sm font-semibold text-foreground">
        {t('eudr.supplierPanel.title')}
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">{t('eudr.supplierPanel.submissions')}</dt>
          <dd className="text-lg font-semibold text-foreground">{compliance.submissions.total}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">{t('eudr.supplierPanel.avgCompleteness')}</dt>
          <dd className="text-lg font-semibold text-foreground">
            {compliance.submissions.avgCompleteness === null
              ? emptyLabel
              : `${Math.round(compliance.submissions.avgCompleteness)}%`}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">{t('eudr.supplierPanel.lastSubmission')}</dt>
          <dd className="text-sm font-medium text-foreground">
            {formatDate(compliance.lastSubmissionAt, emptyLabel)}
          </dd>
        </div>
      </dl>

      {statusCounts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {statusCounts.map(({ status, count }) => (
            <StatusBadge key={status} variant={statusBadgeVariant(status)} dot>
              {t(`eudr.submissionStatus.${status}`)}: {count}
            </StatusBadge>
          ))}
        </div>
      ) : null}

      {compliance.plots ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('eudr.supplierPanel.plots')}</span>
          <span className="font-semibold text-foreground">{compliance.plots.total}</span>
          {compliance.plots.withWarnings > 0 ? (
            <Badge variant="warning">
              {t('eudr.supplierPanel.warnings')}: {compliance.plots.withWarnings}
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/backend/eudr/evidence-submissions" className="text-primary hover:underline">
          {t('eudr.supplierPanel.viewSubmissions')}
        </Link>
        {compliance.plots ? (
          <Link href="/backend/eudr/plots" className="text-primary hover:underline">
            {t('eudr.supplierPanel.viewPlots')}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
