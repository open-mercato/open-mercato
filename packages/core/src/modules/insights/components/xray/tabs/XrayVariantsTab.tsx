"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { xrayAnalyticsUrl, xrayProcessPagePath } from '../../../lib/client/xray/api'
import { formatActivitySequence, formatCount, formatDurationMs, formatPercent } from '../../../lib/client/xray/format'
import { useXrayResource, type XrayPermissions } from '../../../lib/client/xray/hooks'
import type { XrayVariantItem, XrayVariantsResponse } from '../../../lib/client/xray/types'
import { serializeWindow } from '../../../lib/client/xray/window'
import { XrayResultMeta } from '../XrayResultMeta'
import { XrayVariantDraftDialog } from '../XrayVariantDraftDialog'
import { XrayTabResource, type XrayTabProps } from './shared'

export const XRAY_VARIANTS_LIMIT = 20

/** The case drill-down of a variant: its stored (raw) variant hashes, cases completed in the window. */
export function variantCasesHref(processKey: string, variant: Pick<XrayVariantItem, 'rawVariantHashes' | 'rawVariantHashesTruncated'>, windowParam: string): string {
  const params = new URLSearchParams({ variants: variant.rawVariantHashes.join(','), w: windowParam })
  if (variant.rawVariantHashesTruncated) params.set('more', '1')
  return `${xrayProcessPagePath(processKey, 'cases')}?${params.toString()}`
}

export function XrayVariantsTab({ processKey, window, filters, onClearActorFilters, permissions }: XrayTabProps & { permissions: XrayPermissions }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [draftVariant, setDraftVariant] = React.useState<XrayVariantItem | null>(null)
  const resource = useXrayResource<XrayVariantsResponse>(xrayAnalyticsUrl(processKey, 'variants', window, filters, { limit: XRAY_VARIANTS_LIMIT }))
  const windowParam = serializeWindow(window)

  const activityLabels = resource.data?.activityLabels
  const columns = React.useMemo<ColumnDef<XrayVariantItem>[]>(() => [
    {
      id: 'path',
      header: t('insights.xray.ui.variants.columns.path'),
      cell: ({ row }) => {
        const path = formatActivitySequence(row.original.activityKeys, t, activityLabels)
        return <span title={path}>{path}</span>
      },
      meta: { truncate: true, maxWidth: '480px' },
    },
    {
      accessorKey: 'cases',
      header: t('insights.xray.ui.variants.columns.cases'),
      cell: ({ row }) => formatCount(row.original.cases, locale),
    },
    {
      accessorKey: 'share',
      header: t('insights.xray.ui.variants.columns.share'),
      cell: ({ row }) => (
        <div className="flex min-w-24 items-center gap-2">
          <Progress value={Math.round(row.original.share * 100)} size="sm" aria-label={t('insights.xray.ui.variants.columns.share')} className="w-16" />
          <span className="text-xs">{formatPercent(row.original.share, locale)}</span>
        </div>
      ),
    },
    {
      id: 'cycleTime',
      header: t('insights.xray.ui.variants.columns.cycleTime'),
      cell: ({ row }) => {
        const stats = row.original.cycleTime
        const median = formatDurationMs(stats.medianMs, t)
        if (!median) return <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.tooFew', { n: formatCount(stats.n, locale), minimum: 5 })}</span>
        return (
          <span>
            {median}
            {stats.lowConfidence ? <span className="ml-1 text-xs text-muted-foreground">{t('insights.xray.ui.stats.lowConfidenceShort')}</span> : null}
          </span>
        )
      },
    },
  ], [activityLabels, locale, t])

  return (
    <XrayTabResource resource={resource} onClearActorFilters={onClearActorFilters}>
      {(data) => (
        <>
          <XrayResultMeta meta={data} nLabelKey="insights.xray.ui.meta.completedCases" />
          <p className="text-xs text-muted-foreground">
            {t('insights.xray.ui.variants.distinct', {
              collapsed: formatCount(data.distinctVariants.collapsed, locale),
              raw: formatCount(data.distinctVariants.raw, locale),
            })}
          </p>
          <DataTable<XrayVariantItem>
            embedded
            columns={columns}
            data={data.items}
            onRowClick={(row) => router.push(variantCasesHref(processKey, row, windowParam))}
            rowActions={(row) => (
              <RowActions
                items={[
                  { id: 'open', label: t('insights.xray.ui.variants.viewCases'), href: variantCasesHref(processKey, row, windowParam) },
                  ...(permissions.canCreateWorkflows
                    ? [{ id: 'workflow-draft', label: t('insights.xray.ui.variants.createDraft'), onSelect: () => setDraftVariant(row) }]
                    : []),
                ]}
              />
            )}
            emptyState={(
              <EmptyState
                variant="subtle"
                title={t('insights.xray.ui.variants.emptyTitle')}
                description={data.suppressed.cells > 0 ? t('insights.xray.ui.variants.emptySuppressed') : t('insights.xray.ui.variants.emptyDescription')}
              />
            )}
          />
          {data.omitted.variants > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('insights.xray.ui.variants.omitted', { variants: formatCount(data.omitted.variants, locale), cases: formatCount(data.omitted.cases, locale) })}
            </p>
          ) : null}
          <XrayVariantDraftDialog
            processKey={processKey}
            variant={draftVariant}
            activityLabels={data.activityLabels}
            window={window}
            permissions={permissions}
            onClose={() => setDraftVariant(null)}
          />
        </>
      )}
    </XrayTabResource>
  )
}
