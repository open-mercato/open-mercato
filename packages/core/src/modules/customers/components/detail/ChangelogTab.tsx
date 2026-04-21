'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, ArrowUpDown, ChevronDown, ChevronUp, Clock3 } from 'lucide-react'
import { extractChangeRows } from '@open-mercato/core/modules/audit_logs/lib/changeRows'
import type { ActionLogProjectionType, ActionLogSourceKey } from '@open-mercato/core/modules/audit_logs/lib/projections'
import { deriveActionLogActionType, deriveActionLogSource } from '@open-mercato/core/modules/audit_logs/lib/projections'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { ChangelogFilters } from './ChangelogFilters'
import { ChangelogKpiCards } from './ChangelogKpiCards'
import { ChangelogEntryRow } from './ChangelogEntryRow'

type AuditAction = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: 'done' | 'undone' | 'failed' | 'redone'
  actorUserId: string | null
  actorUserName: string | null
  resourceKind: string | null
  resourceId: string | null
  snapshotBefore: unknown | null
  snapshotAfter: unknown | null
  changes: Record<string, unknown> | null
  context: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

type AuditActionsResponse = {
  items: AuditAction[]
  total?: number
}

type ChangelogActionType = ActionLogProjectionType
type ChangelogSource = ActionLogSourceKey

type ChangelogEntry = {
  id: string
  createdAt: string
  actorUserId: string | null
  actorUserName: string | null
  actionType: ChangelogActionType
  source: ChangelogSource
  description: string | null
  changes: Array<{
    fieldName: string
    oldValue: string
    newValue: string
  }>
}

type ChangelogTabProps = {
  entityId: string
  entityType: 'company' | 'person' | 'deal'
}

type FilterState = {
  fieldNames: string[]
  actorUserIds: string[]
  actionTypes: string[]
  dateRange: '7d' | '30d' | '90d'
}

type FilterOption = {
  value: string
  label: string
}

type SortField = 'createdAt' | 'user' | 'action' | 'field' | 'source'

type SortState = {
  field: SortField
  dir: 'asc' | 'desc'
}

const PAGE_SIZE = 50
const ACTION_OPTIONS: Array<{ value: ChangelogActionType; key: string; fallback: string }> = [
  { value: 'create', key: 'customers.changelog.actions.create', fallback: 'Create' },
  { value: 'edit', key: 'customers.changelog.actions.edit', fallback: 'Edit' },
  { value: 'delete', key: 'customers.changelog.actions.delete', fallback: 'Delete' },
  { value: 'assign', key: 'customers.changelog.actions.assign', fallback: 'Assign' },
]
const CRITICAL_FIELDS = ['status', 'lifecycleStage', 'ownerUserId', 'temperature', 'source', 'renewalQuarter'] as const
const HEADER_COLUMNS: Array<{ field: SortField; key: string; fallback: string; align?: 'left' | 'right' }> = [
  { field: 'createdAt', key: 'customers.changelog.col.when', fallback: 'When' },
  { field: 'user', key: 'customers.changelog.col.user', fallback: 'User' },
  { field: 'action', key: 'customers.changelog.col.action', fallback: 'Action' },
  { field: 'field', key: 'customers.changelog.col.change', fallback: 'What changed' },
  { field: 'source', key: 'customers.changelog.col.source', fallback: 'Source', align: 'right' },
]

function formatValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((entry) => formatValue(entry)).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/\./g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase())
}

function mergeFilterOptions(...groups: FilterOption[][]): FilterOption[] {
  const options = new Map<string, FilterOption>()
  groups.flat().forEach((option) => {
    options.set(option.value, option)
  })
  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
  )
}

function mapAuditActionToEntry(action: AuditAction): ChangelogEntry {
  const changes = extractChangeRows(action.changes, action.snapshotBefore).map((change) => ({
    fieldName: change.field,
    oldValue: formatValue(change.from),
    newValue: formatValue(change.to),
  }))

  return {
    id: action.id,
    createdAt: action.createdAt,
    actorUserId: action.actorUserId,
    actorUserName: action.actorUserName,
    actionType: deriveActionLogActionType(action),
    source: deriveActionLogSource(action.context, action.actorUserId),
    description: action.actionLabel,
    changes,
  }
}

function startOfDay(daysAgo = 0): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  if (daysAgo > 0) date.setDate(date.getDate() - daysAgo)
  return date
}

function computeRangeStart(range: FilterState['dateRange']): Date {
  const days = Number.parseInt(range.replace('d', ''), 10)
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (Number.isFinite(days) ? days : 90))
  return date
}

function buildQueryUrl({
  entityId,
  entityType,
  dateRange,
  filters,
  limit,
  offset,
  sorting,
  includeTotal,
  before,
  after,
}: {
  entityId: string
  entityType: 'company' | 'person' | 'deal'
  dateRange: FilterState['dateRange']
  filters: Pick<FilterState, 'fieldNames' | 'actorUserIds' | 'actionTypes'>
  limit: number
  offset?: number
  sorting?: SortState
  includeTotal?: boolean
  before?: string
  after?: string
}) {
  const params = new URLSearchParams({
    resourceKind: `customers.${entityType}`,
    resourceId: entityId,
    includeRelated: 'true',
    limit: String(limit),
    offset: String(offset ?? 0),
    sortField: sorting?.field ?? 'createdAt',
    sortDir: sorting?.dir ?? 'desc',
    after: after ?? computeRangeStart(dateRange).toISOString(),
  })
  if (includeTotal) params.set('includeTotal', 'true')
  if (before) params.set('before', before)
  if (filters.fieldNames.length > 0) params.set('fieldName', filters.fieldNames.join(','))
  if (filters.actorUserIds.length > 0) params.set('actorUserId', filters.actorUserIds.join(','))
  if (filters.actionTypes.length > 0) params.set('actionType', filters.actionTypes.join(','))
  return `/api/audit_logs/audit-logs/actions?${params.toString()}`
}

function buildExportUrl({
  entityId,
  entityType,
  filters,
  dateRange,
  sorting,
}: {
  entityId: string
  entityType: 'company' | 'person' | 'deal'
  filters: Pick<FilterState, 'fieldNames' | 'actorUserIds' | 'actionTypes'>
  dateRange: FilterState['dateRange']
  sorting: SortState
}) {
  const params = new URLSearchParams({
    resourceKind: `customers.${entityType}`,
    resourceId: entityId,
    includeRelated: 'true',
    limit: '1000',
    sortField: sorting.field,
    sortDir: sorting.dir,
    after: computeRangeStart(dateRange).toISOString(),
  })
  if (filters.fieldNames.length > 0) params.set('fieldName', filters.fieldNames.join(','))
  if (filters.actorUserIds.length > 0) params.set('actorUserId', filters.actorUserIds.join(','))
  if (filters.actionTypes.length > 0) params.set('actionType', filters.actionTypes.join(','))
  return `/api/audit_logs/audit-logs/actions/export?${params.toString()}`
}

function groupEntriesByDay(entries: ChangelogEntry[], t: ReturnType<typeof useT>) {
  const groups = new Map<string, ChangelogEntry[]>()
  entries.forEach((entry) => {
    const date = new Date(entry.createdAt)
    const key = Number.isNaN(date.getTime()) ? entry.createdAt : date.toDateString()
    const bucket = groups.get(key) ?? []
    bucket.push(entry)
    groups.set(key, bucket)
  })

  const today = new Date().toDateString()
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.toDateString()

  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label:
      key === today
        ? t('customers.changelog.groupLabel.today', 'TODAY')
        : key === yesterday
          ? t('customers.changelog.groupLabel.yesterday', 'YESTERDAY')
          : new Date(key).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).toUpperCase(),
    items,
  }))
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="size-3 text-muted-foreground" />
  return dir === 'asc'
    ? <ChevronUp className="size-3 text-foreground" />
    : <ChevronDown className="size-3 text-foreground" />
}

export function ChangelogTab({ entityId, entityType }: ChangelogTabProps) {
  const t = useT()
  const [filters, setFilters] = React.useState<FilterState>({
    fieldNames: [],
    actorUserIds: [],
    actionTypes: [],
    dateRange: '90d',
  })
  const [entries, setEntries] = React.useState<ChangelogEntry[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [todayCount, setTodayCount] = React.useState(0)
  const [yesterdayCount, setYesterdayCount] = React.useState(0)
  const [fieldOptions, setFieldOptions] = React.useState<FilterOption[]>([])
  const [userOptions, setUserOptions] = React.useState<FilterOption[]>([])
  const [actionOptions, setActionOptions] = React.useState<FilterOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [sorting, setSorting] = React.useState<SortState>({
    field: 'createdAt',
    dir: 'desc',
  })

  const days = React.useMemo(() => Number.parseInt(filters.dateRange.replace('d', ''), 10) || 90, [filters.dateRange])

  const loadTab = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const todayStart = startOfDay(0).toISOString()
      const yesterdayStart = startOfDay(1).toISOString()

      const [mainResponse, todayResponse, yesterdayResponse] = await Promise.all([
        readApiResultOrThrow<AuditActionsResponse>(
          buildQueryUrl({
            entityId,
            entityType,
            dateRange: filters.dateRange,
            filters,
            limit: PAGE_SIZE,
            offset: pageIndex * PAGE_SIZE,
            sorting,
            includeTotal: true,
          }),
        ),
        readApiResultOrThrow<AuditActionsResponse>(
          buildQueryUrl({
            entityId,
            entityType,
            dateRange: filters.dateRange,
            filters,
            limit: 1,
            sorting,
            includeTotal: true,
            after: todayStart,
          }),
        ).catch(() => ({ items: [], total: 0 })),
        readApiResultOrThrow<AuditActionsResponse>(
          buildQueryUrl({
            entityId,
            entityType,
            dateRange: filters.dateRange,
            filters,
            limit: 1,
            sorting,
            includeTotal: true,
            after: yesterdayStart,
            before: todayStart,
          }),
        ).catch(() => ({ items: [], total: 0 })),
      ])

      const mappedEntries = Array.isArray(mainResponse.items) ? mainResponse.items.map(mapAuditActionToEntry) : []

      setEntries(mappedEntries)
      setTotalCount(typeof mainResponse.total === 'number' ? mainResponse.total : mappedEntries.length)
      setTodayCount(typeof todayResponse.total === 'number' ? todayResponse.total : 0)
      setYesterdayCount(typeof yesterdayResponse.total === 'number' ? yesterdayResponse.total : 0)

      const nextFieldOptions = mergeFilterOptions(
        filters.fieldNames.map((fieldName) => ({ value: fieldName, label: formatFieldLabel(fieldName) })),
        Array.from(
          new Set(
          mappedEntries.flatMap((entry) => entry.changes.map((change) => change.fieldName)),
          ),
        )
          .sort((left, right) => left.localeCompare(right))
          .map((fieldName) => ({ value: fieldName, label: formatFieldLabel(fieldName) })),
      )
      const nextActionOptions = ACTION_OPTIONS
        .filter((option) => filters.actionTypes.includes(option.value) || mappedEntries.some((entry) => entry.actionType === option.value))
        .map((option) => ({
          value: option.value,
          label: t(option.key, option.fallback),
        }))

      setFieldOptions(nextFieldOptions)
      setUserOptions((current) =>
        mergeFilterOptions(
          current.filter((option) => filters.actorUserIds.includes(option.value)),
          Array.from(
            new Map(
              mappedEntries
                .filter((entry) => entry.actorUserId && entry.actorUserName)
                .map((entry) => [entry.actorUserId as string, entry.actorUserName as string]),
            ).entries(),
          ).map(([value, label]) => ({ value, label })),
        ),
      )
      setActionOptions(nextActionOptions)
    } catch (loadError) {
      setEntries([])
      setTotalCount(0)
      setTodayCount(0)
      setYesterdayCount(0)
      setFieldOptions([])
      setUserOptions([])
      setActionOptions([])
      setError(t('customers.changelog.error', 'Failed to load change log'))
    } finally {
      setLoading(false)
    }
  }, [entityId, entityType, filters, pageIndex, sorting, t])

  React.useEffect(() => {
    void loadTab()
  }, [loadTab])

  const showGroupedEntries = sorting.field === 'createdAt'
  const groupedEntries = React.useMemo(() => groupEntriesByDay(entries, t), [entries, t])
  const uniqueUsers = React.useMemo(
    () => new Set(entries.map((entry) => entry.actorUserId).filter((value): value is string => Boolean(value))).size,
    [entries],
  )
  const criticalFieldCount = React.useMemo(
    () => entries.filter((entry) => entry.changes.some((change) => CRITICAL_FIELDS.includes(change.fieldName as (typeof CRITICAL_FIELDS)[number]))).length,
    [entries],
  )
  const criticalFieldLabel = React.useMemo(
    () => CRITICAL_FIELDS.map((fieldName) => formatFieldLabel(fieldName)).slice(0, 3).join(', '),
    [],
  )
  const previousPageLabel = React.useMemo(() => {
    if (sorting.field !== 'createdAt') return t('customers.changelog.previous', 'Previous')
    return sorting.dir === 'desc'
      ? t('customers.changelog.newer', 'Newer')
      : t('customers.changelog.older', 'Older')
  }, [sorting, t])
  const nextPageLabel = React.useMemo(() => {
    if (sorting.field !== 'createdAt') return t('customers.changelog.next', 'Next')
    return sorting.dir === 'desc'
      ? t('customers.changelog.older', 'Older')
      : t('customers.changelog.newer', 'Newer')
  }, [sorting, t])
  const shownCount = entries.length
  const hasOlder = (pageIndex + 1) * PAGE_SIZE < totalCount
  const hasNewer = pageIndex > 0

  const updateFilters = React.useCallback((partial: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...partial }))
    setPageIndex(0)
  }, [])

  const handleOlder = React.useCallback(() => {
    if (!hasOlder) return
    setPageIndex((current) => current + 1)
  }, [hasOlder])

  const handleNewer = React.useCallback(() => {
    if (!hasNewer) return
    setPageIndex((current) => Math.max(current - 1, 0))
  }, [hasNewer])

  const handleSort = React.useCallback((field: SortField) => {
    setSorting((current) => {
      if (current.field === field) {
        return {
          field,
          dir: current.dir === 'desc' ? 'asc' : 'desc',
        }
      }

      return {
        field,
        dir: field === 'createdAt' ? 'desc' : 'asc',
      }
    })
    setPageIndex(0)
  }, [])

  const handleExport = React.useCallback(async () => {
    setExporting(true)
    try {
      const response = await apiCallOrThrow<string>(
        buildExportUrl({
          entityId,
          entityType,
          filters,
          dateRange: filters.dateRange,
          sorting,
        }),
        undefined,
        {
          parse: async (res) => res.text(),
        },
      )

      const body = response.result ?? ''
      const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
      const blobUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = 'changelog-export.csv'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (exportError) {
      console.error('customers.changelog.export failed', exportError)
      flash(t('customers.changelog.exportError', 'Failed to export change log'), 'error')
    } finally {
      setExporting(false)
    }
  }, [entityId, entityType, filters, sorting, t])

  return (
    <div className="space-y-5">
      <ChangelogFilters
        dateRange={filters.dateRange}
        fieldNames={filters.fieldNames}
        actorUserIds={filters.actorUserIds}
        actionTypes={filters.actionTypes}
        fieldOptions={fieldOptions}
        userOptions={userOptions}
        actionOptions={actionOptions}
        exportDisabled={exporting}
        onDateRangeChange={(value) => updateFilters({ dateRange: value })}
        onFieldNamesChange={(value) => updateFilters({ fieldNames: value })}
        onActorUserIdsChange={(value) => updateFilters({ actorUserIds: value })}
        onActionTypesChange={(value) => updateFilters({ actionTypes: value })}
        onExport={handleExport}
      />

      <ChangelogKpiCards
        loading={loading}
        totalCount={totalCount}
        todayCount={todayCount}
        yesterdayCount={yesterdayCount}
        uniqueUsers={uniqueUsers}
        criticalFieldCount={criticalFieldCount}
        criticalFieldLabel={criticalFieldLabel}
        dateRangeDays={days}
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <Clock3 className="size-4 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">
            {t('customers.changelog.title', 'Change log')}
          </h3>
          <Badge variant="secondary" className="text-xs">
            {totalCount}
          </Badge>
        </div>

        <div className="grid grid-cols-[92px_190px_120px_1fr_80px] gap-3 border-b bg-muted/20 px-5 py-2 text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {HEADER_COLUMNS.map((column) => {
            const isActive = sorting.field === column.field
            return (
              <Button
                key={column.field}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleSort(column.field)}
                className={`h-auto gap-1 rounded-none px-0 py-0 text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-transparent ${
                  column.align === 'right' ? 'justify-end' : 'justify-start'
                }`}
              >
                <span>{t(column.key, column.fallback)}</span>
                <SortIcon active={isActive} dir={sorting.dir} />
              </Button>
            )
          })}
        </div>

        {loading && entries.length === 0 ? (
          <LoadingMessage label={t('customers.changelog.loading', 'Loading changes...')} className="min-h-[220px] justify-center" />
        ) : error ? (
          <ErrorMessage label={error} className="m-5" />
        ) : entries.length === 0 ? (
          <div className="p-5">
            <TabEmptyState
              title={t('customers.changelog.emptyTitle', 'No changes in this period')}
              description={t('customers.changelog.empty', 'No changes recorded in this period.')}
            />
          </div>
        ) : (
          <div>
            {showGroupedEntries ? (
              groupedEntries.map((group) => (
                <div key={group.key}>
                  <div className="border-b bg-muted/10 px-5 py-2 text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((entry) => (
                    <div key={entry.id} className="border-b last:border-b-0">
                      <ChangelogEntryRow entry={entry} />
                    </div>
                  ))}
                </div>
              ))
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="border-b last:border-b-0">
                  <ChangelogEntryRow entry={entry} />
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {t('customers.changelog.showingWithPeriod', 'Showing {{shown}} of {{total}} entries · last {{days}} days', {
              shown: shownCount,
              total: totalCount,
              days,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNewer}
              disabled={!hasNewer || loading}
              className="h-8 rounded-lg px-3 text-xs"
            >
              <ArrowLeft className="mr-1.5 size-3.5" />
              {previousPageLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOlder}
              disabled={!hasOlder || loading}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {nextPageLabel}
              <ArrowRight className="ml-1.5 size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChangelogTab
