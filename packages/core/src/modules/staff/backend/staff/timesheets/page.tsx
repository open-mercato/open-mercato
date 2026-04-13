"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import { ViewSwitcher } from '../../../lib/timesheets-ui/ViewSwitcher'
import { CalendarPicker } from '../../../lib/timesheets-ui/CalendarPicker'
import { ListView } from '../../../lib/timesheets-ui/ListView'
import { TimerBar } from '../../../lib/timesheets-ui/TimerBar'
import { AddRowDropdown } from '../../../lib/timesheets-ui/AddRowDropdown'
import { CreateProjectDialog } from '../../../lib/timesheets-ui/CreateProjectDialog'
import { ProjectColorDot } from '../../../lib/timesheets-ui/ProjectColorDot'

// --- Types ---

type ProjectRow = { id: string; name: string; code: string | null; color?: string | null }
type CellEntry = { id?: string; minutes: number }
type EntryMap = Record<string, Record<string, CellEntry[]>>
type DirtyMap = Record<string, Record<string, CellEntry>>
type RawTextMap = Record<string, Record<string, string>>
type ViewMode = 'weekly' | 'monthly'
type ViewType = 'timesheet' | 'list'

type RawTimeEntry = Record<string, unknown>

// --- Date Helpers ---

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getSunday(monday: Date): Date {
  const d = new Date(monday)
  d.setDate(d.getDate() + 6)
  return d
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateKeyFromParts(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function isWeekendDay(date: Date): boolean {
  const d = date.getDay()
  return d === 0 || d === 6
}

function minutesToDecimal(minutes: number): string {
  if (minutes === 0) return ''
  const hours = minutes / 60
  return hours % 1 === 0 ? String(hours) : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function decimalToMinutes(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const num = parseFloat(trimmed)
  if (isNaN(num) || num < 0) return 0
  return Math.min(Math.round(num * 60), 1440)
}

function getLocalizedDayName(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short' })
}

// --- Derived date ranges ---

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function getMonthDays(year: number, month: number): Date[] {
  const count = getDaysInMonth(year, month)
  return Array.from({ length: count }, (_, i) => new Date(year, month, i + 1))
}

// --- Week label ---

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = getSunday(weekStart)
  const weekNum = getWeekNumber(weekStart)
  const startDay = weekStart.getDate()
  const endDay = weekEnd.getDate()
  const startMonth = weekStart.toLocaleString(undefined, { month: 'short' })
  const endMonth = weekEnd.toLocaleString(undefined, { month: 'short' })
  const year = weekStart.getFullYear()

  const dateRange = weekStart.getMonth() === weekEnd.getMonth()
    ? `${startDay} - ${endDay} ${startMonth} ${year}`
    : `${startDay} ${startMonth} - ${endDay} ${endMonth} ${year}`

  return `${dateRange} \u00b7 W${weekNum}`
}

function formatMonthLabel(year: number, month: number): string {
  const date = new Date(year, month, 1)
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

// --- Component ---

export default function MyTimesheetsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const now = new Date()
  const [viewMode, setViewMode] = React.useState<ViewMode>('weekly')
  const [viewType, setViewType] = React.useState<ViewType>('timesheet')
  const [weekStart, setWeekStart] = React.useState<Date>(() => getMonday(now))
  const [monthYear, setMonthYear] = React.useState(now.getFullYear())
  const [monthIndex, setMonthIndex] = React.useState(now.getMonth())

  const [projects, setProjects] = React.useState<ProjectRow[]>([])
  const [entries, setEntries] = React.useState<EntryMap>({})
  const [rawEntries, setRawEntries] = React.useState<RawTimeEntry[]>([])
  const [dirty, setDirty] = React.useState<DirtyMap>({})
  const [rawText, setRawText] = React.useState<RawTextMap>({})
  const [staffMemberId, setStaffMemberId] = React.useState<string | null>(null)
  const [staffMemberMissing, setStaffMemberMissing] = React.useState(false)
  const [isInitialLoad, setIsInitialLoad] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [canManageProjects, setCanManageProjects] = React.useState(false)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [allAssignedProjects, setAllAssignedProjects] = React.useState<ProjectRow[]>([])

  // --- Feature check ---
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; granted: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['staff.timesheets.projects.manage'] }),
        })
        if (!cancelled) {
          setCanManageProjects(new Set(res.result?.granted ?? []).has('staff.timesheets.projects.manage'))
        }
      } catch {
        // default: no manage access
      }
    })()
    return () => { cancelled = true }
  }, [])

  // --- Computed days for current view ---
  const visibleDays = React.useMemo(() => {
    if (viewMode === 'weekly') return getWeekDays(weekStart)
    return getMonthDays(monthYear, monthIndex)
  }, [viewMode, weekStart, monthYear, monthIndex])

  const dateRange = React.useMemo(() => {
    if (viewMode === 'weekly') {
      return { from: formatDateKey(weekStart), to: formatDateKey(getSunday(weekStart)) }
    }
    const daysInMonth = getDaysInMonth(monthYear, monthIndex)
    return {
      from: formatDateKeyFromParts(monthYear, monthIndex, 1),
      to: formatDateKeyFromParts(monthYear, monthIndex, daysInMonth),
    }
  }, [viewMode, weekStart, monthYear, monthIndex])

  // --- Navigation ---
  const goToPrev = React.useCallback(() => {
    if (viewMode === 'weekly') {
      setWeekStart((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() - 7)
        return d
      })
    } else {
      setMonthIndex((prev) => {
        if (prev === 0) { setMonthYear((y) => y - 1); return 11 }
        return prev - 1
      })
    }
  }, [viewMode])

  const goToNext = React.useCallback(() => {
    if (viewMode === 'weekly') {
      setWeekStart((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() + 7)
        return d
      })
    } else {
      setMonthIndex((prev) => {
        if (prev === 11) { setMonthYear((y) => y + 1); return 0 }
        return prev + 1
      })
    }
  }, [viewMode])

  const navigationLabel = React.useMemo(() => {
    if (viewMode === 'weekly') return formatWeekLabel(weekStart)
    return formatMonthLabel(monthYear, monthIndex)
  }, [viewMode, weekStart, monthYear, monthIndex])

  // --- Data loading ---
  const isInitialLoadRef = React.useRef(true)

  const loadData = React.useCallback(async () => {
    if (!isInitialLoadRef.current) setIsRefreshing(true)
    try {
      const selfRes = await readApiResultOrThrow<{ member?: { id: string; displayName: string } | null }>(
        '/api/staff/team-members/self',
        undefined,
        { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { member: null } },
      )
      const memberId = selfRes.member?.id ?? null
      setStaffMemberId(memberId)
      if (!memberId) {
        setStaffMemberMissing(true)
        setProjects([])
        setEntries({})
        setRawEntries([])
        setIsInitialLoad(false)
        setIsRefreshing(false)
        return
      }
      setStaffMemberMissing(false)

      const assignmentsRes = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        '/api/staff/timesheets/my-projects?pageSize=100',
        undefined,
        { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { items: [] } },
      )
      const assignmentItems = Array.isArray(assignmentsRes.items) ? assignmentsRes.items : []
      const assignedProjectIds = assignmentItems
        .map((item) => String(item.time_project_id ?? item.timeProjectId ?? ''))
        .filter((id) => id.length > 0)
      const visibleProjectIdSet = new Set(
        assignmentItems
          .filter((item) => item.show_in_grid === true || item.showInGrid === true)
          .map((item) => String(item.time_project_id ?? item.timeProjectId ?? ''))
          .filter((id) => id.length > 0),
      )

      const [projectsRes, entriesRes] = await Promise.all([
        assignedProjectIds.length > 0
          ? readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `/api/staff/timesheets/time-projects?ids=${assignedProjectIds.join(',')}&pageSize=100`,
              undefined,
              { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { items: [] } },
            )
          : Promise.resolve({ items: [] as Array<Record<string, unknown>> }),
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/staff/timesheets/time-entries?pageSize=100&staffMemberId=${memberId}&from=${dateRange.from}&to=${dateRange.to}`,
          undefined,
          { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { items: [] } },
        ),
      ])

      const projectItems = Array.isArray(projectsRes.items) ? projectsRes.items : []
      const mappedProjects = projectItems.map((item) => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? ''),
        code: typeof item.code === 'string' ? item.code : null,
        color: typeof item.color === 'string' ? item.color : null,
      }))
      setAllAssignedProjects(mappedProjects)
      const visibleProjects = mappedProjects.filter((p) => visibleProjectIdSet.has(p.id))
      setProjects(visibleProjects)

      const entryItems = Array.isArray(entriesRes.items) ? entriesRes.items : []
      setRawEntries(entryItems)
      const map: EntryMap = {}
      for (const item of entryItems) {
        const projectId = String(item.time_project_id ?? item.timeProjectId ?? '')
        const rawDate = String(item.date ?? '')
        const dateKey = rawDate.slice(0, 10)
        const minutes = typeof item.duration_minutes === 'number'
          ? item.duration_minutes
          : typeof item.durationMinutes === 'number'
            ? item.durationMinutes
            : 0
        const entryId = String(item.id ?? '')
        if (!map[projectId]) map[projectId] = {}
        if (!map[projectId][dateKey]) map[projectId][dateKey] = []
        map[projectId][dateKey].push({ id: entryId || undefined, minutes })
      }
      setEntries(map)
      setDirty({})
      setRawText({})
    } catch (error) {
      console.error('staff.timesheets.my.load', error)
      flash(t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), 'error')
    } finally {
      isInitialLoadRef.current = false
      setIsInitialLoad(false)
      setIsRefreshing(false)
    }
  }, [dateRange.from, dateRange.to, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData, scopeVersion])

  // --- Cell handlers ---
  const handleCellChange = React.useCallback((projectId: string, dateKey: string, value: string) => {
    // Only allow digits, dots, and commas (decimal separators)
    const sanitized = value.replace(/[^0-9.,]/g, '')
    setRawText((prev) => {
      const projectTexts = { ...(prev[projectId] ?? {}) }
      projectTexts[dateKey] = sanitized
      return { ...prev, [projectId]: projectTexts }
    })
  }, [])

  const handleCellBlur = React.useCallback((projectId: string, dateKey: string) => {
    const text = rawText[projectId]?.[dateKey]
    if (text === undefined) return
    const minutes = decimalToMinutes(text)
    const cellEntries = entries[projectId]?.[dateKey] ?? []
    const existingMinutes = cellEntries.reduce((sum, e) => sum + e.minutes, 0)

    // Only mark dirty if the value actually changed
    if (minutes !== existingMinutes || cellEntries.length > 0) {
      setDirty((prev) => {
        const projectEntries: Record<string, CellEntry> = { ...(prev[projectId] ?? {}) }
        const firstId = cellEntries[0]?.id
        projectEntries[dateKey] = { id: firstId, minutes }
        return { ...prev, [projectId]: projectEntries }
      })
    }
    setRawText((prev) => {
      const projectTexts = { ...(prev[projectId] ?? {}) }
      delete projectTexts[dateKey]
      const hasKeys = Object.keys(projectTexts).length > 0
      if (!hasKeys) {
        const next = { ...prev }
        delete next[projectId]
        return next
      }
      return { ...prev, [projectId]: projectTexts }
    })
  }, [rawText, entries])

  const getCellValue = React.useCallback((projectId: string, dateKey: string): number => {
    const dirtyCell = dirty[projectId]?.[dateKey] as CellEntry | undefined
    if (dirtyCell !== undefined) return dirtyCell.minutes
    const cellEntries = entries[projectId]?.[dateKey] ?? []
    return cellEntries.reduce((sum, e) => sum + e.minutes, 0)
  }, [dirty, entries])

  // --- Save ---
  const hasChanges = Object.keys(dirty).length > 0 || Object.keys(rawText).length > 0

  const handleSave = React.useCallback(async () => {
    if (!hasChanges) return
    const confirmed = await confirm({
      title: t('staff.timesheets.my.confirm_save.title', 'Save changes?'),
      text: t('staff.timesheets.my.confirm_save.body', 'Your timesheet entries will be saved.'),
    })
    if (!confirmed) return

    setIsSaving(true)
    try {
      const bulkEntries: Array<{ id?: string; date: string; timeProjectId: string; durationMinutes: number }> = []
      for (const [projectId, dateMap] of Object.entries(dirty)) {
        for (const [dateKey, cellValue] of Object.entries(dateMap)) {
          const cell = cellValue as CellEntry
          const cellEntries = entries[projectId]?.[dateKey] ?? []
          const firstId = cell.id ?? cellEntries[0]?.id
          bulkEntries.push({ id: firstId, date: dateKey, timeProjectId: projectId, durationMinutes: cell.minutes })
        }
      }
      if (bulkEntries.length === 0) return

      const res = await apiCall('/api/staff/timesheets/time-entries/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: bulkEntries }),
      })
      if (!res.ok) throw new Error(await res.response.text())

      flash(t('staff.timesheets.my.saved', 'Timesheet saved.'), 'success')
      await loadData()
    } catch (error) {
      console.error('staff.timesheets.my.save', error)
      flash(t('staff.timesheets.my.errors.save', 'Failed to save timesheets.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [dirty, entries, hasChanges, confirm, t, loadData])

  // --- Totals ---
  const getRowTotal = React.useCallback((projectId: string): number => {
    let total = 0
    for (const day of visibleDays) {
      total += getCellValue(projectId, formatDateKey(day))
    }
    return total
  }, [visibleDays, getCellValue])

  const getDayTotal = React.useCallback((date: Date): number => {
    const dateKey = formatDateKey(date)
    let total = 0
    for (const project of projects) {
      total += getCellValue(project.id, dateKey)
    }
    return total
  }, [projects, getCellValue])

  const grandTotal = React.useMemo(() => {
    let total = 0
    for (const project of projects) {
      total += getRowTotal(project.id)
    }
    return total
  }, [projects, getRowTotal])

  const workingDays = React.useMemo(() => {
    let count = 0
    for (const day of visibleDays) {
      if (!isWeekendDay(day)) {
        const dateKey = formatDateKey(day)
        for (const project of projects) {
          if (getCellValue(project.id, dateKey) > 0) { count++; break }
        }
      }
    }
    return count
  }, [visibleDays, projects, getCellValue])

  const dailyAverage = React.useMemo(() => {
    if (workingDays === 0) return 0
    return grandTotal / workingDays
  }, [grandTotal, workingDays])

  // --- List view entries ---
  const listViewEntries = React.useMemo(() => {
    return rawEntries.map((item) => ({
      id: String(item.id ?? ''),
      date: String(item.date ?? '').slice(0, 10),
      durationMinutes: typeof item.duration_minutes === 'number' ? item.duration_minutes
        : typeof item.durationMinutes === 'number' ? item.durationMinutes : 0,
      projectId: String(item.time_project_id ?? item.timeProjectId ?? ''),
      projectName: projects.find((p) => p.id === String(item.time_project_id ?? item.timeProjectId ?? ''))?.name ?? '',
      projectCode: projects.find((p) => p.id === String(item.time_project_id ?? item.timeProjectId ?? ''))?.code ?? null,
      projectColor: projects.find((p) => p.id === String(item.time_project_id ?? item.timeProjectId ?? ''))?.color ?? null,
      notes: typeof item.notes === 'string' ? item.notes : null,
      source: typeof item.source === 'string' ? item.source : 'manual',
      startedAt: typeof item.started_at === 'string' ? item.started_at : typeof item.startedAt === 'string' ? item.startedAt : null,
      endedAt: typeof item.ended_at === 'string' ? item.ended_at : typeof item.endedAt === 'string' ? item.endedAt : null,
    }))
  }, [rawEntries, projects])

  // --- Handle view mode change ---
  const handleViewModeChange = React.useCallback((mode: ViewMode) => {
    setViewMode(mode)
    if (mode === 'monthly') {
      // Use Thursday of the week to determine month (handles cross-month weeks)
      const thursday = new Date(weekStart)
      thursday.setDate(thursday.getDate() + 3)
      setMonthYear(thursday.getFullYear())
      setMonthIndex(thursday.getMonth())
    } else {
      // Find the Monday of the week containing the 15th (mid-month, always stable)
      const midMonth = new Date(monthYear, monthIndex, 15)
      setWeekStart(getMonday(midMonth))
    }
  }, [weekStart, monthYear, monthIndex])

  // --- Add row handler ---
  const visibleProjectIds = React.useMemo(() => new Set(projects.map((p) => p.id)), [projects])

  const handleAddProject = React.useCallback(async (project: ProjectRow) => {
    try {
      const res = await apiCall(`/api/staff/timesheets/my-projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showInGrid: true }),
      })
      if (!res.ok) throw new Error(await res.response.text())
      setProjects((prev) => {
        if (prev.some((p) => p.id === project.id)) return prev
        return [...prev, project]
      })
    } catch (error) {
      console.error('staff.timesheets.my.addRow', error)
      flash(t('staff.timesheets.my.addRow.error', 'Could not add the project. Please try again.'), 'error')
    }
  }, [t])

  const handleRemoveProject = React.useCallback(async (project: ProjectRow) => {
    const confirmed = await confirm({
      title: t('staff.timesheets.my.removeRow', 'Remove from grid'),
      text: t(
        'staff.timesheets.my.removeRow.confirm',
        'Remove {projectName} from your timesheet grid? You can re-add it anytime via "+ Add row".',
      ).replace('{projectName}', project.name),
    })
    if (!confirmed) return

    try {
      const res = await apiCall(`/api/staff/timesheets/my-projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showInGrid: false }),
      })
      if (!res.ok) throw new Error(await res.response.text())
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
      setDirty((prev) => {
        if (!prev[project.id]) return prev
        const next = { ...prev }
        delete next[project.id]
        return next
      })
      setRawText((prev) => {
        if (!prev[project.id]) return prev
        const next = { ...prev }
        delete next[project.id]
        return next
      })
    } catch (error) {
      console.error('staff.timesheets.my.removeRow', error)
      flash(t('staff.timesheets.my.removeRow.error', 'Could not remove the project. Please try again.'), 'error')
    }
  }, [confirm, t])

  const handleProjectCreated = React.useCallback(async (project: { id: string; name: string; code: string | null }) => {
    setAllAssignedProjects((prev) => [...prev, project])
    // New projects start hidden; immediately opt them into the grid for the creator.
    try {
      await apiCall(`/api/staff/timesheets/my-projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showInGrid: true }),
      })
    } catch (error) {
      console.error('staff.timesheets.my.createProject.visibility', error)
    }
    setProjects((prev) => [...prev, project])
    setCreateDialogOpen(false)
  }, [])

  // --- Loading ---
  if (isInitialLoad) {
    return <Page><PageBody><LoadingMessage label={t('staff.timesheets.my.loading', 'Loading timesheets...')} /></PageBody></Page>
  }

  // --- No profile ---
  if (staffMemberMissing) {
    return (
      <Page>
        <PageBody>
          <div className="py-12 text-center">
            <p className="text-lg font-semibold mb-2">
              {t('staff.timesheets.my.noProfile.title', 'Set up your profile to start tracking time')}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {t('staff.timesheets.my.noProfile', 'You need a Team Member profile to track time.')}
            </p>
            <Button asChild>
              <Link href="/backend/staff/profile/create">
                {t('staff.timesheets.my.createProfile', 'Create My Profile')}
              </Link>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {/* Timer bar */}
        <TimerBar
          projects={allAssignedProjects}
          staffMemberId={staffMemberId}
          onTimerStopped={loadData}
        />

        {/* Summary cards */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {viewMode === 'weekly'
                ? t('staff.timesheets.my.weekTotal', 'Week Total')
                : t('staff.timesheets.my.total_hours', 'Total Hours')}
            </p>
            <p className="text-2xl font-semibold">{minutesToDecimal(grandTotal) || '0'}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('staff.timesheets.my.working_days', 'Working Days')}</p>
            <p className="text-2xl font-semibold">{workingDays}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('staff.timesheets.my.daily_average', 'Daily Average')}</p>
            <p className="text-2xl font-semibold">{minutesToDecimal(Math.round(dailyAverage)) || '0'}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('staff.timesheets.my.status', 'Status')}</p>
            <p className="text-2xl font-semibold">
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                {t('staff.timesheets.my.status_open', 'Open')}
              </span>
            </p>
          </div>
        </div>

        {/* Navigation + controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" type="button" onClick={goToPrev}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-semibold min-w-[220px] text-center">{navigationLabel}</span>
            <Button variant="outline" size="icon" type="button" onClick={goToNext}>
              <ChevronRight className="size-4" />
            </Button>
            {viewMode === 'weekly' && (
              <CalendarPicker selectedWeekStart={weekStart} onWeekSelect={setWeekStart} />
            )}
          </div>

          <div className="flex items-center gap-3">
            <ViewSwitcher
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              viewType={viewType}
              onViewTypeChange={setViewType}
            />
            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="text-xs text-amber-600 font-medium">
                  {t('staff.timesheets.my.unsaved', 'Unsaved changes')}
                </span>
              )}
              <Button size="sm" type="button" onClick={handleSave} disabled={!hasChanges || isSaving}>
                {isSaving ? t('staff.timesheets.my.saving', 'Saving...') : t('staff.timesheets.my.save_changes', 'Save Changes')}
              </Button>
            </div>
          </div>
        </div>

        {/* Content: Grid or List */}
        <div className={isRefreshing ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
        {projects.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-lg font-semibold mb-2">
              {t('staff.timesheets.my.noProjects.title', 'No projects assigned yet')}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {canManageProjects
                ? t('staff.timesheets.my.noProjects.admin', 'Create a project and assign yourself to start tracking time.')
                : t('staff.timesheets.my.noProjects.employee', 'Ask your manager to assign you to a project.')}
            </p>
            <div className="flex items-center justify-center gap-3">
              {canManageProjects && (
                <Button asChild>
                  <Link href="/backend/staff/timesheets/projects/create">
                    {t('staff.timesheets.my.noProjects.createProject', 'Create Project')}
                  </Link>
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link href="/backend/staff/timesheets/projects">
                  {t('staff.timesheets.my.noProjects.viewProjects', 'View Projects')}
                </Link>
              </Button>
            </div>
          </div>
        ) : viewType === 'list' ? (
          <ListView entries={listViewEntries} onEntryUpdated={loadData} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className={viewMode === 'weekly' ? 'w-[35%]' : 'w-[140px] min-w-[140px]'} />
                {visibleDays.map((date) => (
                  <col key={formatDateKey(date)} className={viewMode === 'weekly' ? '' : 'w-[36px] min-w-[36px]'} />
                ))}
                <col className={viewMode === 'weekly' ? 'w-[72px]' : 'w-[56px] min-w-[56px]'} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
                    {t('staff.timesheets.my.project', 'Project')}
                  </th>
                  {visibleDays.map((date) => {
                    const dayName = getLocalizedDayName(date)
                    const weekend = isWeekendDay(date)
                    return (
                      <th
                        key={formatDateKey(date)}
                        className={`py-2 text-center font-medium px-1 ${weekend ? 'bg-muted/80 text-muted-foreground' : ''}`}
                      >
                        <div className="text-[10px] uppercase text-muted-foreground">{dayName}</div>
                        <div className="text-xs">{date.getDate()}</div>
                      </th>
                    )
                  })}
                  <th className="px-3 py-2 text-right font-medium">
                    {t('staff.timesheets.my.total', 'Total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="group border-b hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 truncate" title={project.name}>
                            <ProjectColorDot colorKey={project.color} projectName={project.name} size="sm" />
                            <span className="truncate">{project.name}</span>
                          </div>
                          {project.code && (
                            <div className="text-[10px] text-muted-foreground">{project.code}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { void handleRemoveProject(project) }}
                          aria-label={t('staff.timesheets.my.removeRow', 'Remove from grid')}
                          title={t('staff.timesheets.my.removeRow', 'Remove from grid')}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-opacity"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    {visibleDays.map((date) => {
                      const dateKey = formatDateKey(date)
                      const weekend = isWeekendDay(date)
                      const cellMinutes = getCellValue(project.id, dateKey)
                      const isDirty = dirty[project.id]?.[dateKey] !== undefined
                      return (
                        <td key={dateKey} className={`px-0.5 py-0.5 ${weekend ? 'bg-muted/40' : ''}`}>
                          {weekend ? (
                            <div className="rounded px-1 py-1 text-center text-xs text-muted-foreground/50">-</div>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              className={`mx-auto block rounded border text-center tabular-nums transition-colors
                                ${viewMode === 'weekly' ? 'w-12 px-1 py-0.5 text-xs' : 'w-8 px-0 py-1 text-[10px]'}
                                ${isDirty ? 'border-amber-400 bg-amber-50' : 'border-muted-foreground/20 bg-transparent'}
                                ${cellMinutes > 0 ? 'font-semibold' : 'text-muted-foreground'}
                                hover:border-muted-foreground/40 focus:border-primary focus:bg-background focus:outline-none`}
                              value={rawText[project.id]?.[dateKey] ?? minutesToDecimal(cellMinutes)}
                              onChange={(e) => handleCellChange(project.id, dateKey, e.target.value)}
                              onBlur={() => handleCellBlur(project.id, dateKey)}
                              placeholder="0"
                            />
                          )}
                        </td>
                      )
                    })}
                    <td className="px-3 py-1.5 text-right font-semibold text-xs tabular-nums">
                      {minutesToDecimal(getRowTotal(project.id)) || '0'}
                    </td>
                  </tr>
                ))}
                <tr className="border-b">
                  <td colSpan={visibleDays.length + 2} className="sticky left-0 bg-background px-1 py-0.5">
                    <AddRowDropdown
                      assignedProjects={allAssignedProjects}
                      visibleProjectIds={visibleProjectIds}
                      canCreateProject={canManageProjects}
                      onAddProject={handleAddProject}
                      onCreateProject={() => setCreateDialogOpen(true)}
                    />
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted px-3 py-2">
                    {t('staff.timesheets.my.daily_total', 'Daily Total')}
                  </td>
                  {visibleDays.map((date) => {
                    const weekend = isWeekendDay(date)
                    const dayMinutes = getDayTotal(date)
                    return (
                      <td key={formatDateKey(date)} className={`py-2 text-center text-xs tabular-nums ${weekend ? 'text-muted-foreground/50' : ''}`}>
                        {weekend ? '-' : (minutesToDecimal(dayMinutes) || '-')}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{minutesToDecimal(grandTotal) || '0'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        </div>
      </PageBody>
      {ConfirmDialogElement}
      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onProjectCreated={handleProjectCreated}
      />
    </Page>
  )
}
