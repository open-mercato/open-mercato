"use client"

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { XRAY_API_BASE, buildQueryString, workflowDefinitionPagePath } from '../../lib/client/xray/api'
import { formatCount, formatDecimal, formatPercent, formatWindowSeconds } from '../../lib/client/xray/format'
import type { XraySuggestion, XraySuggestionsResponse } from '../../lib/client/xray/types'
import { describeXrayError } from './XrayErrorNotice'
import { XraySuggestionReviewDialog } from './XraySuggestionReviewDialog'
import { XRAY_SUGGESTION_STATUS_MAP, describeNotDraftableReason, describeSuggestionRule } from './suggestionText'
import { readMutationError, useXrayMutations, useXrayResource, type XrayPermissions } from '../../lib/client/xray/hooks'

export const XRAY_SUGGESTIONS_CONTEXT_ID = 'insights-xray:suggestions'
export const XRAY_SUGGESTIONS_PAGE_SIZE = 20

const STATUS_FILTERS = ['open', 'dismissed', 'drafted', 'superseded', 'all'] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]

export type XraySuggestionsSectionProps = {
  processKey?: string
  permissions: XrayPermissions
}

function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value)
}

/**
 * Automation suggestions mined from repeated manual follow-ups: statistics (support, Wilson
 * confidence, lift, number of people — never who), draftability with its reason and status.
 * Managers dismiss / reopen them (optimistic lock on the version shown) and request a mining
 * pass; reviewing an open, draftable one creates its disabled draft workflow.
 */
export function XraySuggestionsSection({ processKey, permissions }: XraySuggestionsSectionProps) {
  const t = useT()
  const locale = useLocale()
  const [status, setStatus] = React.useState<StatusFilter>('open')
  const [page, setPage] = React.useState(1)
  const [reviewing, setReviewing] = React.useState<XraySuggestion | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [mining, setMining] = React.useState(false)
  const { updateSuggestion, requestMining } = useXrayMutations(XRAY_SUGGESTIONS_CONTEXT_ID)
  const url = `${XRAY_API_BASE}/suggestions${buildQueryString({
    processKey,
    status: status === 'all' ? undefined : status,
    page,
    pageSize: XRAY_SUGGESTIONS_PAGE_SIZE,
  })}`
  const resource = useXrayResource<XraySuggestionsResponse>(url)

  const changeStatus = React.useCallback(async (suggestion: XraySuggestion, next: 'open' | 'dismissed') => {
    setPendingId(suggestion.id)
    try {
      await updateSuggestion(suggestion, { status: next })
      flash(t(next === 'dismissed' ? 'insights.xray.ui.suggestions.dismissed' : 'insights.xray.ui.suggestions.reopened'), 'success')
      resource.reload()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: resource.reload })) {
        const { code } = readMutationError(error)
        flash(code ? describeXrayError({ httpStatus: null, code, hint: null, message: null }, t, 'insights.xray.ui.suggestions.updateFailed') : t('insights.xray.ui.suggestions.updateFailed'), 'error')
      }
    } finally {
      setPendingId(null)
    }
  }, [resource, t, updateSuggestion])

  const handleMine = React.useCallback(async () => {
    setMining(true)
    try {
      await requestMining()
      flash(t('insights.xray.ui.suggestions.miningRequested'), 'success')
    } catch (error) {
      const { code } = readMutationError(error)
      flash(describeXrayError({ httpStatus: null, code, hint: null, message: null }, t, 'insights.xray.ui.suggestions.miningFailed'), 'error')
    } finally {
      setMining(false)
    }
  }, [requestMining, t])

  const columns = React.useMemo<ColumnDef<XraySuggestion>[]>(() => {
    const list: ColumnDef<XraySuggestion>[] = []
    if (!processKey) {
      list.push({ id: 'process', header: t('insights.xray.ui.suggestions.columns.process'), cell: ({ row }) => t(row.original.processLabelKey) })
    }
    list.push(
      {
        id: 'rule',
        header: t('insights.xray.ui.suggestions.columns.rule'),
        cell: ({ row }) => <span>{describeSuggestionRule(row.original, t)}</span>,
        meta: { truncate: true, maxWidth: '420px' },
      },
      {
        id: 'support',
        header: t('insights.xray.ui.suggestions.columns.support'),
        cell: ({ row }) => t('insights.xray.ui.suggestions.supportValue', {
          support: formatCount(row.original.support, locale),
          triggers: formatCount(row.original.triggerCount, locale),
        }),
      },
      { id: 'confidence', header: t('insights.xray.ui.suggestions.columns.confidence'), cell: ({ row }) => formatPercent(row.original.confidence, locale) },
      { id: 'lift', header: t('insights.xray.ui.suggestions.columns.lift'), cell: ({ row }) => formatDecimal(row.original.lift, locale) },
      { id: 'actors', header: t('insights.xray.ui.suggestions.columns.actors'), cell: ({ row }) => formatCount(row.original.distinctActorCount, locale) },
      { id: 'window', header: t('insights.xray.ui.suggestions.columns.window'), cell: ({ row }) => formatWindowSeconds(row.original.windowSeconds, t) },
      {
        id: 'draftable',
        header: t('insights.xray.ui.suggestions.columns.draftable'),
        cell: ({ row }) => (row.original.draftable
          ? t('insights.xray.ui.suggestions.draftableYes')
          : <span className="text-xs text-muted-foreground">{describeNotDraftableReason(row.original.notDraftableReason, t)}</span>),
        meta: { truncate: true, maxWidth: '240px' },
      },
      {
        accessorKey: 'status',
        header: t('insights.xray.ui.suggestions.columns.status'),
        cell: ({ row }) => (
          <StatusBadge variant={XRAY_SUGGESTION_STATUS_MAP[row.original.status] ?? 'neutral'} dot>
            {t(`insights.xray.ui.suggestions.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
    )
    return list
  }, [locale, processKey, t])

  const data = resource.data
  return (
    <section className="space-y-3" aria-label={t('insights.xray.ui.suggestions.title')} data-testid="xray-suggestions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={status}
          onValueChange={(next) => {
            if (!isStatusFilter(next)) return
            setStatus(next)
            setPage(1)
          }}
          size="sm"
          aria-label={t('insights.xray.ui.suggestions.statusFilter')}
        >
          {STATUS_FILTERS.map((value) => (
            <SegmentedControlItem key={value} value={value}>
              {value === 'all' ? t('insights.xray.ui.suggestions.allStatuses') : t(`insights.xray.ui.suggestions.status.${value}`)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {permissions.canManage ? (
          <Button type="button" variant="outline" onClick={() => { void handleMine() }} disabled={mining}>
            <Sparkles className="size-4" aria-hidden="true" />
            {t('insights.xray.ui.suggestions.mineNow')}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t('insights.xray.ui.suggestions.help')}</p>
      <DataTable<XraySuggestion>
        embedded
        columns={columns}
        data={data?.items ?? []}
        isLoading={resource.loading}
        error={resource.error ? describeXrayError(resource.error, t) : null}
        onRowClick={(row) => {
          if (row.status === 'open' && row.draftable) setReviewing(row)
        }}
        rowActions={(row) => {
          const items: RowActionItem[] = []
          if (row.status === 'open' && row.draftable) {
            items.push({ id: 'open', label: t('insights.xray.ui.suggestions.review'), onSelect: () => setReviewing(row) })
          }
          if (permissions.canManage && row.status === 'open') {
            items.push({ id: 'dismiss', label: t('insights.xray.ui.suggestions.dismiss'), onSelect: () => { void changeStatus(row, 'dismissed') } })
          }
          if (permissions.canManage && row.status === 'dismissed') {
            items.push({ id: 'reopen', label: t('insights.xray.ui.suggestions.reopen'), onSelect: () => { void changeStatus(row, 'open') } })
          }
          if (row.status === 'drafted' && row.draftedArtifactId && permissions.canViewWorkflows) {
            items.push({ id: 'open-draft', label: t('insights.xray.ui.suggestions.openDraft'), href: workflowDefinitionPagePath(row.draftedArtifactId) })
          }
          if (items.length === 0 || pendingId === row.id) return null
          return <RowActions items={items} />
        }}
        pagination={data ? {
          page: data.page,
          pageSize: data.pageSize,
          total: data.total,
          totalPages: data.totalPages,
          onPageChange: setPage,
        } : undefined}
        emptyState={(
          <EmptyState
            variant="subtle"
            icon={<Sparkles className="size-5" aria-hidden="true" />}
            title={t('insights.xray.ui.suggestions.emptyTitle')}
            description={t('insights.xray.ui.suggestions.emptyDescription')}
          />
        )}
      />
      <XraySuggestionReviewDialog
        suggestion={reviewing}
        permissions={permissions}
        onClose={() => setReviewing(null)}
        onUpdated={() => resource.reload()}
      />
    </section>
  )
}

