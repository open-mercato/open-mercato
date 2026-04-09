'use client'

import * as React from 'react'
import { History, Filter, Download, Edit3, UserPlus, Plus, RefreshCw, Zap } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { KpiCard } from '@open-mercato/ui/backend/charts/KpiCard'

type ChangelogEntry = {
  id: string
  timestamp: string
  userId: string | null
  userName: string | null
  action: 'edit' | 'create' | 'delete' | 'assign' | 'system'
  fieldName: string | null
  oldValue: string | null
  newValue: string | null
  source: 'ui' | 'api' | 'system'
  description: string | null
}

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
  total: number
}

function computeAfterTimestamp(range: string): string {
  const days = parseInt(range.replace('d', ''), 10) || 90
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function deriveAction(actionLabel: string | null, context: Record<string, unknown> | null): ChangelogEntry['action'] {
  const label = (actionLabel ?? '').toLowerCase()
  if (label.includes('create')) return 'create'
  if (label.includes('delete')) return 'delete'
  if (label.includes('assign')) return 'assign'
  return 'edit'
}

function mapAuditActionToEntry(action: AuditAction): ChangelogEntry {
  const changes = action.changes
  let fieldName: string | null = null
  let oldValue: string | null = null
  let newValue: string | null = null

  if (changes) {
    const firstKey = Object.keys(changes)[0]
    if (firstKey) {
      fieldName = firstKey
      const val = changes[firstKey]
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const changeRecord = val as Record<string, unknown>
        oldValue = changeRecord.old != null ? String(changeRecord.old) : null
        newValue = changeRecord.new != null ? String(changeRecord.new) : null
      }
    }
  }

  const ctx = action.context as Record<string, unknown> | null
  const rawSource = ctx?.source
  const source: ChangelogEntry['source'] =
    rawSource === 'api' ? 'api' : rawSource === 'system' ? 'system' : 'ui'

  return {
    id: action.id,
    timestamp: action.createdAt,
    userId: action.actorUserId,
    userName: action.actorUserName,
    action: deriveAction(action.actionLabel, ctx),
    fieldName,
    oldValue,
    newValue,
    source,
    description: action.actionLabel,
  }
}

interface ChangelogTabProps {
  entityId: string
  entityType: 'company' | 'person'
}

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  edit: Edit3,
  create: Plus,
  assign: UserPlus,
  system: Zap,
  delete: RefreshCw,
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 0 || !words[0]) return '?'
  if (words.length === 1) return words[0].charAt(0).toUpperCase()
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}

function groupByDay(entries: ChangelogEntry[]): Array<{ date: string; label: string; entries: ChangelogEntry[] }> {
  const groups = new Map<string, ChangelogEntry[]>()
  for (const entry of entries) {
    const dateKey = new Date(entry.timestamp).toDateString()
    const list = groups.get(dateKey) ?? []
    list.push(entry)
    groups.set(dateKey, list)
  }

  const now = new Date()
  const today = now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString()

  return Array.from(groups.entries()).map(([dateKey, items]) => ({
    date: dateKey,
    label: dateKey === today ? 'TODAY' : dateKey === yesterday ? 'YESTERDAY' : new Date(dateKey).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(),
    entries: items,
  }))
}

export function ChangelogTab({ entityId, entityType }: ChangelogTabProps) {
  const t = useT()
  const [entries, setEntries] = React.useState<ChangelogEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [totalCount, setTotalCount] = React.useState(0)
  const [dateRange, setDateRange] = React.useState('90d')

  React.useEffect(() => {
    setLoading(true)
    const after = computeAfterTimestamp(dateRange)
    readApiResultOrThrow<AuditActionsResponse>(
      `/api/audit_logs/audit-logs/actions?resourceKind=customers.${entityType}&resourceId=${encodeURIComponent(entityId)}&limit=50&after=${encodeURIComponent(after)}`,
    )
      .then((data) => {
        const mapped = Array.isArray(data?.items) ? data.items.map(mapAuditActionToEntry) : []
        setEntries(mapped)
        setTotalCount(typeof data?.total === 'number' ? data.total : 0)
      })
      .catch(() => {
        setEntries([])
        setTotalCount(0)
      })
      .finally(() => setLoading(false))
  }, [entityId, entityType, dateRange])

  const grouped = React.useMemo(() => groupByDay(entries), [entries])
  const todayCount = React.useMemo(() => {
    const today = new Date().toDateString()
    return entries.filter((e) => new Date(e.timestamp).toDateString() === today).length
  }, [entries])
  const uniqueUsers = React.useMemo(() => new Set(entries.map((e) => e.userId).filter(Boolean)).size, [entries])

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-muted-foreground">
            {t('customers.changelog.filter', 'Filter')}:
          </span>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
            <Filter className="mr-1 size-3" />
            {t('customers.changelog.allFields', 'All fields')}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
            {t('customers.changelog.allUsers', 'All users')}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
            {t('customers.changelog.allActions', 'All actions')}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="7d">{t('customers.changelog.last7days', 'Last 7 days')}</option>
            <option value="30d">{t('customers.changelog.last30days', 'Last 30 days')}</option>
            <option value="90d">{t('customers.changelog.last90days', 'Last 90 days')}</option>
          </select>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
            <Download className="mr-1 size-3" />
            {t('customers.changelog.exportCsv', 'Export CSV')}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title={t('customers.changelog.kpi.totalChanges', 'ALL CHANGES')}
          value={totalCount}
          comparisonLabel={t('customers.changelog.kpi.period', 'last {{days}} days', { days: dateRange.replace('d', '') })}
        />
        <KpiCard
          title={t('customers.changelog.kpi.today', 'TODAY')}
          value={todayCount}
        />
        <KpiCard
          title={t('customers.changelog.kpi.users', 'USERS')}
          value={uniqueUsers}
          comparisonLabel={t('customers.changelog.kpi.active', 'active')}
        />
        <KpiCard
          title={t('customers.changelog.kpi.criticalFields', 'CRITICAL FIELDS')}
          value={null}
          comparisonLabel={t('customers.changelog.kpi.criticalDescription', 'status, stage, role')}
        />
      </div>

      {/* Changelog table */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <History className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">
            {t('customers.changelog.title', 'Change log')}
          </h3>
          <Badge variant="secondary" className="text-[10px]">{totalCount}</Badge>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[80px_140px_80px_1fr_60px] gap-2 border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{t('customers.changelog.col.when', 'When')}</span>
          <span>{t('customers.changelog.col.user', 'User')}</span>
          <span>{t('customers.changelog.col.action', 'Action')}</span>
          <span>{t('customers.changelog.col.change', 'What changed')}</span>
          <span>{t('customers.changelog.col.source', 'Source')}</span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('customers.changelog.loading', 'Loading changes...')}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('customers.changelog.empty', 'No changes recorded in this period.')}
          </div>
        ) : (
          <div className="divide-y">
            {grouped.map((group) => (
              <div key={group.date}>
                <div className="bg-muted/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.entries.map((entry) => {
                  const ActionIcon = ACTION_ICONS[entry.action] ?? Edit3
                  const time = new Date(entry.timestamp)
                  return (
                    <div key={entry.id} className="grid grid-cols-[80px_140px_80px_1fr_60px] gap-2 px-4 py-2.5 text-sm hover:bg-accent/30">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">{time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold">
                          {entry.userName ? getInitials(entry.userName) : '?'}
                        </div>
                        <span className="text-xs truncate">{entry.userName ?? 'System'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <ActionIcon className="size-3 text-muted-foreground" />
                        <span className="capitalize">{entry.action}</span>
                      </div>
                      <div className="text-xs">
                        {entry.fieldName && (
                          <span className="font-medium">{entry.fieldName}</span>
                        )}
                        {entry.oldValue && entry.newValue && (
                          <span className="ml-1.5">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-destructive line-through">
                              {entry.oldValue}
                            </Badge>
                            <span className="mx-1">→</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-600">
                              {entry.newValue}
                            </Badge>
                          </span>
                        )}
                        {entry.description && !entry.fieldName && (
                          <span>{entry.description}</span>
                        )}
                      </div>
                      <div>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                          {entry.source === 'ui' ? 'UI' : entry.source === 'api' ? 'API' : 'System'}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* Pagination footer */}
        {totalCount > entries.length && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
            <span>
              {t('customers.changelog.showing', 'Showing {{shown}} of {{total}} entries', {
                shown: entries.length,
                total: totalCount,
              })}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                {t('customers.changelog.newer', 'Newer')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                {t('customers.changelog.older', 'Older')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
