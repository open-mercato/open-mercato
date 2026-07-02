"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { addDays } from 'date-fns/addDays'
import { isSameDay } from 'date-fns/isSameDay'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import {
  buildOptimisticLockHeader,
  extractOptimisticLockConflict,
} from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { countByCategory } from '../../lib/calendar/categories'
import { findConflicts } from '../../lib/calendar/conflicts'
import { getVisibleRange } from '../../lib/calendar/range'
import { AgendaList } from './AgendaList'
import { CalendarFooter } from './CalendarFooter'
import { CalendarHeader } from './CalendarHeader'
import { CalendarTabs } from './CalendarTabs'
import { CalendarToolbar } from './CalendarToolbar'
import { MonthGrid } from './MonthGrid'
import { ShortcutsDialog } from './ShortcutsDialog'
import { TimeGrid } from './TimeGrid'
import { UpcomingCards } from './UpcomingCards'
import { CalendarSettingsModal } from './CalendarSettingsModal'
import { useCalendarPreferences } from './useCalendarPreferences'
import { MAX_WINDOW_ITEMS, useCalendarItems } from './useCalendarItems'
import type {
  CalendarFiltersValue,
  CalendarItem,
  CalendarRangePreset,
  CalendarTab,
  CalendarView,
  UpcomingCard,
} from './types'

const CalendarEventEditor = dynamic(
  () => import('./CalendarEventEditor').then((mod) => mod.CalendarEventEditor),
  { ssr: false },
)

const SEARCH_DEBOUNCE_MS = 200
const PHONE_BREAKPOINT_PX = 640
const HIGHLIGHT_CLEAR_MS = 3000
const DEFAULT_AGENDA_HORIZON_DAYS = 7
const UPCOMING_CARDS_COUNT = 4
const EMPTY_FILTERS: CalendarFiltersValue = { types: [], status: null, ownerUserId: null }

type EditorState = { open: boolean; mode: 'create' | 'edit'; item: CalendarItem | null }

const MANAGE_FEATURE = 'customers.interactions.manage'

function useCanManageInteractions(): boolean {
  const [canManage, setCanManage] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ features: [MANAGE_FEATURE] }),
    })
      .then((call) => {
        if (cancelled || !call.ok) return
        const granted = Array.isArray(call.result?.granted)
          ? call.result.granted.map((feature) => String(feature))
          : []
        setCanManage(granted.some((grantedFeature) => matchFeature(MANAGE_FEATURE, grantedFeature)))
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setCanManage(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])
  return canManage
}

function buildTimezoneLabel(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetMinutes = -new Date().getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  const offset = minutes > 0 ? `${sign}${hours}:${String(minutes).padStart(2, '0')}` : `${sign}${hours}`
  return `${timeZone} (GMT${offset})`
}

function resolveJoinUrl(location: string | null): string | null {
  const trimmed = location?.trim() ?? ''
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  return null
}

function asEditableItem(item: CalendarItem): CalendarItem {
  return item.isRecurringOccurrence ? { ...item, id: item.raw.id } : item
}

export type CalendarScreenProps = {
  /** True when the optional resources module is loaded (server-resolved). */
  resourcesEnabled?: boolean
  /** True when the optional staff module is loaded (server-resolved). */
  staffEnabled?: boolean
}

export function CalendarScreen({ resourcesEnabled = false, staffEnabled = true }: CalendarScreenProps = {}) {
  const t = useT()
  const [view, setView] = React.useState<CalendarView>('week')
  const [anchor, setAnchor] = React.useState<Date>(() => new Date())
  const [agendaHorizonDays, setAgendaHorizonDays] = React.useState(DEFAULT_AGENDA_HORIZON_DAYS)
  const [preset, setPreset] = React.useState<CalendarRangePreset | null>('thisWeek')

  React.useEffect(() => {
    if (window.innerWidth >= PHONE_BREAKPOINT_PX) return
    setView('day')
    setPreset(null)
  }, [])
  const [tab, setTab] = React.useState<CalendarTab>('all')
  const [searchText, setSearchText] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [filters, setFilters] = React.useState<CalendarFiltersValue>(EMPTY_FILTERS)
  const [editor, setEditor] = React.useState<EditorState>({ open: false, mode: 'create', item: null })
  const [editorMounted, setEditorMounted] = React.useState(false)
  const [createRange, setCreateRange] = React.useState<{ start: Date; end: Date } | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [highlightItemId, setHighlightItemId] = React.useState<string | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false)
  const { preferences, setPreferences, hydrated: preferencesHydrated, userId: currentUserId } = useCalendarPreferences()

  const range = React.useMemo(
    () => getVisibleRange(view, anchor, agendaHorizonDays),
    [view, anchor, agendaHorizonDays],
  )
  const { items, isLoading, error, truncated, typeLabels, typeColors, refetch } = useCalendarItems(range)

  React.useEffect(() => {
    if (!isLoading) setHasLoadedOnce(true)
  }, [isLoading])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText])

  React.useEffect(() => {
    if (!highlightItemId) return
    const timer = window.setTimeout(() => setHighlightItemId(null), HIGHLIGHT_CLEAR_MS)
    return () => window.clearTimeout(timer)
  }, [highlightItemId])

  const visibleItems = React.useMemo(
    () => items.filter((item) => item.end > range.from && item.start < range.to),
    [items, range],
  )

  const searchedItems = React.useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    if (!query) return visibleItems
    return visibleItems.filter((item) => {
      if (item.title.toLowerCase().includes(query)) return true
      if (item.location && item.location.toLowerCase().includes(query)) return true
      const rawBody = (item.raw as { body?: unknown }).body
      if (typeof rawBody === 'string' && rawBody.toLowerCase().includes(query)) return true
      return item.participants.some((participant) =>
        (participant.name ?? '').toLowerCase().includes(query),
      )
    })
  }, [visibleItems, debouncedSearch])

  const baseItems = React.useMemo(
    () =>
      searchedItems.filter((item) => {
        if (filters.types.length > 0 && !filters.types.includes(item.interactionType)) return false
        if (filters.status && item.status !== filters.status) return false
        if (filters.ownerUserId && item.ownerUserId !== filters.ownerUserId) return false
        if (!preferences.showCrmActivities && item.category !== 'meeting' && item.category !== 'event') return false
        return true
      }),
    [searchedItems, filters, preferences.showCrmActivities],
  )

  const tabCounts = React.useMemo(() => countByCategory(baseItems), [baseItems])

  const viewItems = React.useMemo(() => {
    if (tab === 'meetings') return baseItems.filter((item) => item.category === 'meeting')
    if (tab === 'events') return baseItems.filter((item) => item.category === 'event')
    return baseItems
  }, [baseItems, tab])

  const conflictMap = React.useMemo(
    () => findConflicts(baseItems, { scope: preferences.conflictScope, currentUserId }),
    [baseItems, preferences.conflictScope, currentUserId],
  )
  const conflictIds = React.useMemo(() => new Set(conflictMap.keys()), [conflictMap])

  const upcomingCards = React.useMemo<UpcomingCard[]>(() => {
    const now = new Date()
    const nowMs = now.getTime()
    return baseItems
      .filter((item) => item.start.getTime() >= nowMs)
      .sort((first, second) => first.start.getTime() - second.start.getTime())
      .slice(0, UPCOMING_CARDS_COUNT)
      .map((item) => {
        const conflictCount = preferences.conflictWarnings ? (conflictMap.get(item.id)?.length ?? 0) : 0
        const kind: UpcomingCard['kind'] =
          item.status === 'canceled'
            ? 'cancelled'
            : conflictCount > 0
              ? 'conflicted'
              : isSameDay(item.start, now)
                ? 'today'
                : 'future'
        return { item, kind, conflictCount }
      })
  }, [baseItems, conflictMap, preferences.conflictWarnings])

  const typeOptions = React.useMemo(() => {
    const values = new Set<string>(Object.keys(typeLabels))
    for (const item of items) values.add(item.interactionType)
    return [...values]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: typeLabels[value] ?? value }))
  }, [items, typeLabels])

  const ownerOptions = React.useMemo(() => {
    const participantNames = new Map<string, string>()
    for (const item of items) {
      for (const participant of item.participants) {
        if (participant.name && !participantNames.has(participant.userId)) {
          participantNames.set(participant.userId, participant.name)
        }
      }
    }
    const owners = new Map<string, string>()
    for (const item of items) {
      if (!item.ownerUserId || owners.has(item.ownerUserId)) continue
      owners.set(item.ownerUserId, participantNames.get(item.ownerUserId) ?? item.ownerUserId)
    }
    return [...owners.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((first, second) => first.label.localeCompare(second.label))
  }, [items])

  const timezoneLabel = React.useMemo(() => buildTimezoneLabel(), [])

  const canManage = useCanManageInteractions()

  const openCreateEditor = React.useCallback(() => {
    if (!canManage) return
    setCreateRange(null)
    setEditorMounted(true)
    setEditor({ open: true, mode: 'create', item: null })
  }, [canManage])

  const openEditEditor = React.useCallback(
    (item: CalendarItem) => {
      if (!canManage) return
      setCreateRange(null)
      setEditorMounted(true)
      setEditor({ open: true, mode: 'edit', item: asEditableItem(item) })
    },
    [canManage],
  )

  const handleCreateRange = React.useCallback(
    (start: Date, end: Date) => {
      if (!canManage) return
      setCreateRange({ start, end })
      setEditorMounted(true)
      setEditor({ open: true, mode: 'create', item: null })
    },
    [canManage],
  )

  const seedActivityTypes = React.useMemo(() => {
    const seen = new Set<string>()
    const labels: string[] = []
    for (const value of Object.keys(typeLabels)) {
      const label = typeLabels[value] ?? value
      if (seen.has(label)) continue
      seen.add(label)
      labels.push(label)
    }
    return labels
  }, [typeLabels])

  const handleToday = React.useCallback(() => {
    setAnchor(new Date())
    setPreset(null)
  }, [])

  const handlePresetChange = React.useCallback((next: CalendarRangePreset) => {
    setPreset(next)
    setAnchor(new Date())
    if (next === 'thisWeek') {
      setView('week')
    } else if (next === 'thisMonth') {
      setView('month')
    } else {
      setView('agenda')
      setAgendaHorizonDays(next === 'next30' ? 30 : DEFAULT_AGENDA_HORIZON_DAYS)
    }
  }, [])

  const handleAnchorChange = React.useCallback((date: Date) => {
    setAnchor(date)
    setPreset(null)
  }, [])

  const handleViewChange = React.useCallback((next: CalendarView) => {
    setView(next)
    setPreset(null)
  }, [])

  const handleTimeGridNavigate = React.useCallback((deltaDays: number) => {
    setAnchor((current) => addDays(current, deltaDays))
    setPreset(null)
  }, [])

  const handleDayOpen = React.useCallback((date: Date) => {
    setView('day')
    setAnchor(date)
    setPreset(null)
  }, [])

  const handleSeeConflict = React.useCallback((item: CalendarItem) => {
    setView('week')
    setAnchor(item.start)
    setPreset(null)
    setHighlightItemId(item.id)
  }, [])

  const handleJoin = React.useCallback((item: CalendarItem) => {
    const url = resolveJoinUrl(item.location)
    if (url) window.open(url, '_blank', 'noopener')
  }, [])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'customers-calendar-cancel',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleCancelItem = React.useCallback(
    async (item: CalendarItem) => {
      const interactionId = item.raw.id
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(item.updatedAt), () =>
              apiCallOrThrow('/api/customers/interactions', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: interactionId, status: 'canceled' }),
              }),
            ),
          mutationPayload: {
            operation: 'cancelCalendarEvent',
            interactionId,
            interactionType: item.interactionType,
          },
          context: {
            formId: 'customers-calendar-cancel',
            resourceKind: 'customers.interaction',
            resourceId: interactionId,
            retryLastMutation,
          },
        })
        flash(t('customers.calendar.cards.cancelSuccess', 'Event cancelled'), 'success')
        refetch()
      } catch (err) {
        // An optimistic-lock 409 is surfaced as the persistent conflict bar by
        // useGuardedMutation (surfaceRecordConflict) — don't re-flash.
        if (extractOptimisticLockConflict(err)) return
        flash(t('customers.calendar.cards.cancelError', 'Failed to cancel event'), 'error')
      }
    },
    [refetch, retryLastMutation, runMutation, t],
  )

  const focusSearch = React.useCallback(() => {
    const node = document.querySelector('[data-calendar-search]')
    if (node instanceof HTMLInputElement) node.focus()
    else if (node instanceof HTMLElement) node.querySelector('input')?.focus()
  }, [])

  const editorOpen = editor.open
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }
      if (editorOpen) return
      switch (event.key) {
        case 't':
        case 'T':
          event.preventDefault()
          setAnchor(new Date())
          setPreset(null)
          break
        case 'd':
        case 'D':
          event.preventDefault()
          setView('day')
          setPreset(null)
          break
        case 'w':
        case 'W':
          event.preventDefault()
          setView('week')
          setPreset(null)
          break
        case 'm':
        case 'M':
          event.preventDefault()
          setView('month')
          setPreset(null)
          break
        case 'a':
        case 'A':
          event.preventDefault()
          setView('agenda')
          setPreset(null)
          break
        case 'n':
        case 'N':
          event.preventDefault()
          openCreateEditor()
          break
        case '/':
          event.preventDefault()
          focusSearch()
          break
        case '?':
          event.preventDefault()
          setShortcutsOpen((open) => !open)
          break
        case 'Escape':
          setHighlightItemId(null)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editorOpen, focusSearch, openCreateEditor])

  const showInitialLoading = (isLoading && !hasLoadedOnce) || !preferencesHydrated

  let viewArea: React.ReactNode
  if (error) {
    viewArea = (
      <ErrorMessage
        label={t('customers.calendar.errors.loadFailed', 'Failed to load calendar events.')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            {t('customers.calendar.errors.retry', 'Retry')}
          </Button>
        }
      />
    )
  } else if (showInitialLoading) {
    viewArea = <LoadingMessage label={t('customers.calendar.loading', 'Loading calendar…')} />
  } else if (view === 'month') {
    viewArea = (
      <MonthGrid anchor={anchor} items={viewItems} onItemClick={openEditEditor} onDayOpen={handleDayOpen} />
    )
  } else if (view === 'agenda') {
    viewArea = (
      <AgendaList
        anchor={anchor}
        horizonDays={agendaHorizonDays}
        items={viewItems}
        typeLabels={typeLabels}
        onItemClick={openEditEditor}
      />
    )
  } else {
    viewArea = (
      <TimeGrid
        days={view === 'day' ? 1 : 7}
        anchor={anchor}
        items={viewItems}
        conflictIds={conflictIds}
        showWeekends={preferences.showWeekends}
        showConflicts={preferences.conflictWarnings}
        aiSummaries={preferences.aiSummaries}
        canManage={canManage}
        highlightItemId={highlightItemId}
        onItemClick={openEditEditor}
        onJoin={handleJoin}
        onNavigate={handleTimeGridNavigate}
        onCreate={canManage ? openCreateEditor : undefined}
        onCreateRange={canManage ? handleCreateRange : undefined}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <CalendarHeader view={view} anchor={anchor} onNewEvent={canManage ? openCreateEditor : undefined} />
      <CalendarToolbar
        view={view}
        anchor={anchor}
        range={range}
        preset={preset}
        search={searchText}
        filters={filters}
        typeOptions={typeOptions}
        ownerOptions={ownerOptions}
        onToday={handleToday}
        onPresetChange={handlePresetChange}
        onAnchorChange={handleAnchorChange}
        onSearchChange={setSearchText}
        onFiltersChange={setFilters}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <UpcomingCards
        cards={upcomingCards}
        canManage={canManage}
        onJoin={handleJoin}
        onSeeConflict={handleSeeConflict}
        onOpen={openEditEditor}
        onEdit={openEditEditor}
        onCancel={handleCancelItem}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <CalendarTabs
          tab={tab}
          counts={tabCounts}
          view={view}
          onTabChange={setTab}
          onViewChange={handleViewChange}
        />
        {truncated ? (
          <p className="text-xs text-muted-foreground" role="status">
            {t('customers.calendar.notice.truncated', 'Showing first {count} items for this range.', {
              count: MAX_WINDOW_ITEMS,
            })}
          </p>
        ) : null}
        <div className="flex min-h-[560px] flex-1 flex-col [&>*]:flex-1">{viewArea}</div>
      </div>
      <div className="hidden md:block">
        <CalendarFooter timezoneLabel={timezoneLabel} onOpenShortcuts={() => setShortcutsOpen(true)} />
      </div>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CalendarSettingsModal
        open={settingsOpen}
        preferences={preferences}
        seedActivityTypes={seedActivityTypes}
        onOpenChange={setSettingsOpen}
        onSave={(next) => {
          setPreferences(next)
          flash(t('customers.calendar.settings.saved', 'Calendar settings saved'), 'success')
        }}
      />
      {editorMounted ? (
        <CalendarEventEditor
          open={editor.open}
          mode={editor.mode}
          item={editor.item}
          defaultDate={anchor}
          defaultRange={createRange}
          typeLabels={typeLabels}
          typeColors={typeColors}
          surfacedTypes={preferences.activityTypes}
          eventCategories={preferences.eventCategories}
          conflictScope={preferences.conflictScope}
          currentUserId={currentUserId}
          resourcesEnabled={resourcesEnabled}
          staffEnabled={staffEnabled}
          onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
          onSaved={refetch}
        />
      ) : null}
    </div>
  )
}
