"use client"

import * as React from 'react'
import { MessageSquare, Send, Sparkles } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { extractIncidentAiFailure, resolveIncidentAiErrorMessage } from '../../../lib/aiErrors'
import { AiUnavailableNotice } from '../components/AiUnavailableNotice'
import { useIncidentAiAvailability } from '../components/useAiAvailability'
import { useUserLabels } from '../components/useUserLabels'

type IncidentStatus = 'open' | 'investigating' | 'identified' | 'mitigated' | 'resolved' | 'closed'
type TimelineVisibility = 'internal' | 'customer_facing'
type TimelineComposerKind = 'note' | 'update'
type TimelineKind =
  | 'note'
  | 'update'
  | 'ack'
  | 'status_change'
  | 'severity_change'
  | 'assignment'
  | 'escalation'
  | 'system'
  | 'merged_into'
  | 'merged_from'
  | 'reopened'
  | 'linked'
  | 'unlinked'
  | 'postmortem_published'
  | 'postmortem_updated'
type TimelineFilterId = 'all' | 'updates_notes' | 'status' | 'escalations' | 'system'
type TimelineFilterPreset = {
  id: TimelineFilterId
  labelKey: string
  fallback: string
  kinds: readonly TimelineKind[] | null
}

const statusVariant: Record<IncidentStatus, StatusBadgeVariant> = {
  open: 'error',
  investigating: 'warning',
  identified: 'warning',
  mitigated: 'info',
  resolved: 'success',
  closed: 'neutral',
}

type TimelineEntry = {
  id: string
  incidentId?: string | null
  kind: string
  actorUserId: string | null
  body: string | null
  visibility: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

type TimelineListResponse = {
  items?: TimelineEntry[]
  total?: number
  error?: string
}

const TIMELINE_PAGE_SIZE = 20

const ALL_TIMELINE_FILTER_PRESET = {
  id: 'all',
  labelKey: 'incidents.incident.detail.timeline.filters.all',
  fallback: 'All',
  kinds: null,
} as const satisfies TimelineFilterPreset

const TIMELINE_FILTER_PRESETS = [
  ALL_TIMELINE_FILTER_PRESET,
  {
    id: 'updates_notes',
    labelKey: 'incidents.incident.detail.timeline.filters.updatesNotes',
    fallback: 'Updates & notes',
    kinds: ['note', 'update'],
  },
  {
    id: 'status',
    labelKey: 'incidents.incident.detail.timeline.filters.status',
    fallback: 'Status',
    kinds: ['status_change', 'severity_change', 'assignment', 'ack', 'reopened'],
  },
  {
    id: 'escalations',
    labelKey: 'incidents.incident.detail.timeline.filters.escalations',
    fallback: 'Escalations',
    kinds: ['escalation'],
  },
  {
    id: 'system',
    labelKey: 'incidents.incident.detail.timeline.filters.system',
    fallback: 'System',
    kinds: ['system', 'merged_into', 'merged_from', 'linked', 'unlinked', 'postmortem_published', 'postmortem_updated'],
  },
] as const satisfies readonly TimelineFilterPreset[]

type TimelineMutationResponse = {
  entryId?: string | null
  incidentId?: string | null
  updatedAt?: string | null
}

type CustomerUpdateDraftResponse = {
  draft?: string
}

type TimelineMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type TimelinePanelProps = {
  incidentId: string
  updatedAt?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return value === 'open' ||
    value === 'investigating' ||
    value === 'identified' ||
    value === 'mitigated' ||
    value === 'resolved' ||
    value === 'closed'
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatStatus(t: ReturnType<typeof useT>, value: unknown): string {
  if (value === 'open') return t('incidents.incident.status.open')
  if (value === 'investigating') return t('incidents.incident.status.investigating')
  if (value === 'identified') return t('incidents.incident.status.identified')
  if (value === 'mitigated') return t('incidents.incident.status.mitigated')
  if (value === 'resolved') return t('incidents.incident.status.resolved')
  if (value === 'closed') return t('incidents.incident.status.closed')
  return typeof value === 'string' && value.trim() ? value : t('incidents.incident.status.unknown')
}

function formatDate(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!value) return t('incidents.common.notSet')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  return date.toLocaleString()
}

function formatRelativeAge(value: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!value) return t('incidents.common.notSet')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return t('incidents.incident.detail.age.justNow')
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return t('incidents.incident.detail.age.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('incidents.incident.detail.age.hours', { count: hours })
  const days = Math.floor(hours / 24)
  return t('incidents.incident.detail.age.days', { count: days })
}

function kindLabel(t: ReturnType<typeof useT>, kind: string): string {
  if (kind === 'note') return t('incidents.incident.detail.timeline.kind.note', 'Note')
  if (kind === 'update') return t('incidents.incident.detail.timeline.kind.update', 'Update')
  if (kind === 'ack') return t('incidents.incident.detail.timeline.kind.ack', 'Acknowledgement')
  if (kind === 'status_change') return t('incidents.incident.detail.timeline.kind.statusChange', 'Status change')
  if (kind === 'severity_change') return t('incidents.incident.detail.timeline.kind.severityChange', 'Severity change')
  if (kind === 'assignment') return t('incidents.incident.detail.timeline.kind.assignment', 'Assignment')
  if (kind === 'escalation') return t('incidents.incident.detail.timeline.kind.escalation', 'Escalation')
  if (kind === 'system') return t('incidents.incident.detail.timeline.kind.system', 'System')
  if (kind === 'merged_into') return t('incidents.incident.detail.timeline.kind.mergedInto', 'Merged into')
  if (kind === 'merged_from') return t('incidents.incident.detail.timeline.kind.mergedFrom', 'Merged from')
  if (kind === 'reopened') return t('incidents.incident.detail.timeline.kind.reopened', 'Reopened')
  if (kind === 'linked') return t('incidents.incident.detail.timeline.kind.linked', 'Linked')
  if (kind === 'unlinked') return t('incidents.incident.detail.timeline.kind.unlinked', 'Unlinked')
  if (kind === 'postmortem_published') return t('incidents.incident.detail.timeline.kind.postmortemPublished', 'Postmortem published')
  if (kind === 'postmortem_updated') return t('incidents.incident.detail.timeline.kind.postmortemUpdated', 'Postmortem updated')
  return kind
}

function kindVariant(entry: TimelineEntry): StatusBadgeVariant {
  const toStatus = entry.metadata?.to
  if (entry.kind === 'status_change' && isIncidentStatus(toStatus)) return statusVariant[toStatus]
  if (entry.visibility === 'customer_facing') return 'info'
  if (entry.kind === 'ack') return 'success'
  if (entry.kind === 'escalation' || entry.kind === 'severity_change') return 'warning'
  if (entry.kind === 'update') return 'info'
  return 'neutral'
}

function entryLine(t: ReturnType<typeof useT>, entry: TimelineEntry): string {
  const body = entry.body?.trim()
  if (body) return body
  const metadata = entry.metadata
  if (entry.kind === 'status_change') {
    return t('incidents.incident.detail.timeline.system.statusChange', {
      from: formatStatus(t, metadata?.from),
      to: formatStatus(t, metadata?.to),
    })
  }
  if (entry.kind === 'ack') return t('incidents.incident.detail.timeline.system.ack')
  if (entry.kind === 'severity_change') {
    return t('incidents.incident.detail.timeline.system.severityChange')
  }
  if (entry.kind === 'assignment') return t('incidents.incident.detail.timeline.system.assignment')
  if (entry.kind === 'escalation') {
    const level = readNumber(metadata, 'toLevel') ?? readNumber(metadata, 'level')
    return t('incidents.incident.detail.timeline.system.escalation', {
      level: level == null ? t('incidents.common.notSet') : String(level + 1),
    })
  }
  if (entry.kind === 'system') {
    const until = readString(metadata, 'until')
    if (until) {
      return t('incidents.incident.detail.timeline.system.snoozed', { until: formatDate(until, t) })
    }
  }
  return t('incidents.incident.detail.timeline.system.generic')
}

function errorMessage(result: TimelineListResponse | null, fallback: string): string {
  return typeof result?.error === 'string' && result.error.trim().length > 0 ? result.error : fallback
}

function getTimelineFilterPreset(id: TimelineFilterId): TimelineFilterPreset {
  return TIMELINE_FILTER_PRESETS.find((preset) => preset.id === id) ?? ALL_TIMELINE_FILTER_PRESET
}

function buildTimelineUrl(incidentId: string, page: number, filterId: TimelineFilterId): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(TIMELINE_PAGE_SIZE),
  })
  const preset = getTimelineFilterPreset(filterId)
  if (preset.kinds && preset.kinds.length > 0) {
    params.set('kinds', preset.kinds.join(','))
  }
  return `/api/incidents/${encodeURIComponent(incidentId)}/timeline?${params.toString()}`
}

function timelineTime(value: string): number {
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function compareTimelineEntriesDesc(a: TimelineEntry, b: TimelineEntry): number {
  const diff = timelineTime(b.createdAt) - timelineTime(a.createdAt)
  return diff !== 0 ? diff : b.id.localeCompare(a.id)
}

function compareTimelineEntriesAsc(a: TimelineEntry, b: TimelineEntry): number {
  const diff = timelineTime(a.createdAt) - timelineTime(b.createdAt)
  return diff !== 0 ? diff : a.id.localeCompare(b.id)
}

function mergeTimelineEntries(current: TimelineEntry[], incoming: TimelineEntry[]): TimelineEntry[] {
  const byId = new Map<string, TimelineEntry>()
  current.forEach((entry) => byId.set(entry.id, entry))
  incoming.forEach((entry) => byId.set(entry.id, entry))
  return Array.from(byId.values()).sort(compareTimelineEntriesDesc)
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatTimelineDayLabel(day: Date, t: ReturnType<typeof useT>): string {
  const today = startOfLocalDay(new Date())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (day.getTime() === today.getTime()) return t('incidents.incident.detail.timeline.day.today', 'Today')
  if (day.getTime() === yesterday.getTime()) return t('incidents.incident.detail.timeline.day.yesterday', 'Yesterday')
  return day.toLocaleDateString()
}

type TimelineDayGroup = {
  key: string
  label: string
  entries: TimelineEntry[]
}

function groupTimelineEntriesByDay(entries: TimelineEntry[], t: ReturnType<typeof useT>): TimelineDayGroup[] {
  const groups: TimelineDayGroup[] = []
  const indexes = new Map<string, number>()
  entries.forEach((entry) => {
    const entryDate = new Date(entry.createdAt)
    const day = Number.isNaN(entryDate.getTime()) ? null : startOfLocalDay(entryDate)
    const key = day ? localDayKey(day) : 'unknown'
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, groups.length)
      groups.push({
        key,
        label: day ? formatTimelineDayLabel(day, t) : t('incidents.common.notSet', 'Not set'),
        entries: [entry],
      })
      return
    }
    groups[existingIndex]?.entries.push(entry)
  })
  return groups
}

export function TimelinePanel({ incidentId, updatedAt, canManage, onChanged }: TimelinePanelProps) {
  const t = useT()
  const [items, setItems] = React.useState<TimelineEntry[]>([])
  const [total, setTotal] = React.useState(0)
  const [loadedPages, setLoadedPages] = React.useState(1)
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [body, setBody] = React.useState('')
  const [visibility, setVisibility] = React.useState<TimelineVisibility>('internal')
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isDrafting, setIsDrafting] = React.useState(false)
  const [activeFilter, setActiveFilter] = React.useState<TimelineFilterId>('all')
  const hasLoadedOnceRef = React.useRef(false)
  const aiAvailability = useIncidentAiAvailability()
  const aiAvailable = aiAvailability.available === true
  const contextId = React.useMemo(() => `incident-timeline:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<TimelineMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<TimelineMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  const loadItems = React.useCallback(async (filterId: TimelineFilterId = activeFilter) => {
    if (!hasLoadedOnceRef.current) setIsLoading(true)
    setError(null)
    const result = await apiCall<TimelineListResponse>(
      buildTimelineUrl(incidentId, 1, filterId),
    )
    if (!result.ok) {
      throw new Error(errorMessage(result.result, t('incidents.incident.detail.timeline.error.load', 'Failed to load timeline entries.')))
    }
    const nextItems = Array.isArray(result.result?.items) ? result.result.items : []
    setItems([...nextItems].sort(compareTimelineEntriesDesc))
    setTotal(typeof result.result?.total === 'number' ? result.result.total : 0)
    setLoadedPages(1)
    hasLoadedOnceRef.current = true
    setIsLoading(false)
  }, [activeFilter, incidentId, t])

  const loadOlder = React.useCallback(async () => {
    setIsLoadingMore(true)
    try {
      const nextPage = loadedPages + 1
      const result = await apiCall<TimelineListResponse>(
        buildTimelineUrl(incidentId, nextPage, activeFilter),
      )
      if (!result.ok) return
      const older = Array.isArray(result.result?.items) ? result.result.items : []
      setItems((prev) => {
        const seen = new Set(prev.map((entry) => entry.id))
        return [...prev, ...older.filter((entry) => !seen.has(entry.id))].sort(compareTimelineEntriesDesc)
      })
      if (typeof result.result?.total === 'number') setTotal(result.result.total)
      setLoadedPages(nextPage)
    } finally {
      setIsLoadingMore(false)
    }
  }, [activeFilter, incidentId, loadedPages])

  const mergeLatestItems = React.useCallback(async () => {
    const result = await apiCall<TimelineListResponse>(
      buildTimelineUrl(incidentId, 1, activeFilter),
    )
    if (!result.ok) return
    const latest = Array.isArray(result.result?.items) ? result.result.items : []
    setItems((prev) => mergeTimelineEntries(prev, latest))
    if (typeof result.result?.total === 'number') setTotal(result.result.total)
  }, [activeFilter, incidentId])

  React.useEffect(() => {
    let active = true
    loadItems(activeFilter).catch((err) => {
      if (!active) return
      setError(err instanceof Error ? err.message : t('incidents.incident.detail.timeline.error.load', 'Failed to load timeline entries.'))
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [activeFilter, loadItems, t])

  useAppEvent('incidents.timeline_entry.added', (event) => {
    const eventIncidentId = readString(event.payload, 'incidentId')
    if (!eventIncidentId || eventIncidentId === incidentId) {
      void mergeLatestItems()
    }
  }, [incidentId, mergeLatestItems])

  const handleSubmit = React.useCallback(async () => {
    const nextBody = body.trim()
    if (!nextBody || !canManage) return
    setIsSubmitting(true)
    const payload = {
      kind: visibility === 'customer_facing' ? 'update' : 'note',
      body: nextBody,
      visibility,
    } satisfies { kind: TimelineComposerKind; body: string; visibility: TimelineVisibility }
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<TimelineMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/timeline`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('incidents.incident.detail.timeline.error.post') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, ...payload },
      })
      const freshUpdatedAt = call.result?.updatedAt
      if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
        setCurrentUpdatedAt(freshUpdatedAt)
      }
      setBody('')
      flash(t('incidents.incident.detail.timeline.success.post'), 'success')
      await loadItems()
      void onChanged()
    } catch (err) {
      if (!surfaceRecordConflict(err, t, { onRefresh: () => {
        void loadItems()
        void onChanged()
      } })) {
        flash(t('incidents.incident.detail.timeline.error.post'), 'error')
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [body, canManage, currentUpdatedAt, incidentId, loadItems, mutationContext, onChanged, runMutation, t, visibility])

  const handleDraftCustomerUpdate = React.useCallback(async () => {
    if (!canManage || !aiAvailable || visibility !== 'customer_facing' || isDrafting) return
    setIsDrafting(true)
    try {
      const call = await apiCall<CustomerUpdateDraftResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/ai/customer-update`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tone: 'neutral' }),
        },
      )
      if (!call.ok) {
        flash(resolveIncidentAiErrorMessage(
          extractIncidentAiFailure(call.status, call.result),
          t,
          'incidents.ai.customerUpdate.error',
          'Failed to draft a customer update.',
        ), 'error')
        return
      }
      const draft = call.result?.draft?.trim()
      if (draft) setBody(draft)
    } catch {
      flash(resolveIncidentAiErrorMessage(
        extractIncidentAiFailure(null, null),
        t,
        'incidents.ai.customerUpdate.error',
        'Failed to draft a customer update.',
      ), 'error')
    } finally {
      setIsDrafting(false)
    }
  }, [aiAvailable, canManage, incidentId, isDrafting, t, visibility])

  const handleComposerKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
    }
  }, [handleSubmit])

  const chronologicalItems = React.useMemo(() => [...items].sort(compareTimelineEntriesAsc), [items])
  const dayGroups = React.useMemo(() => groupTimelineEntriesByDay(chronologicalItems, t), [chronologicalItems, t])
  const actorUserIds = React.useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((entry) => entry.actorUserId)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
      ),
    [items],
  )
  const userLabels = useUserLabels(actorUserIds)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner size="sm" />
        <span>{t('incidents.incident.detail.timeline.loading')}</span>
      </div>
    )
  }

  if (error) {
    return <ErrorMessage label={error} />
  }

  const remainingOlder = Math.max(0, total - items.length)

  return (
    <div className="space-y-4">
      <div className="border-b border-border" role="tablist" aria-label={t('incidents.incident.detail.timeline.filters.label', 'Timeline filters')}>
        <nav className="-mb-px flex gap-1 overflow-x-auto px-1" role="presentation">
          {TIMELINE_FILTER_PRESETS.map((preset) => {
            const isActive = activeFilter === preset.id
            return (
              <Button
                key={preset.id}
                type="button"
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveFilter(preset.id)}
                className={cn(
                  'h-auto shrink-0 rounded-none border-b-2 px-3 py-2 hover:bg-transparent',
                  isActive
                    ? 'border-accent-indigo text-foreground font-semibold'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(preset.labelKey, preset.fallback)}
                {isActive ? (
                  <span className="ml-2 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                    {total}
                  </span>
                ) : null}
              </Button>
            )
          })}
        </nav>
      </div>
      {remainingOlder > 0 ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadOlder()}
            disabled={isLoadingMore}
            className="whitespace-nowrap"
          >
            {isLoadingMore ? (
              <Spinner size="sm" />
            ) : (
              t('incidents.incident.detail.timeline.loadOlder', { count: remainingOlder })
            )}
          </Button>
        </div>
      ) : null}
      {chronologicalItems.length > 0 ? (
        <ol className="space-y-4">
          {dayGroups.map((group) => (
            <li key={group.key} className="space-y-3">
              <h3 className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
                {group.label}
              </h3>
              <ol className="space-y-3">
                {group.entries.map((entry) => {
                  const customerFacing = entry.visibility === 'customer_facing'
                  const line = entryLine(t, entry)
                  return (
                    <li
                      key={entry.id}
                      className={customerFacing
                        ? 'rounded-md border border-status-info-border bg-status-info-bg p-3'
                        : 'rounded-md border border-border bg-background p-3'}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-foreground">
                          {entry.actorUserId
                            ? userLabels[entry.actorUserId] ?? entry.actorUserId
                            : t('incidents.incident.detail.timeline.systemActor')}
                        </span>
                        <span className="text-muted-foreground">{formatRelativeAge(entry.createdAt, t)}</span>
                        <StatusBadge variant={kindVariant(entry)} dot>
                          {kindLabel(t, entry.kind)}
                        </StatusBadge>
                      </div>
                      <p className={entry.body?.trim()
                        ? 'mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground'
                        : 'mt-2 text-sm text-muted-foreground'}
                      >
                        {line}
                      </p>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          variant="subtle"
          icon={<MessageSquare aria-hidden="true" />}
          title={t('incidents.incident.detail.timeline.empty.title')}
          description={t('incidents.incident.detail.timeline.empty.description')}
        />
      )}

      <div className="rounded-md border border-border bg-background p-3">
        <div className="space-y-3">
          <Label htmlFor="incident-timeline-composer">
            {t('incidents.incident.detail.timeline.composer.label')}
          </Label>
          <Textarea
            id="incident-timeline-composer"
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={t('incidents.incident.detail.timeline.composer.placeholder')}
            disabled={!canManage || isSubmitting}
            maxLength={8000}
            showCount
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2" aria-label={t('incidents.incident.detail.timeline.composer.visibilityLabel')}>
              <Button
                type="button"
                size="sm"
                variant={visibility === 'internal' ? 'default' : 'outline'}
                aria-pressed={visibility === 'internal'}
                onClick={() => setVisibility('internal')}
                disabled={!canManage || isSubmitting}
                className="whitespace-nowrap"
              >
                {t('incidents.incident.detail.timeline.composer.internal')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={visibility === 'customer_facing' ? 'default' : 'outline'}
                aria-pressed={visibility === 'customer_facing'}
                onClick={() => setVisibility('customer_facing')}
                disabled={!canManage || isSubmitting}
                className="whitespace-nowrap"
              >
                {t('incidents.incident.detail.timeline.composer.customer')}
              </Button>
              {aiAvailable && visibility === 'customer_facing' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDraftCustomerUpdate()}
                  disabled={!canManage || isSubmitting || isDrafting}
                  className="whitespace-nowrap"
                >
                  {isDrafting ? <Spinner size="sm" /> : <Sparkles className="size-4" aria-hidden="true" />}
                  {isDrafting
                    ? t('incidents.ai.customerUpdate.drafting', 'Drafting')
                    : t('incidents.ai.customerUpdate.action', 'Draft with AI')}
                </Button>
              ) : null}
              {aiAvailability.available === false && aiAvailability.reason && visibility === 'customer_facing' ? (
                <AiUnavailableNotice reason={aiAvailability.reason} />
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canManage || isSubmitting || body.trim().length === 0}
              className="whitespace-nowrap"
            >
              <Send aria-hidden="true" />
              {isSubmitting
                ? t('incidents.incident.detail.timeline.composer.sending')
                : t('incidents.incident.detail.timeline.composer.send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
