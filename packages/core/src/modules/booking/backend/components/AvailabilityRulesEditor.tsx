"use client"

import * as React from 'react'
import { z } from 'zod'
import { ScheduleView, type ScheduleItem, type ScheduleRange, type ScheduleSlot, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@/lib/i18n/context'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Calendar, Clock, List, Plus, Trash2 } from 'lucide-react'

type AvailabilityRepeat = 'once' | 'daily' | 'weekly'
type AvailabilitySubjectType = 'member' | 'resource' | 'ruleset'

type AvailabilityRule = {
  id: string
  subjectType: AvailabilitySubjectType
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  createdAt?: string | null
}

type AvailabilityRuleSet = {
  id: string
  name: string
  timezone: string
}

export type AvailabilityBookedEvent = {
  id: string
  title: string
  startsAt: string | Date
  endsAt: string | Date
}

export type AvailabilityScheduleItemBuilder = (params: {
  availabilityRules: AvailabilityRule[]
  bookedEvents: AvailabilityBookedEvent[]
  translate: (key: string, fallback?: string) => string
}) => ScheduleItem[]

export type AvailabilityRulesEditorProps = {
  subjectType: AvailabilitySubjectType
  subjectId: string
  labelPrefix: string
  mode?: 'availability' | 'unavailability'
  rulesetId?: string | null
  onRulesetChange?: (rulesetId: string | null) => Promise<void>
  buildScheduleItems: AvailabilityScheduleItemBuilder
  loadBookedEvents?: (range: ScheduleRange) => Promise<AvailabilityBookedEvent[]>
}

type TimeWindow = { start: string; end: string }
type RuleSetFormValues = {
  name: string
}

const DAY_LABELS = [
  { code: 'SU', short: 'S', nameKey: 'schedule.weekday.sunday', fallback: 'Sunday' },
  { code: 'MO', short: 'M', nameKey: 'schedule.weekday.monday', fallback: 'Monday' },
  { code: 'TU', short: 'T', nameKey: 'schedule.weekday.tuesday', fallback: 'Tuesday' },
  { code: 'WE', short: 'W', nameKey: 'schedule.weekday.wednesday', fallback: 'Wednesday' },
  { code: 'TH', short: 'T', nameKey: 'schedule.weekday.thursday', fallback: 'Thursday' },
  { code: 'FR', short: 'F', nameKey: 'schedule.weekday.friday', fallback: 'Friday' },
  { code: 'SA', short: 'S', nameKey: 'schedule.weekday.saturday', fallback: 'Saturday' },
] as const

const DEFAULT_WINDOW: TimeWindow = { start: '09:00', end: '17:00' }

function createDefaultWindow(): TimeWindow {
  return { ...DEFAULT_WINDOW }
}

function formatTimeInput(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDateInput(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseTimeInput(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

function toDateForWeekday(weekday: number, time: string): Date | null {
  const parsed = parseTimeInput(time)
  if (!parsed) return null
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = (weekday - base.getDay() + 7) % 7
  const target = new Date(base.getTime() + diff * 24 * 60 * 60 * 1000)
  target.setHours(parsed.hours, parsed.minutes, 0, 0)
  return target
}

function toDateForDay(value: string, time: string): Date | null {
  if (!value) return null
  const parsed = parseTimeInput(time)
  if (!parsed) return null
  const parts = value.split('-').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  const date = new Date(year, month - 1, day, parsed.hours, parsed.minutes, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildAvailabilityRrule(start: Date, end: Date, repeat: AvailabilityRepeat): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  let rule = ''
  if (repeat === 'once') {
    rule = 'FREQ=DAILY;COUNT=1'
  } else if (repeat === 'weekly') {
    const dayCode = DAY_LABELS[start.getDay()].code
    rule = `FREQ=WEEKLY;BYDAY=${dayCode}`
  } else {
    rule = 'FREQ=DAILY'
  }
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:${rule}`
}

function groupRulesByDate(rules: AvailabilityRule[]): Map<string, AvailabilityRule[]> {
  const map = new Map<string, AvailabilityRule[]>()
  rules.forEach((rule) => {
    const window = parseAvailabilityRuleWindow(rule)
    const key = formatDateInput(window.startAt)
    const list = map.get(key) ?? []
    list.push(rule)
    map.set(key, list)
  })
  return map
}

function buildWindowsFromRules(rules: AvailabilityRule[]): TimeWindow[] {
  return rules
    .map((rule) => {
      const window = parseAvailabilityRuleWindow(rule)
      return {
        start: formatTimeInput(window.startAt),
        end: formatTimeInput(window.endAt),
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start))
}

function serializeWeeklyWindows(map: Map<number, TimeWindow[]>): string {
  const payload = Array.from({ length: 7 }, (_, day) => {
    const windows = map.get(day) ?? []
    return windows.map((window) => ({ start: window.start, end: window.end }))
  })
  return JSON.stringify(payload)
}

export function AvailabilityRulesEditor({
  subjectType,
  subjectId,
  labelPrefix,
  mode = 'availability',
  rulesetId,
  onRulesetChange,
  buildScheduleItems,
  loadBookedEvents,
}: AvailabilityRulesEditorProps) {
  const t = useT()
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const createRuleSetDialogRef = React.useRef<HTMLDivElement | null>(null)
  const [availabilityRules, setAvailabilityRules] = React.useState<AvailabilityRule[]>([])
  const [rulesetRules, setRulesetRules] = React.useState<AvailabilityRule[]>([])
  const [availabilityLoading, setAvailabilityLoading] = React.useState(true)
  const [availabilityError, setAvailabilityError] = React.useState<string | null>(null)
  const [ruleSets, setRuleSets] = React.useState<AvailabilityRuleSet[]>([])
  const [ruleSetsLoading, setRuleSetsLoading] = React.useState(false)
  const [bookedEvents, setBookedEvents] = React.useState<AvailabilityBookedEvent[]>([])
  const [bookedLoading, setBookedLoading] = React.useState(false)
  const [bookedError, setBookedError] = React.useState<string | null>(null)
  const [viewMode, setViewMode] = React.useState<'list' | 'calendar'>('list')
  const [scheduleView, setScheduleView] = React.useState<ScheduleViewMode>('month')
  const [range, setRange] = React.useState<ScheduleRange>(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start, end }
  })
  const [timezone, setTimezone] = React.useState<string>(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorScope, setEditorScope] = React.useState<'date' | 'weekday'>('date')
  const [editorDates, setEditorDates] = React.useState<string[]>([])
  const [editorWeekday, setEditorWeekday] = React.useState<number>(new Date().getDay())
  const [editorWindows, setEditorWindows] = React.useState<TimeWindow[]>([createDefaultWindow()])
  const [editorRules, setEditorRules] = React.useState<AvailabilityRule[]>([])
  const [createRuleSetOpen, setCreateRuleSetOpen] = React.useState(false)
  const [isWeeklyAutoSaving, setIsWeeklyAutoSaving] = React.useState(false)
  const autoSaveTimerRef = React.useRef<number | null>(null)
  const lastSavedWeeklyKeyRef = React.useRef<string | null>(null)

  const usingRuleSet = Boolean(rulesetId) && availabilityRules.length === 0
  const activeRules = usingRuleSet ? rulesetRules : availabilityRules
  const scheduleItems = React.useMemo(
    () => buildScheduleItems({ availabilityRules: activeRules, bookedEvents, translate: t }),
    [activeRules, bookedEvents, buildScheduleItems, t],
  )

  const listLabels = React.useMemo(() => {
    const modeBase = `${labelPrefix}.${mode}`
    return {
      title: t(`${labelPrefix}.availability.section.title`, 'Availability'),
      weeklyTitle: t(`${labelPrefix}.availability.weekly.title`, 'Weekly hours'),
      weeklySubtitle: t(`${labelPrefix}.availability.weekly.subtitle`, 'Set when you are typically available.'),
      dateSpecificTitle: t(`${labelPrefix}.availability.dateSpecific.title`, 'Date-specific hours'),
      dateSpecificSubtitle: t(`${labelPrefix}.availability.dateSpecific.subtitle`, 'Adjust hours for specific days.'),
      addHours: t(`${labelPrefix}.availability.dateSpecific.add`, 'Add hours'),
      timezoneLabel: t(`${labelPrefix}.availability.timezone`, 'Timezone'),
      ruleSetLabel: t(`${labelPrefix}.availability.ruleset.label`, 'Schedule'),
      ruleSetPlaceholder: t(`${labelPrefix}.availability.ruleset.placeholder`, 'Custom schedule'),
      ruleSetCustomize: t(`${labelPrefix}.availability.ruleset.customize`, 'Customize schedule'),
      ruleSetReset: t(`${labelPrefix}.availability.ruleset.reset`, 'Reset to schedule'),
      ruleSetConfirm: t(`${labelPrefix}.availability.ruleset.confirm`, 'Changing the schedule will reset custom hours. Continue?'),
      ruleSetLoading: t(`${labelPrefix}.availability.ruleset.loading`, 'Loading schedules...'),
      ruleSetError: t(`${labelPrefix}.availability.ruleset.error`, 'Failed to load schedules.'),
      ruleSetCreateLabel: t(`${labelPrefix}.availability.ruleset.create`, 'New schedule'),
      ruleSetCreateTitle: t(`${labelPrefix}.availability.ruleset.createTitle`, 'Save as schedule'),
      ruleSetCreateSubmit: t(`${labelPrefix}.availability.ruleset.createSubmit`, 'Save schedule'),
      ruleSetCreateNameLabel: t(`${labelPrefix}.availability.ruleset.createName`, 'Schedule name'),
      ruleSetCreateTimezoneLabel: t(`${labelPrefix}.availability.ruleset.createTimezone`, 'Timezone'),
      ruleSetCreateSuccess: t(`${labelPrefix}.availability.ruleset.createSuccess`, 'Schedule saved.'),
      ruleSetCreateError: t(`${labelPrefix}.availability.ruleset.createError`, 'Failed to save schedule.'),
      editTitle: t(`${modeBase}.form.title.edit`, 'Edit availability'),
      addTitle: t(`${modeBase}.form.title.create`, 'Add availability'),
      applyLabel: t(`${labelPrefix}.availability.actions.apply`, 'Apply'),
      cancelLabel: t('ui.forms.actions.cancel', 'Cancel'),
      applyScopeLabel: t(`${labelPrefix}.availability.scope.label`, 'Apply to'),
      applyScopeDate: t(`${labelPrefix}.availability.scope.date`, 'This date'),
      applyScopeWeekday: t(`${labelPrefix}.availability.scope.weekday`, 'All {{weekday}}s', { weekday: DAY_LABELS[editorWeekday].fallback }),
      windowsLabel: t(`${labelPrefix}.availability.windows.label`, 'What hours are you available?'),
      addWindow: t(`${labelPrefix}.availability.windows.add`, 'Add window'),
      removeWindow: t(`${labelPrefix}.availability.windows.remove`, 'Remove'),
      noHours: t(`${labelPrefix}.availability.weekly.empty`, 'Unavailable'),
      saveWeekly: t(`${labelPrefix}.availability.weekly.save`, 'Save weekly hours'),
      saveWeeklySuccess: t(`${labelPrefix}.availability.weekly.saved`, 'Weekly hours saved.'),
      saveWeeklyError: t(`${labelPrefix}.availability.weekly.error`, 'Failed to save weekly hours.'),
      saveDateSuccess: t(`${labelPrefix}.availability.dateSpecific.saved`, 'Date-specific hours saved.'),
      saveDateError: t(`${labelPrefix}.availability.dateSpecific.error`, 'Failed to save date-specific hours.'),
      scheduleError: t(`${labelPrefix}.schedule.error.load`, 'Failed to load schedule.'),
      scheduleLoading: t(`${labelPrefix}.schedule.loading`, 'Loading schedule...'),
      customizePrompt: t(`${labelPrefix}.availability.ruleset.customizePrompt`, 'This schedule is based on a shared ruleset. Customize it to make changes.'),
      calendarLabel: t(`${labelPrefix}.availability.view.calendar`, 'Calendar'),
      listLabel: t(`${labelPrefix}.availability.view.list`, 'List'),
      editAllLabel: t(`${labelPrefix}.availability.scope.weekdayShort`, 'All {{weekday}}s', { weekday: DAY_LABELS[editorWeekday].fallback }),
      addDateLabel: t(`${labelPrefix}.availability.dateSpecific.addDate`, 'Add date'),
    }
  }, [editorWeekday, labelPrefix, mode, t])

  const refreshAvailability = React.useCallback(async () => {
    if (!subjectId) return
    setAvailabilityLoading(true)
    setAvailabilityError(null)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '100',
        subjectType,
        subjectIds: subjectId,
      })
      const call = await apiCall<{ items?: AvailabilityRule[] }>(`/api/booking/availability?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAvailabilityRules(items)
    } catch (error) {
      const message = error instanceof Error ? error.message : t(`${labelPrefix}.availability.error.load`, 'Failed to load availability.')
      setAvailabilityError(message)
    } finally {
      setAvailabilityLoading(false)
    }
  }, [labelPrefix, subjectId, subjectType, t])

  const refreshRuleSetRules = React.useCallback(async () => {
    if (!rulesetId) {
      setRulesetRules([])
      return
    }
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '100',
        subjectType: 'ruleset',
        subjectIds: rulesetId,
      })
      const call = await apiCall<{ items?: AvailabilityRule[] }>(`/api/booking/availability?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setRulesetRules(items)
    } catch {
      setRulesetRules([])
    }
  }, [rulesetId])

  const refreshRuleSets = React.useCallback(async () => {
    if (!onRulesetChange) return
    setRuleSetsLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const call = await apiCall<{ items?: AvailabilityRuleSet[] }>(`/api/booking/availability-rule-sets?${params.toString()}`)
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setRuleSets(items)
    } catch {
      setRuleSets([])
    } finally {
      setRuleSetsLoading(false)
    }
  }, [onRulesetChange])

  React.useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  React.useEffect(() => {
    void refreshRuleSetRules()
  }, [refreshRuleSetRules])

  React.useEffect(() => {
    void refreshRuleSets()
  }, [refreshRuleSets])

  React.useEffect(() => {
    const ruleTimezone = activeRules.find((rule) => rule.timezone)?.timezone
    if (ruleTimezone) setTimezone(ruleTimezone)
  }, [activeRules])

  const refreshBookedEvents = React.useCallback(async () => {
    if (!loadBookedEvents) return
    setBookedLoading(true)
    setBookedError(null)
    try {
      const items = await loadBookedEvents(range)
      setBookedEvents(Array.isArray(items) ? items : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : listLabels.scheduleError
      setBookedError(message)
    } finally {
      setBookedLoading(false)
    }
  }, [listLabels.scheduleError, loadBookedEvents, range])

  React.useEffect(() => {
    void refreshBookedEvents()
  }, [refreshBookedEvents])

  const weeklyDraft = React.useMemo(() => {
    const draft = new Map<number, TimeWindow[]>()
    for (let day = 0; day < 7; day += 1) {
      draft.set(day, [])
    }
    activeRules.forEach((rule) => {
      const window = parseAvailabilityRuleWindow(rule)
      const repeat = window.repeat
      if (repeat === 'once') return
      const windowValue = {
        start: formatTimeInput(window.startAt),
        end: formatTimeInput(window.endAt),
      }
      if (repeat === 'daily') {
        for (let day = 0; day < 7; day += 1) {
          const list = draft.get(day) ?? []
          list.push(windowValue)
          draft.set(day, list)
        }
      } else {
        const day = window.startAt.getDay()
        const list = draft.get(day) ?? []
        list.push(windowValue)
        draft.set(day, list)
      }
    })
    return draft
  }, [activeRules])

  const [weeklyWindows, setWeeklyWindows] = React.useState<Map<number, TimeWindow[]>>(weeklyDraft)
  const weeklyDraftKey = React.useMemo(() => serializeWeeklyWindows(weeklyDraft), [weeklyDraft])
  const weeklyKey = React.useMemo(() => serializeWeeklyWindows(weeklyWindows), [weeklyWindows])

  React.useEffect(() => {
    setWeeklyWindows(weeklyDraft)
  }, [weeklyDraft])

  React.useEffect(() => {
    lastSavedWeeklyKeyRef.current = weeklyDraftKey
  }, [weeklyDraftKey])

  const dateSpecificRules = React.useMemo(
    () => activeRules.filter((rule) => parseAvailabilityRuleWindow(rule).repeat === 'once'),
    [activeRules],
  )
  const dateGroups = React.useMemo(() => groupRulesByDate(dateSpecificRules), [dateSpecificRules])

  const isLoading = availabilityLoading || bookedLoading
  const error = availabilityError ?? bookedError

  const handleWeeklyWindowChange = React.useCallback((day: number, index: number, next: TimeWindow) => {
    setWeeklyWindows((prev) => {
      const nextMap = new Map(prev)
      const list = [...(nextMap.get(day) ?? [])]
      list[index] = next
      nextMap.set(day, list)
      return nextMap
    })
  }, [])

  const handleWeeklyWindowAdd = React.useCallback((day: number) => {
    setWeeklyWindows((prev) => {
      const nextMap = new Map(prev)
      const list = [...(nextMap.get(day) ?? [])]
      list.push(createDefaultWindow())
      nextMap.set(day, list)
      return nextMap
    })
  }, [])

  const handleWeeklyWindowRemove = React.useCallback((day: number, index: number) => {
    setWeeklyWindows((prev) => {
      const nextMap = new Map(prev)
      const list = [...(nextMap.get(day) ?? [])]
      list.splice(index, 1)
      nextMap.set(day, list)
      return nextMap
    })
  }, [])

  const saveWeeklyHours = React.useCallback(async (options?: { silentSuccess?: boolean; skipRefresh?: boolean }) => {
    const subjectForRules: AvailabilitySubjectType = usingRuleSet ? 'ruleset' : subjectType
    const subjectIdForRules = usingRuleSet ? (rulesetId ?? '') : subjectId
    if (!subjectIdForRules) return

    const weeklyRules = activeRules.filter((rule) => {
      const repeat = parseAvailabilityRuleWindow(rule).repeat
      return repeat === 'weekly' || repeat === 'daily'
    })

    const shouldSkipRefresh = Boolean(options?.skipRefresh)
    setIsWeeklyAutoSaving(options?.silentSuccess === true)
    try {
      await Promise.all(
        weeklyRules.map((rule) => deleteCrud('booking/availability', rule.id, { errorMessage: listLabels.saveWeeklyError })),
      )

      const creations: Array<Promise<unknown>> = []
      weeklyWindows.forEach((windows, day) => {
        windows.forEach((window) => {
          const start = toDateForWeekday(day, window.start)
          const end = toDateForWeekday(day, window.end)
          if (!start || !end || start >= end) return
          const rrule = buildAvailabilityRrule(start, end, 'weekly')
          creations.push(createCrud('booking/availability', {
            subjectType: subjectForRules,
            subjectId: subjectIdForRules,
            timezone,
            rrule,
            exdates: [],
          }, { errorMessage: listLabels.saveWeeklyError }))
        })
      })
      await Promise.all(creations)
      lastSavedWeeklyKeyRef.current = weeklyKey
      if (!options?.silentSuccess) {
        flash(listLabels.saveWeeklySuccess, 'success')
      }
      if (!shouldSkipRefresh) {
        await refreshAvailability()
        await refreshRuleSetRules()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : listLabels.saveWeeklyError
      flash(message, 'error')
    } finally {
      setIsWeeklyAutoSaving(false)
    }
  }, [
    activeRules,
    listLabels.saveWeeklyError,
    listLabels.saveWeeklySuccess,
    refreshAvailability,
    refreshRuleSetRules,
    rulesetId,
    subjectId,
    subjectType,
    timezone,
    usingRuleSet,
    weeklyWindows,
    weeklyKey,
  ])

  React.useEffect(() => {
    if (usingRuleSet) return
    if (weeklyKey === lastSavedWeeklyKeyRef.current) return
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      void saveWeeklyHours({ silentSuccess: true, skipRefresh: viewMode === 'list' })
    }, 600)
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [saveWeeklyHours, usingRuleSet, viewMode, weeklyKey])

  const handleCustomize = React.useCallback(async () => {
    if (!rulesetId) return
    try {
      const creations = rulesetRules.map((rule) => createCrud('booking/availability', {
        subjectType,
        subjectId,
        timezone: rule.timezone,
        rrule: rule.rrule,
        exdates: rule.exdates ?? [],
      }))
      await Promise.all(creations)
      await refreshAvailability()
    } catch (error) {
      const message = error instanceof Error ? error.message : listLabels.saveWeeklyError
      flash(message, 'error')
    }
  }, [listLabels.saveWeeklyError, refreshAvailability, rulesetId, rulesetRules, subjectId, subjectType])

  const handleResetToRuleSet = React.useCallback(async () => {
    if (!rulesetId) return
    try {
      await Promise.all(
        availabilityRules.map((rule) => deleteCrud('booking/availability', rule.id, { errorMessage: listLabels.saveWeeklyError })),
      )
      await refreshAvailability()
    } catch (error) {
      const message = error instanceof Error ? error.message : listLabels.saveWeeklyError
      flash(message, 'error')
    }
  }, [availabilityRules, listLabels.saveWeeklyError, refreshAvailability, rulesetId])

  const handleRuleSetChange = React.useCallback(async (nextId: string | null) => {
    if (!onRulesetChange) return
    if (availabilityRules.length > 0 && nextId !== rulesetId) {
      const confirmed = window.confirm(listLabels.ruleSetConfirm)
      if (!confirmed) return
      await Promise.all(
        availabilityRules.map((rule) => deleteCrud('booking/availability', rule.id, { errorMessage: listLabels.saveWeeklyError })),
      )
    }
    await onRulesetChange(nextId)
    await refreshAvailability()
  }, [
    availabilityRules,
    listLabels.ruleSetReset,
    listLabels.saveWeeklyError,
    onRulesetChange,
    refreshAvailability,
    rulesetId,
  ])

  const ruleSetFormSchema = React.useMemo(
    () => z.object({
      name: z.string().min(1, t('ui.forms.errors.required', 'Required')),
    }),
    [t],
  )

  const ruleSetFormFields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: listLabels.ruleSetCreateNameLabel,
      type: 'text',
      required: true,
      placeholder: listLabels.ruleSetCreateNameLabel,
    },
  ], [listLabels.ruleSetCreateNameLabel])

  const ruleSetInitialValues = React.useMemo<Partial<RuleSetFormValues>>(() => ({
    name: '',
  }), [])

  const handleCreateRuleSet = React.useCallback(async (values: RuleSetFormValues) => {
    const name = values.name.trim()
    const timezoneValue = timezone
    const response = await createCrud('booking/availability-rule-sets', {
      name,
      timezone: timezoneValue,
      description: null,
    }, { errorMessage: listLabels.ruleSetCreateError })
    const id = response.result?.id
    if (!id) throw new Error(listLabels.ruleSetCreateError)
    if (activeRules.length) {
      await Promise.all(
        activeRules.map((rule) => createCrud('booking/availability', {
          subjectType: 'ruleset',
          subjectId: id,
          timezone: rule.timezone || timezoneValue,
          rrule: rule.rrule,
          exdates: rule.exdates ?? [],
        }, { errorMessage: listLabels.ruleSetCreateError })),
      )
    }
    await refreshRuleSets()
    if (onRulesetChange) {
      await onRulesetChange(id)
      await refreshAvailability()
    }
    await refreshRuleSetRules()
    flash(listLabels.ruleSetCreateSuccess, 'success')
    setCreateRuleSetOpen(false)
  }, [
    activeRules,
    listLabels.ruleSetCreateError,
    listLabels.ruleSetCreateSuccess,
    onRulesetChange,
    refreshAvailability,
    refreshRuleSetRules,
    refreshRuleSets,
    timezone,
  ])

  const openEditor = React.useCallback((scope: 'date' | 'weekday', options?: { date?: Date; weekday?: number; rules?: AvailabilityRule[] }) => {
    setEditorScope(scope)
    setEditorRules(options?.rules ?? [])
    if (scope === 'date') {
      const date = options?.date ?? new Date()
      const windows = buildWindowsFromRules(options?.rules ?? [])
      setEditorDates([formatDateInput(date)])
      setEditorWeekday(date.getDay())
      setEditorWindows(windows.length ? windows : [createDefaultWindow()])
    } else {
      const weekday = options?.weekday ?? new Date().getDay()
      const windows = buildWindowsFromRules(options?.rules ?? [])
      setEditorWeekday(weekday)
      setEditorDates([])
      setEditorWindows(windows.length ? windows : [createDefaultWindow()])
    }
    setEditorOpen(true)
  }, [])

  const handleEditorWindowChange = React.useCallback((index: number, window: TimeWindow) => {
    setEditorWindows((prev) => {
      const next = [...prev]
      next[index] = window
      return next
    })
  }, [])

  const handleEditorWindowAdd = React.useCallback(() => {
    setEditorWindows((prev) => [...prev, createDefaultWindow()])
  }, [])

  const handleEditorWindowRemove = React.useCallback((index: number) => {
    setEditorWindows((prev) => prev.filter((_, idx) => idx !== index))
  }, [])

  const handleEditorDateAdd = React.useCallback(() => {
    setEditorDates((prev) => [...prev, formatDateInput(new Date())])
  }, [])

  const handleEditorDateChange = React.useCallback((index: number, value: string) => {
    setEditorDates((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const handleEditorDateRemove = React.useCallback((index: number) => {
    setEditorDates((prev) => prev.filter((_, idx) => idx !== index))
  }, [])

  const handleEditorSubmit = React.useCallback(async () => {
    const subjectForRules: AvailabilitySubjectType = usingRuleSet ? 'ruleset' : subjectType
    const subjectIdForRules = usingRuleSet ? (rulesetId ?? '') : subjectId
    if (!subjectIdForRules) return

    const validWindows = editorWindows.filter((window) => {
      const start = parseTimeInput(window.start)
      const end = parseTimeInput(window.end)
      return start && end && (start.hours < end.hours || (start.hours === end.hours && start.minutes < end.minutes))
    })

    try {
      await Promise.all(editorRules.map((rule) => deleteCrud('booking/availability', rule.id, { errorMessage: listLabels.saveDateError })))

      const creations: Array<Promise<unknown>> = []
      if (editorScope === 'weekday') {
        validWindows.forEach((window) => {
          const start = toDateForWeekday(editorWeekday, window.start)
          const end = toDateForWeekday(editorWeekday, window.end)
          if (!start || !end) return
          const rrule = buildAvailabilityRrule(start, end, 'weekly')
          creations.push(createCrud('booking/availability', {
            subjectType: subjectForRules,
            subjectId: subjectIdForRules,
            timezone,
            rrule,
            exdates: [],
          }, { errorMessage: listLabels.saveDateError }))
        })
      } else {
        const dates = editorDates.filter((value) => value && value.length)
        dates.forEach((date) => {
          validWindows.forEach((window) => {
            const start = toDateForDay(date, window.start)
            const end = toDateForDay(date, window.end)
            if (!start || !end) return
            const rrule = buildAvailabilityRrule(start, end, 'once')
            creations.push(createCrud('booking/availability', {
              subjectType: subjectForRules,
              subjectId: subjectIdForRules,
              timezone,
              rrule,
              exdates: [],
            }, { errorMessage: listLabels.saveDateError }))
          })
        })
      }
      await Promise.all(creations)
      flash(listLabels.saveDateSuccess, 'success')
      setEditorOpen(false)
      setEditorRules([])
      await refreshAvailability()
      await refreshRuleSetRules()
    } catch (error) {
      const message = error instanceof Error ? error.message : listLabels.saveDateError
      flash(message, 'error')
    }
  }, [
    editorDates,
    editorRules,
    editorScope,
    editorWeekday,
    editorWindows,
    listLabels.saveDateError,
    listLabels.saveDateSuccess,
    refreshAvailability,
    refreshRuleSetRules,
    rulesetId,
    subjectId,
    subjectType,
    timezone,
    usingRuleSet,
  ])

  const handleSlotClick = React.useCallback((slot: ScheduleSlot) => {
    if (usingRuleSet) return
    openEditor('date', { date: slot.start })
  }, [openEditor, usingRuleSet])

  const handleItemClick = React.useCallback((item: ScheduleItem) => {
    if (usingRuleSet) return
    const rule = item.metadata?.rule as AvailabilityRule | undefined
    if (!rule) return
    const window = parseAvailabilityRuleWindow(rule)
    if (window.repeat === 'weekly') {
      const weekday = window.startAt.getDay()
      const rules = activeRules.filter((candidate) => {
        const candidateWindow = parseAvailabilityRuleWindow(candidate)
        return candidateWindow.repeat === 'weekly' && candidateWindow.startAt.getDay() === weekday
      })
      openEditor('weekday', { weekday, rules })
    } else {
      const dateKey = formatDateInput(window.startAt)
      const rules = activeRules.filter((candidate) => {
        const candidateWindow = parseAvailabilityRuleWindow(candidate)
        return candidateWindow.repeat === 'once' && formatDateInput(candidateWindow.startAt) === dateKey
      })
      openEditor('date', { date: window.startAt, rules })
    }
  }, [activeRules, openEditor, usingRuleSet])

  return (
    <>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {listLabels.title}
            </p>
            <h2 className="text-lg font-semibold text-foreground">
              {listLabels.title}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setViewMode('list')}
              aria-label={listLabels.listLabel}
              title={listLabels.listLabel}
              className={viewMode === 'list' ? 'bg-accent text-accent-foreground' : undefined}
            >
              <List className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setViewMode('calendar')}
              aria-label={listLabels.calendarLabel}
              title={listLabels.calendarLabel}
              className={viewMode === 'calendar' ? 'bg-accent text-accent-foreground' : undefined}
            >
              <Calendar className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-3">
          {onRulesetChange ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-muted-foreground">
                {listLabels.ruleSetLabel}
              </label>
              {ruleSetsLoading ? (
                <span className="text-xs text-muted-foreground">{listLabels.ruleSetLoading}</span>
              ) : (
                <select
                  className="h-9 rounded border bg-background px-2 text-sm"
                  value={rulesetId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    void handleRuleSetChange(value ? value : null)
                  }}
                >
                  <option value="">{listLabels.ruleSetPlaceholder}</option>
                  {ruleSets.map((ruleSet) => (
                    <option key={ruleSet.id} value={ruleSet.id}>
                      {ruleSet.name}
                    </option>
                  ))}
                </select>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateRuleSetOpen(true)}>
                <Plus className="size-4 mr-2" aria-hidden />
                {listLabels.ruleSetCreateLabel}
              </Button>
              {rulesetId && usingRuleSet ? (
                <Button type="button" variant="outline" size="sm" onClick={handleCustomize}>
                  {listLabels.ruleSetCustomize}
                </Button>
              ) : null}
              {rulesetId && !usingRuleSet ? (
                <Button type="button" variant="ghost" size="sm" onClick={handleResetToRuleSet}>
                  {listLabels.ruleSetReset}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{listLabels.timezoneLabel}</span>
            <Input
              type="text"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="h-8 w-[200px]"
            />
          </div>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <LoadingMessage label={listLabels.scheduleLoading} />
          ) : error ? (
            <ErrorMessage label={error} />
          ) : viewMode === 'calendar' ? (
            <ScheduleView
              items={scheduleItems}
              view={scheduleView}
              range={range}
              timezone={timezone}
              onRangeChange={setRange}
              onViewChange={setScheduleView}
              onTimezoneChange={setTimezone}
              onItemClick={handleItemClick}
              onSlotClick={handleSlotClick}
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {usingRuleSet ? (
                <div className="lg:col-span-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {listLabels.customizePrompt}
                </div>
              ) : null}
              <section>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold">{listLabels.weeklyTitle}</h3>
                      {isWeeklyAutoSaving ? (
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                          <Spinner size="sm" />
                          {t('ui.forms.status.saving', 'Saving...')}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{listLabels.weeklySubtitle}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {DAY_LABELS.map((day, index) => {
                    const windows = weeklyWindows.get(index) ?? []
                    return (
                      <div key={day.code} className="flex flex-wrap items-start gap-3 rounded-lg border bg-background p-3">
                        <div className="flex w-10 justify-center">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                            {day.short}
                          </span>
                        </div>
                        <div className="flex-1 space-y-2">
                          {windows.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{listLabels.noHours}</p>
                          ) : (
                            windows.map((window, windowIndex) => (
                              <div key={`${day.code}-${windowIndex}`} className="flex flex-wrap items-center gap-2">
                                <Input
                                  type="time"
                                  value={window.start}
                                  onChange={(event) => handleWeeklyWindowChange(index, windowIndex, { ...window, start: event.target.value })}
                                  className="h-9 w-[120px]"
                                  disabled={usingRuleSet}
                                />
                                <span className="text-sm text-muted-foreground">-</span>
                                <Input
                                  type="time"
                                  value={window.end}
                                  onChange={(event) => handleWeeklyWindowChange(index, windowIndex, { ...window, end: event.target.value })}
                                  className="h-9 w-[120px]"
                                  disabled={usingRuleSet}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => handleWeeklyWindowRemove(index, windowIndex)}
                                  disabled={usingRuleSet}
                                  aria-label={listLabels.removeWindow}
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                </Button>
                              </div>
                            ))
                          )}
                          <Button type="button" variant="outline" size="sm" onClick={() => handleWeeklyWindowAdd(index)} disabled={usingRuleSet}>
                            <Plus className="size-4 mr-2" aria-hidden />
                            {listLabels.addWindow}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
              <section>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold">{listLabels.dateSpecificTitle}</h3>
                    <p className="text-sm text-muted-foreground">{listLabels.dateSpecificSubtitle}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => openEditor('date')} disabled={usingRuleSet}>
                    <Clock className="size-4 mr-2" aria-hidden />
                    {listLabels.addHours}
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {Array.from(dateGroups.entries()).map(([date, rules]) => (
                    <div key={date} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">{date}</div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEditor('date', { date: new Date(`${date}T00:00:00`), rules })}
                            disabled={usingRuleSet}
                          >
                            {listLabels.editTitle}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={async () => {
                              await Promise.all(rules.map((rule) => deleteCrud('booking/availability', rule.id)))
                              await refreshAvailability()
                              await refreshRuleSetRules()
                            }}
                            disabled={usingRuleSet}
                            aria-label={listLabels.removeWindow}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {buildWindowsFromRules(rules).map((window, index) => (
                          <div key={`${date}-${index}`}>
                            {window.start} - {window.end}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditorOpen(false)
            setEditorRules([])
          }
        }}
      >
        <DialogContent
          ref={dialogRef}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleEditorSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editorRules.length ? listLabels.editTitle : listLabels.addTitle}
            </DialogTitle>
          </DialogHeader>
          <CrudForm
            embedded
            fields={[
              {
                id: 'availabilityEditor',
                label: listLabels.applyScopeLabel,
                type: 'custom',
                component: () => (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div role="tablist" aria-label={listLabels.applyScopeLabel} className="inline-flex rounded-lg border bg-muted p-1 text-xs">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editorScope === 'date'}
                          onClick={() => setEditorScope('date')}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                            editorScope === 'date'
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {listLabels.applyScopeDate}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editorScope === 'weekday'}
                          onClick={() => setEditorScope('weekday')}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                            editorScope === 'weekday'
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {listLabels.editAllLabel}
                        </button>
                      </div>
                    </div>

                    {editorScope === 'date' ? (
                      <div className="space-y-2">
                        {editorDates.map((value, index) => (
                          <div key={`${value}-${index}`} className="flex items-center gap-2">
                            <Input
                              type="date"
                              value={value}
                              onChange={(event) => handleEditorDateChange(index, event.target.value)}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => handleEditorDateRemove(index)}
                              aria-label={listLabels.removeWindow}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={handleEditorDateAdd}>
                          <Plus className="size-4 mr-2" aria-hidden />
                          {listLabels.addDateLabel}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">{listLabels.applyScopeWeekday}</label>
                        <select
                          className="h-9 rounded border bg-background px-2 text-sm"
                          value={String(editorWeekday)}
                          onChange={(event) => setEditorWeekday(Number(event.target.value))}
                        >
                          {DAY_LABELS.map((day, index) => (
                            <option key={day.code} value={index}>
                              {t(day.nameKey, day.fallback)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">{listLabels.windowsLabel}</label>
                      {editorWindows.map((window, index) => (
                        <div key={`${index}-${window.start}`} className="flex flex-wrap items-center gap-2">
                          <Input
                            type="time"
                            value={window.start}
                            onChange={(event) => handleEditorWindowChange(index, { ...window, start: event.target.value })}
                            className="h-9 w-[120px]"
                          />
                          <span className="text-sm text-muted-foreground">-</span>
                          <Input
                            type="time"
                            value={window.end}
                            onChange={(event) => handleEditorWindowChange(index, { ...window, end: event.target.value })}
                            className="h-9 w-[120px]"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => handleEditorWindowRemove(index)}
                            aria-label={listLabels.removeWindow}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={handleEditorWindowAdd}>
                        <Plus className="size-4 mr-2" aria-hidden />
                        {listLabels.addWindow}
                      </Button>
                    </div>
                  </div>
                ),
              },
            ]}
            onSubmit={handleEditorSubmit}
            submitLabel={listLabels.applyLabel}
            extraActions={(
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>
                {listLabels.cancelLabel}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={createRuleSetOpen}
        onOpenChange={(open) => setCreateRuleSetOpen(open)}
      >
        <DialogContent
          ref={createRuleSetDialogRef}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              const form = createRuleSetDialogRef.current?.querySelector('form')
              form?.requestSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{listLabels.ruleSetCreateTitle}</DialogTitle>
          </DialogHeader>
          <CrudForm<RuleSetFormValues>
            embedded
            schema={ruleSetFormSchema}
            fields={ruleSetFormFields}
            initialValues={ruleSetInitialValues}
            onSubmit={handleCreateRuleSet}
            submitLabel={listLabels.ruleSetCreateSubmit}
            extraActions={(
              <Button type="button" variant="ghost" onClick={() => setCreateRuleSetOpen(false)}>
                {listLabels.cancelLabel}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
