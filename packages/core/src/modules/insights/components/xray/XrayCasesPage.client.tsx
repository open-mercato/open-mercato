"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  XRAY_API_BASE,
  XRAY_PAGE_BASE,
  buildQueryString,
  xrayAnalyticsUrl,
  xrayProcessPagePath,
} from '../../lib/client/xray/api'
import { formatActivityKey, shortId } from '../../lib/client/xray/format'
import { useXrayResource } from '../../lib/client/xray/hooks'
import { useXrayLabels } from '../../lib/client/xray/labels'
import type { XrayCaseItem, XrayCasesResponse, XrayProcessesResponse } from '../../lib/client/xray/types'
import { parseWindowParam, serializeWindow, windowQueryParams, type XrayWindowState } from '../../lib/client/xray/window'
import { XrayErrorNotice, describeXrayError } from './XrayErrorNotice'
import { XrayResultMeta } from './XrayResultMeta'
import { XrayWindowSelector } from './XrayWindowSelector'

export const XRAY_CASES_PAGE_SIZE = 50

const CASE_STATUSES = ['all', 'open', 'completed', 'deleted'] as const
type CaseStatusFilter = (typeof CASE_STATUSES)[number]

const VARIANT_HASH_PATTERN = /^[0-9a-f]{64}$/
const ACTIVITY_KEY_MAX = 200
const VARIANT_HASHES_MAX = 20

type CasesUrlState = {
  window: XrayWindowState
  status: CaseStatusFilter
  activityKey: string | null
  variantHashes: string[]
  variantHash: string | null
  moreVariants: boolean
}

function readCasesUrlState(params: { get: (name: string) => string | null } | null): CasesUrlState {
  const status = params?.get('status') ?? 'all'
  const activity = params?.get('activity')?.trim() ?? ''
  const variantHashes = (params?.get('variants') ?? '')
    .split(',')
    .map((hash) => hash.trim())
    .filter((hash) => VARIANT_HASH_PATTERN.test(hash))
    .slice(0, VARIANT_HASHES_MAX)
  const selected = params?.get('variant') ?? ''
  return {
    window: parseWindowParam(params?.get('w')),
    status: (CASE_STATUSES as readonly string[]).includes(status) ? status as CaseStatusFilter : 'all',
    activityKey: activity.length > 0 && activity.length <= ACTIVITY_KEY_MAX ? activity : null,
    variantHashes,
    variantHash: variantHashes.includes(selected) ? selected : variantHashes[0] ?? null,
    moreVariants: variantHashes.length > 0 && params?.get('more') === '1',
  }
}

function writeCasesUrlState(state: CasesUrlState): string {
  const params = new URLSearchParams()
  params.set('w', serializeWindow(state.window))
  if (state.status !== 'all') params.set('status', state.status)
  if (state.activityKey) params.set('activity', state.activityKey)
  if (state.variantHashes.length > 0) {
    params.set('variants', state.variantHashes.join(','))
    if (state.variantHash) params.set('variant', state.variantHash)
    if (state.moreVariants) params.set('more', '1')
  }
  return params.toString()
}

/**
 * Case ids of the analytics population (identifiers only; the records are opened through their
 * own module, which applies its own access rules), with drill-downs by status, activity and
 * stored variant, newest activity first, keyset-paginated (page size ≤ 100).
 */
export function XrayCasesPageClient({ processKey }: { processKey: string }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const state = React.useMemo(() => readCasesUrlState(searchParams), [searchParams])
  const stateKey = writeCasesUrlState(state)
  const [pager, setPager] = React.useState<{ key: string; cursors: Array<string | null> }>({ key: stateKey, cursors: [null] })
  const cursors = pager.key === stateKey ? pager.cursors : [null]
  const setCursors = React.useCallback((next: (current: Array<string | null>) => Array<string | null>) => {
    setPager((current) => ({ key: stateKey, cursors: next(current.key === stateKey ? current.cursors : [null]) }))
  }, [stateKey])

  const update = React.useCallback((patch: Partial<CasesUrlState>) => {
    router.replace(`${pathname ?? xrayProcessPagePath(processKey, 'cases')}?${writeCasesUrlState({ ...state, ...patch })}`, { scroll: false })
  }, [pathname, processKey, router, state])

  const windowParams = windowQueryParams(state.window)
  const processes = useXrayResource<XrayProcessesResponse>(windowParams ? `${XRAY_API_BASE}/processes${buildQueryString(windowParams)}` : null, { keepPreviousData: true })
  const summary = processes.data?.items.find((item) => item.processKey === processKey) ?? null
  const cursor = cursors[cursors.length - 1] ?? null
  const cases = useXrayResource<XrayCasesResponse>(summary ? xrayAnalyticsUrl(processKey, 'cases', state.window, null, {
    pageSize: XRAY_CASES_PAGE_SIZE,
    cursor,
    status: state.status === 'all' ? undefined : state.status,
    activityKey: state.activityKey,
    variantHash: state.variantHash,
  }) : null)
  const organizationIds = React.useMemo(() => (cases.data?.items ?? []).map((item) => item.organizationId), [cases.data])
  const organizationLabels = useXrayLabels('org', organizationIds)

  const columns = React.useMemo<ColumnDef<XrayCaseItem>[]>(() => [
    {
      accessorKey: 'caseId',
      header: t('insights.xray.ui.cases.columns.caseId'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.caseId}</span>,
    },
    {
      accessorKey: 'organizationId',
      header: t('insights.xray.ui.cases.columns.organization'),
      cell: ({ row }) => organizationLabels.get(row.original.organizationId.toLowerCase()) ?? shortId(row.original.organizationId),
    },
  ], [organizationLabels, t])

  if (processes.loading && !processes.data) return <LoadingMessage label={t('insights.xray.ui.loading')} />
  if (processes.error) return <XrayErrorNotice error={processes.error} onRetry={processes.reload} />
  if (processes.data && !summary) {
    return (
      <RecordNotFoundState
        label={t('insights.xray.errors.process_not_found')}
        description={t('insights.xray.ui.process.notFoundDescription')}
        backHref={XRAY_PAGE_BASE}
        backLabel={t('insights.xray.ui.process.backToList')}
      />
    )
  }

  const processHref = `${xrayProcessPagePath(processKey)}?w=${encodeURIComponent(serializeWindow(state.window))}`
  return (
    <div className="space-y-6" data-testid="xray-cases-page">
      <PageHeader
        title={t('insights.xray.ui.cases.title', { process: summary ? t(summary.labelKey) : processKey })}
        description={t('insights.xray.ui.cases.description')}
        actions={(
          <Button asChild variant="outline">
            <Link href={processHref}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('insights.xray.ui.cases.backToProcess')}
            </Link>
          </Button>
        )}
      />
      <div className="flex flex-wrap items-center gap-3">
        <XrayWindowSelector value={state.window} onChange={(window) => update({ window })} />
        <SegmentedControl
          value={state.status}
          onValueChange={(next) => { if ((CASE_STATUSES as readonly string[]).includes(next)) update({ status: next as CaseStatusFilter }) }}
          size="sm"
          aria-label={t('insights.xray.ui.cases.statusLabel')}
        >
          {CASE_STATUSES.map((status) => (
            <SegmentedControlItem key={status} value={status}>{t(`insights.xray.ui.cases.status.${status}`)}</SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      {state.activityKey || state.variantHashes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="xray-cases-drilldown">
          {state.activityKey ? (
            <Button type="button" size="sm" variant="outline" onClick={() => update({ activityKey: null })} aria-label={t('insights.xray.ui.cases.clearActivity')}>
              {t('insights.xray.ui.cases.activityFilter', { activity: formatActivityKey(state.activityKey, t) })}
              <X className="size-3" aria-hidden="true" />
            </Button>
          ) : null}
          {state.variantHashes.length > 1 ? (
            <Select value={state.variantHash ?? undefined} onValueChange={(next) => update({ variantHash: next })}>
              <SelectTrigger size="sm" className="w-auto" aria-label={t('insights.xray.ui.cases.recordedPath')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.variantHashes.map((hash, index) => (
                  <SelectItem key={hash} value={hash}>{t('insights.xray.ui.cases.recordedPathOption', { index: index + 1, total: state.variantHashes.length })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {state.variantHashes.length > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => update({ variantHashes: [], variantHash: null, moreVariants: false })} aria-label={t('insights.xray.ui.cases.clearVariant')}>
              {t('insights.xray.ui.cases.variantFilter')}
              <X className="size-3" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.variantHashes.length > 1 ? <p className="text-xs text-muted-foreground">{t('insights.xray.ui.cases.recordedPathHelp')}</p> : null}
      {state.moreVariants ? <p className="text-xs text-muted-foreground" data-testid="xray-cases-more-paths">{t('insights.xray.ui.cases.morePaths', { count: state.variantHashes.length })}</p> : null}
      {cases.data ? <XrayResultMeta meta={cases.data} /> : null}
      <DataTable<XrayCaseItem>
        embedded
        columns={columns}
        data={cases.data?.items ?? []}
        isLoading={cases.loading}
        error={cases.error ? describeXrayError(cases.error, t) : null}
        emptyState={<EmptyState variant="subtle" title={t('insights.xray.ui.cases.emptyTitle')} description={t('insights.xray.ui.cases.emptyDescription')} />}
      />
      <nav className="flex items-center justify-end gap-2" aria-label={t('insights.xray.ui.cases.pagination')}>
        <Button
          type="button"
          variant="outline"
          disabled={cursors.length <= 1 || cases.loading}
          onClick={() => setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current))}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t('insights.xray.ui.cases.previous')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!cases.data?.nextCursor || cases.loading}
          onClick={() => {
            const next = cases.data?.nextCursor
            if (next) setCursors((current) => [...current, next])
          }}
        >
          {t('insights.xray.ui.cases.next')}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  )
}
