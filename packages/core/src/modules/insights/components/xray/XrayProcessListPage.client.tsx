"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { GitBranch, Settings, Sparkles, TriangleAlert } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  XRAY_API_BASE,
  XRAY_PAGE_BASE,
  XRAY_SETTINGS_PAGE_PATH,
  XRAY_SUGGESTIONS_PAGE_PATH,
  buildQueryString,
  xrayProcessPagePath,
} from '../../lib/client/xray/api'
import { formatCount, formatXrayDateTime } from '../../lib/client/xray/format'
import { useXrayPermissions, useXrayResource } from '../../lib/client/xray/hooks'
import type { XrayProcessItem, XrayProcessesResponse } from '../../lib/client/xray/types'
import { parseWindowParam, serializeWindow, windowQueryParams, type XrayWindowState } from '../../lib/client/xray/window'
import { describeXrayError } from './XrayErrorNotice'
import { XrayWindowSelector } from './XrayWindowSelector'

function processHref(processKey: string, window: XrayWindowState): string {
  return `${xrayProcessPagePath(processKey)}?w=${encodeURIComponent(serializeWindow(window))}`
}

/**
 * The processes the viewer may analyse (their `insights.xray.view` plus each process's own
 * features), with cases in the window (`n`), open cases (withheld below k), low-confidence
 * markers and how far the projection is (`computedThrough`, or catching up).
 */
export function XrayProcessListPageClient() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const permissions = useXrayPermissions()
  const window = React.useMemo(() => parseWindowParam(searchParams?.get('w')), [searchParams])
  const windowParams = windowQueryParams(window)
  const resource = useXrayResource<XrayProcessesResponse>(windowParams ? `${XRAY_API_BASE}/processes${buildQueryString(windowParams)}` : null, { keepPreviousData: true })
  const data = resource.data
  const through = formatXrayDateTime(data?.computedThrough, locale)

  const columns = React.useMemo<ColumnDef<XrayProcessItem>[]>(() => [
    {
      id: 'process',
      header: t('insights.xray.ui.list.columns.process'),
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
          {t(row.original.labelKey)}
        </span>
      ),
    },
    {
      accessorKey: 'n',
      header: t('insights.xray.ui.list.columns.cases'),
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          {formatCount(row.original.n, locale)}
          {row.original.lowConfidence ? (
            <StatusBadge variant="warning">
              <TriangleAlert className="size-3" aria-hidden="true" />
              {t('insights.xray.ui.meta.lowConfidence')}
            </StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: 'openCases',
      header: t('insights.xray.ui.list.columns.openCases'),
      cell: ({ row }) => (row.original.openCases === null
        ? <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.hidden')}</span>
        : formatCount(row.original.openCases, locale)),
    },
    {
      id: 'freshness',
      header: t('insights.xray.ui.list.columns.freshness'),
      cell: ({ row }) => (row.original.incomplete
        ? <StatusBadge variant="warning" dot>{t('insights.xray.ui.list.catchingUp')}</StatusBadge>
        : <span className="text-xs text-muted-foreground">{formatXrayDateTime(row.original.computedThrough, locale) ?? '—'}</span>),
    },
  ], [locale, t])

  return (
    <div className="space-y-6" data-testid="xray-process-list">
      <PageHeader
        title={t('insights.xray.ui.list.title')}
        description={t('insights.xray.ui.list.description')}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href={XRAY_SUGGESTIONS_PAGE_PATH}>
                <Sparkles className="size-4" aria-hidden="true" />
                {t('insights.xray.ui.list.suggestions')}
              </Link>
            </Button>
            {permissions.canManage ? (
              <Button asChild variant="outline">
                <Link href={XRAY_SETTINGS_PAGE_PATH}>
                  <Settings className="size-4" aria-hidden="true" />
                  {t('insights.xray.ui.process.settings')}
                </Link>
              </Button>
            ) : null}
          </>
        )}
      />
      <XrayWindowSelector
        value={window}
        onChange={(next) => router.replace(`${pathname ?? XRAY_PAGE_BASE}?w=${encodeURIComponent(serializeWindow(next))}`, { scroll: false })}
      />
      {data?.incomplete ? (
        <Alert status="warning" size="default" data-testid="xray-list-incomplete">
          <AlertTitle>{t('insights.xray.ui.meta.incompleteTitle')}</AlertTitle>
          <AlertDescription>{t('insights.xray.ui.meta.incompleteDescription')}</AlertDescription>
        </Alert>
      ) : null}
      {data && !data.incomplete && through ? (
        <p className="text-xs text-muted-foreground" data-testid="xray-computed-through">{t('insights.xray.ui.meta.computedThrough', { at: through })}</p>
      ) : null}
      <DataTable<XrayProcessItem>
        title={t('insights.xray.ui.list.tableTitle')}
        columns={columns}
        data={data?.items ?? []}
        isLoading={resource.loading}
        error={resource.error ? describeXrayError(resource.error, t) : null}
        onRowClick={(row) => router.push(processHref(row.processKey, window))}
        rowActions={(row) => (
          <RowActions items={[{ id: 'open', label: t('insights.xray.ui.list.open'), href: processHref(row.processKey, window) }]} />
        )}
        emptyState={(
          <EmptyState
            icon={<GitBranch className="size-6" aria-hidden="true" />}
            title={t('insights.xray.ui.list.emptyTitle')}
            description={permissions.canManage ? t('insights.xray.ui.list.emptyManage') : t('insights.xray.ui.list.emptyDescription')}
          />
        )}
      />
    </div>
  )
}
