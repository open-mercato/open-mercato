"use client"

import * as React from 'react'
import {
  Phone,
  Mail,
  Users,
  StickyNote,
  Clock,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Calendar,
  Video,
  ExternalLink,
  ChevronRight,
  EyeOff,
  Heart,
} from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { KpiCard, type KpiTrend } from '@open-mercato/ui/backend/charts/KpiCard'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { InlineActivityComposer } from './InlineActivityComposer'
import type { CompanyOverview, DealSummary, InteractionSummary, TodoLinkSummary } from '../formConfig'

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type CompanyDashboardTabProps = {
  data: CompanyOverview
  companyId: string
  onTabChange: (tab: string) => void
  onActivityCreated?: () => void
  onScheduleRequested?: () => void
  runGuardedMutation?: GuardedMutationRunner
  useCanonicalInteractions?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumActiveDeals(deals: DealSummary[]): number {
  return deals
    .filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
    .reduce((sum, d) => {
      const amount = typeof d.valueAmount === 'number' ? d.valueAmount : parseFloat(String(d.valueAmount ?? '0'))
      return sum + (Number.isFinite(amount) ? amount : 0)
    }, 0)
}

function getActiveDeals(deals: DealSummary[]): DealSummary[] {
  return deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
}

function getOpenTasks(todos: TodoLinkSummary[]): TodoLinkSummary[] {
  return todos.filter((t) => !t.isDone).sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return 0
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  })
}

function getUpcomingMeetings(interactions: InteractionSummary[]): InteractionSummary[] {
  const now = new Date()
  return interactions
    .filter((i) => i.scheduledAt && new Date(i.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 3)
}

function getRecentActivity(interactions: InteractionSummary[]): InteractionSummary[] {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  return interactions
    .filter((i) => {
      const date = i.occurredAt ?? i.scheduledAt
      return date && new Date(date) >= weekAgo
    })
    .sort((a, b) => {
      const da = a.occurredAt ?? a.scheduledAt ?? ''
      const db = b.occurredAt ?? b.scheduledAt ?? ''
      return new Date(db).getTime() - new Date(da).getTime()
    })
    .slice(0, 4)
}

function isOverdue(dueAt: string | null | undefined): boolean {
  if (!dueAt) return false
  return new Date(dueAt) < new Date()
}

function priorityLabel(priority: number | null | undefined): { label: string; variant: 'destructive' | 'default' | 'secondary' | 'muted' } {
  if (priority === null || priority === undefined) return { label: 'None', variant: 'muted' }
  if (priority >= 3) return { label: 'High', variant: 'destructive' }
  if (priority === 2) return { label: 'Medium', variant: 'default' }
  return { label: 'Low', variant: 'secondary' }
}

function interactionIcon(type: string) {
  switch (type) {
    case 'call': return <Phone className="size-4" />
    case 'email': return <Mail className="size-4" />
    case 'meeting': return <Users className="size-4" />
    case 'note': return <StickyNote className="size-4" />
    default: return <Clock className="size-4" />
  }
}

function computeActivityTrend(interactions: InteractionSummary[]): KpiTrend | undefined {
  const now = Date.now()
  const weekMs = 7 * 86_400_000
  const thisWeek = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    return d && now - new Date(d).getTime() < weekMs
  }).length
  const lastWeek = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    if (!d) return false
    const diff = now - new Date(d).getTime()
    return diff >= weekMs && diff < weekMs * 2
  }).length
  if (lastWeek === 0 && thisWeek === 0) return undefined
  if (lastWeek === 0) return { value: 100, direction: 'up' }
  const pct = ((thisWeek - lastWeek) / lastWeek) * 100
  if (Math.abs(pct) < 0.5) return { value: 0, direction: 'unchanged' }
  return { value: Math.abs(pct), direction: pct > 0 ? 'up' : 'down' }
}

function computeDealTrend(deals: DealSummary[]): KpiTrend | undefined {
  const active = deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
  if (active.length === 0) return undefined
  const now = Date.now()
  const monthMs = 30 * 86_400_000
  const recentDeals = active.filter((d) => d.createdAt && now - new Date(d.createdAt).getTime() < monthMs).length
  if (recentDeals > 0) return { value: recentDeals * 10, direction: 'up' }
  return { value: 0, direction: 'unchanged' }
}

type HealthScore = {
  score: number
  label: string
  variant: 'emerald' | 'amber' | 'red'
  lastContactDays: number | null
}

function computeHealthScore(interactions: InteractionSummary[]): HealthScore {
  const now = Date.now()
  const dayMs = 86_400_000

  // Recency (40%): days since last interaction
  const dates = interactions
    .map((i) => i.occurredAt ?? i.scheduledAt)
    .filter(Boolean)
    .map((d) => new Date(d!).getTime())
  const lastContactMs = dates.length > 0 ? Math.max(...dates) : 0
  const daysSinceContact = lastContactMs > 0 ? Math.floor((now - lastContactMs) / dayMs) : 999

  let recencyScore: number
  if (daysSinceContact <= 7) recencyScore = 100
  else if (daysSinceContact <= 30) recencyScore = 75
  else if (daysSinceContact <= 60) recencyScore = 50
  else if (daysSinceContact <= 90) recencyScore = 25
  else recencyScore = 0

  // Frequency (30%): interactions in last 30 days
  const last30 = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    return d && now - new Date(d).getTime() < 30 * dayMs
  }).length

  let frequencyScore: number
  if (last30 >= 5) frequencyScore = 100
  else if (last30 >= 3) frequencyScore = 75
  else if (last30 >= 1) frequencyScore = 50
  else frequencyScore = 0

  // Diversity (15%): unique interaction types used
  const types = new Set(interactions.map((i) => i.interactionType))
  let diversityScore: number
  if (types.size >= 4) diversityScore = 100
  else if (types.size >= 3) diversityScore = 75
  else if (types.size >= 2) diversityScore = 50
  else if (types.size >= 1) diversityScore = 25
  else diversityScore = 0

  // Consistency (15%): interactions spread across weeks
  const weekBuckets = new Set(
    interactions
      .map((i) => i.occurredAt ?? i.scheduledAt)
      .filter(Boolean)
      .map((d) => Math.floor(new Date(d!).getTime() / (7 * dayMs))),
  )
  let consistencyScore: number
  if (weekBuckets.size >= 8) consistencyScore = 100
  else if (weekBuckets.size >= 4) consistencyScore = 75
  else if (weekBuckets.size >= 2) consistencyScore = 50
  else consistencyScore = 25

  const score = Math.round(
    recencyScore * 0.4 + frequencyScore * 0.3 + diversityScore * 0.15 + consistencyScore * 0.15,
  )

  let label: string
  let variant: 'emerald' | 'amber' | 'red'
  if (score >= 70) { label = 'healthy'; variant = 'emerald' }
  else if (score >= 40) { label = 'watchful'; variant = 'amber' }
  else { label = 'at risk'; variant = 'red' }

  return { score, label, variant, lastContactDays: daysSinceContact < 999 ? daysSinceContact : null }
}

function formatCurrency(amount: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'PLN',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency || 'PLN'}`
  }
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

function UpcomingMeetingsWidget({ meetings, t }: { meetings: InteractionSummary[]; t: TranslateFn }) {
  if (meetings.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calendar className="size-4" />
          {t('customers.companies.dashboard.upcomingMeetings', 'Nadchodzące spotkania')}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noMeetings', 'No upcoming meetings')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calendar className="size-4" />
          {t('customers.companies.dashboard.upcomingMeetings', 'Nadchodzące spotkania')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {meetings.length}
          </span>
        </h3>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">
          {t('customers.companies.dashboard.seeAll', 'Zobacz wszystkie')}
          <ChevronRight className="ml-0.5 size-3" />
        </Button>
      </div>
      <div className="mt-3 divide-y">
        {meetings.map((meeting) => {
          const date = meeting.scheduledAt ? new Date(meeting.scheduledAt) : null
          return (
            <div key={meeting.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm font-medium text-foreground">{meeting.title || meeting.interactionType}</p>
                {meeting.authorName && (
                  <p className="text-xs text-muted-foreground">{meeting.authorName}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                  {t('customers.companies.dashboard.details', 'Detale')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RelationshipHealthWidget({ health, t }: { health: HealthScore; t: (key: string, fallback?: string, params?: Record<string, string | number>) => string }) {
  const colorClasses = {
    emerald: 'text-emerald-500',
    amber: 'text-amber-500',
    red: 'text-red-500',
  }
  const bgClasses = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  }
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Heart className={cn('size-4', colorClasses[health.variant])} />
        {t('customers.companies.dashboard.relationshipHealth', 'Relationship health')}
      </h3>
      <div className="mt-4 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="relative inline-flex items-center justify-center">
            <span className={cn('text-4xl font-bold', colorClasses[health.variant])}>{health.score}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div>
            <Badge className={cn('text-xs', bgClasses[health.variant])}>
              {t(`customers.health.${health.label}`, health.label)}
            </Badge>
          </div>
          {health.lastContactDays !== null && (
            <p className="text-[10px] text-muted-foreground">
              {t('customers.health.lastContact', 'Last contact')}: {health.lastContactDays === 0
                ? t('customers.health.today', 'today')
                : t('customers.health.daysAgo', '{{days}} days ago', { days: health.lastContactDays })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function ActiveDealWidget({ deals, t }: { deals: DealSummary[]; t: TranslateFn }) {
  const topDeal = deals.sort((a, b) => {
    const va = typeof a.valueAmount === 'number' ? a.valueAmount : parseFloat(String(a.valueAmount ?? '0'))
    const vb = typeof b.valueAmount === 'number' ? b.valueAmount : parseFloat(String(b.valueAmount ?? '0'))
    return vb - va
  })[0]

  if (!topDeal) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="size-4" />
          {t('customers.companies.dashboard.activeDeal', 'Aktywny deal')}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noDeals', 'No active deals')}</p>
      </div>
    )
  }

  const amount = typeof topDeal.valueAmount === 'number' ? topDeal.valueAmount : parseFloat(String(topDeal.valueAmount ?? '0'))

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="size-4" />
          {t('customers.companies.dashboard.activeDeal', 'Aktywny deal')}
        </h3>
        <ArrowUpRight className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-3">
        <p className="font-semibold text-foreground">{topDeal.title}</p>
        {topDeal.createdAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('customers.companies.dashboard.created', 'Created')} {new Date(topDeal.createdAt).toLocaleDateString()}
          </p>
        )}
        {topDeal.pipelineStage && (
          <div className="mt-2">
            <Badge variant="outline" className="text-xs">{topDeal.pipelineStage}</Badge>
          </div>
        )}
        {Number.isFinite(amount) && amount > 0 && (
          <p className="mt-2 text-lg font-bold text-foreground">
            {formatCurrency(amount, topDeal.valueCurrency)}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {t('customers.companies.dashboard.potentialValue', 'potencjalna wartość')}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

function OpenTasksWidget({
  tasks,
  currentUserId,
  t,
  onViewAll,
}: {
  tasks: TodoLinkSummary[]
  currentUserId?: string | null
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string
  onViewAll: () => void
}) {
  const [taskFilter, setTaskFilter] = React.useState<'all' | 'mine' | 'overdue'>('all')
  const overdueTasks = tasks.filter((task) => isOverdue(task.dueAt))
  const mineTasks = currentUserId
    ? tasks.filter((task) => {
        const assignee = (task as Record<string, unknown>).assignedToUserId ?? (task as Record<string, unknown>).createdByUserId
        return assignee === currentUserId
      })
    : tasks

  const filteredTasks = taskFilter === 'overdue'
    ? overdueTasks
    : taskFilter === 'mine'
      ? mineTasks
      : tasks

  const filterTabs: Array<{ key: 'all' | 'mine' | 'overdue'; label: string; count: number }> = [
    { key: 'all', label: t('customers.tasks.filters.all', 'All'), count: tasks.length },
    { key: 'mine', label: t('customers.tasks.filters.mine', 'Mine'), count: mineTasks.length },
    { key: 'overdue', label: t('customers.tasks.filters.overdue', 'Overdue'), count: overdueTasks.length },
  ]

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="size-4" />
          {t('customers.companies.dashboard.openTasks', 'Otwarte zadania')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </h3>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onViewAll}>
          + {t('customers.companies.dashboard.newTask', 'Nowe zadanie')}
        </Button>
      </div>
      {/* Filter tabs */}
      <div className="mt-2 flex items-center gap-1">
        {filterTabs.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant={taskFilter === tab.key ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setTaskFilter(tab.key)}
          >
            {tab.label}
            <span className="ml-1 rounded-full bg-muted/50 px-1 text-[9px]">{tab.count}</span>
          </Button>
        ))}
      </div>
      <div className="mt-3 divide-y">
        {filteredTasks.slice(0, 4).map((task) => {
          const overdue = isOverdue(task.dueAt)
          const prio = priorityLabel(task.priority)
          return (
            <div key={task.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{task.title || '—'}</p>
                {task.dueAt && (
                  <p className={cn('mt-0.5 text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
                    {overdue && <AlertCircle className="mr-1 inline size-3" />}
                    {overdue
                      ? t('customers.companies.dashboard.overdueBy', 'Zaległe od {{days}} dni', { days: Math.ceil((Date.now() - new Date(task.dueAt).getTime()) / 86_400_000) })
                      : t('customers.companies.dashboard.dueOn', 'Termin: {{date}}', { date: new Date(task.dueAt).toLocaleDateString() })
                    }
                  </p>
                )}
              </div>
              <Badge variant={prio.variant} className="shrink-0 text-[10px]">{prio.label}</Badge>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            </div>
          )
        })}
        {filteredTasks.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noTasks', 'No open tasks')}</p>
        )}
      </div>
    </div>
  )
}

function RecentActivityWidget({ interactions, t }: { interactions: InteractionSummary[]; t: TranslateFn }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock className="size-4" />
          {t('customers.companies.dashboard.recentActivity', 'Ostatnia aktywność')}
          <span className="text-xs font-normal text-muted-foreground">
            {t('customers.companies.dashboard.last7days', 'ostatnie 7 dni')}
          </span>
        </h3>
      </div>
      <div className="mt-3 divide-y">
        {interactions.map((interaction) => {
          const date = interaction.occurredAt ?? interaction.scheduledAt
          return (
            <div key={interaction.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {interactionIcon(interaction.interactionType)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{interaction.title || interaction.interactionType}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {interaction.authorName && <span>{interaction.authorName}</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">
                  {date ? formatRelativeTime(date) : '—'}
                </p>
                <ArrowUpRight className="ml-auto mt-1 size-3.5 text-muted-foreground" />
              </div>
            </div>
          )
        })}
        {interactions.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noActivity', 'No recent activity')}</p>
        )}
      </div>
      {interactions.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">
            {t('customers.companies.dashboard.seeAllActivity', 'Zobacz wszystkie {{count}} aktywności', { count: String(interactions.length) })}
            <ChevronRight className="ml-0.5 size-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CompanyDashboardTab({ data, companyId, onTabChange, onActivityCreated, onScheduleRequested, runGuardedMutation, useCanonicalInteractions }: CompanyDashboardTabProps) {
  const t = useT()

  const activeDeals = React.useMemo(() => getActiveDeals(data.deals), [data.deals])
  const activeDealsValue = React.useMemo(() => sumActiveDeals(data.deals), [data.deals])
  const openTasks = React.useMemo(() => getOpenTasks(data.todos), [data.todos])
  const upcomingMeetings = React.useMemo(() => getUpcomingMeetings(data.interactions), [data.interactions])
  const recentActivity = React.useMemo(() => getRecentActivity(data.interactions), [data.interactions])

  const dealCurrency = activeDeals[0]?.valueCurrency ?? data.deals[0]?.valueCurrency ?? 'PLN'
  const activityTrend = React.useMemo(() => computeActivityTrend(data.interactions), [data.interactions])
  const dealTrend = React.useMemo(() => computeDealTrend(data.deals), [data.deals])
  const healthScore = React.useMemo(() => computeHealthScore(data.interactions), [data.interactions])

  const ltvValue = React.useMemo(() => {
    const wonDeals = data.deals.filter((d) => d.status === 'won')
    if (wonDeals.length === 0) return null
    return wonDeals.reduce((sum, d) => {
      const amt = typeof d.valueAmount === 'number' ? d.valueAmount : parseFloat(String(d.valueAmount ?? '0'))
      return sum + (Number.isFinite(amt) ? amt : 0)
    }, 0)
  }, [data.deals])

  const clientTenureYears = React.useMemo(() => {
    const allDates = data.interactions
      .map((i) => i.occurredAt ?? i.scheduledAt ?? i.createdAt)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
    if (allDates.length === 0) return null
    const earliest = Math.min(...allDates)
    return Math.floor((Date.now() - earliest) / (365.25 * 86_400_000))
  }, [data.interactions])

  // KPI tile visibility (persisted to localStorage)
  const [hiddenTiles, setHiddenTiles] = React.useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('om:dashboard-hidden-tiles')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

  const toggleTile = React.useCallback((tileId: string) => {
    setHiddenTiles((prev) => {
      const next = new Set(prev)
      if (next.has(tileId)) next.delete(tileId)
      else next.add(tileId)
      try { localStorage.setItem('om:dashboard-hidden-tiles', JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])

  const kpiTiles: Array<{ id: string; title: string; value: number | null; trend?: KpiTrend; formatValue?: (v: number) => string; comparisonLabel: string }> = [
    { id: 'activeDeals', title: t('customers.companies.dashboard.kpi.activeDeals', 'AKTYWNE DEALE'), value: activeDealsValue, trend: dealTrend, formatValue: (v: number) => formatCurrency(v, dealCurrency), comparisonLabel: `${activeDeals.length} ${activeDeals.length === 1 ? 'pipeline' : 'pipelines'}` },
    { id: 'activities', title: t('customers.companies.dashboard.kpi.activities', 'AKTYWNOŚCI'), value: data.interactions.length, trend: activityTrend, comparisonLabel: t('customers.companies.dashboard.kpi.last12months', 'ostatnie 12 miesięcy') },
    { id: 'ltv', title: t('customers.companies.dashboard.kpi.ltv', 'WARTOŚĆ KLIENTA (LTV)'), value: ltvValue, formatValue: ltvValue !== null ? (v: number) => formatCurrency(v, dealCurrency) : undefined, comparisonLabel: ltvValue !== null ? t('customers.companies.dashboard.kpi.wonDeals', 'won deals total') : t('customers.companies.dashboard.kpi.noWonDeals', 'No won deals') },
    { id: 'clientSince', title: t('customers.companies.dashboard.kpi.clientSince', 'KLIENT OD'), value: clientTenureYears, formatValue: clientTenureYears !== null ? (v: number) => v < 1 ? `< 1 ${t('customers.companies.dashboard.kpi.year', 'year')}` : `${v} ${v === 1 ? t('customers.companies.dashboard.kpi.year', 'year') : t('customers.companies.dashboard.kpi.years', 'years')}` : undefined, comparisonLabel: clientTenureYears !== null ? `${data.deals.filter(d => d.status === 'won').length} ${t('customers.companies.dashboard.kpi.completedDeals', 'completed deals')}` : t('customers.companies.dashboard.kpi.noInteractions', 'No interactions yet') },
  ]

  return (
    <div className="space-y-6">
      {/* KPI Row with hide/show toggles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiTiles.filter((tile) => !hiddenTiles.has(tile.id)).map((tile) => (
          <div key={tile.id} className="relative group">
            <KpiCard
              title={tile.title}
              value={tile.value}
              trend={tile.trend}
              formatValue={tile.formatValue}
              comparisonLabel={tile.comparisonLabel}
            />
            <button
              type="button"
              onClick={() => toggleTile(tile.id)}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground hover:text-foreground"
              aria-label={t('customers.companies.dashboard.hideTile', 'Hide tile')}
            >
              <EyeOff className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {hiddenTiles.size > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('customers.companies.dashboard.hiddenTiles', '{{count}} tiles hidden', { count: hiddenTiles.size })}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-auto text-xs px-1.5 py-0.5" onClick={() => { setHiddenTiles(new Set()); try { localStorage.removeItem('om:dashboard-hidden-tiles') } catch {} }}>
            {t('customers.companies.dashboard.showAll', 'Show all')}
          </Button>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left column */}
        <div className="space-y-6">
          <UpcomingMeetingsWidget meetings={upcomingMeetings} t={t} />
          <OpenTasksWidget tasks={openTasks} t={t} onViewAll={() => onTabChange('activity-log')} currentUserId={null} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <RelationshipHealthWidget health={healthScore} t={t} />
          <ActiveDealWidget deals={activeDeals} t={t} />
        </div>
      </div>

      {/* Log activity composer + calendar */}
      <InlineActivityComposer
        entityType="company"
        entityId={companyId}
        onActivityCreated={onActivityCreated}
        runGuardedMutation={runGuardedMutation}
        onScheduleRequested={onScheduleRequested}
        useCanonicalInteractions={useCanonicalInteractions}
      />

      {/* Recent activity (full width) */}
      <RecentActivityWidget interactions={recentActivity} t={t} />
    </div>
  )
}
