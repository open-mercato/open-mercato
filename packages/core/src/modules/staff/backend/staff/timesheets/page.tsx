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
import Link from 'next/link'

type ProjectRow = { id: string; name: string; code: string | null }
type CellEntry = { id?: string; minutes: number }
type EntryMap = Record<string, Record<string, CellEntry[]>>
type DirtyMap = Record<string, Record<string, CellEntry>>
type RawTextMap = Record<string, Record<string, string>>

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function formatDateKey(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${year}-${m}-${d}`
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

function isWeekendDay(year: number, month: number, day: number): boolean {
  const d = new Date(year, month, day).getDay()
  return d === 0 || d === 6
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MyTimesheetsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const now = new Date()
  const [year, setYear] = React.useState(now.getFullYear())
  const [month, setMonth] = React.useState(now.getMonth())
  const [projects, setProjects] = React.useState<ProjectRow[]>([])
  const [entries, setEntries] = React.useState<EntryMap>({})
  const [dirty, setDirty] = React.useState<DirtyMap>({})
  const [rawText, setRawText] = React.useState<RawTextMap>({})
  const [staffMemberId, setStaffMemberId] = React.useState<string | null>(null)
  const [staffMemberMissing, setStaffMemberMissing] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [canManageProjects, setCanManageProjects] = React.useState(false)

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

  const daysInMonth = getDaysInMonth(year, month)
  const days = React.useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  const monthLabel = React.useMemo(() => {
    const date = new Date(year, month, 1)
    return date.toLocaleString(undefined, { month: 'long', year: 'numeric' })
  }, [year, month])

  const goToPrevMonth = React.useCallback(() => {
    setMonth((prev) => {
      if (prev === 0) { setYear((y) => y - 1); return 11 }
      return prev - 1
    })
  }, [])

  const goToNextMonth = React.useCallback(() => {
    setMonth((prev) => {
      if (prev === 11) { setYear((y) => y + 1); return 0 }
      return prev + 1
    })
  }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
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
        setIsLoading(false)
        return
      }
      setStaffMemberMissing(false)

      const fromDate = formatDateKey(year, month, 1)
      const toDate = formatDateKey(year, month, daysInMonth)

      // Spec N+1 Mitigation — 3-query strategy:
      // Query 1: Fetch staff_time_project_members for this staff member (assigned projects)
      const assignmentsRes = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/staff/timesheets/my-projects?pageSize=100`,
        undefined,
        { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { items: [] } },
      )
      const assignmentItems = Array.isArray(assignmentsRes.items) ? assignmentsRes.items : []
      const assignedProjectIds = assignmentItems
        .map((item) => String(item.time_project_id ?? item.timeProjectId ?? ''))
        .filter((id) => id.length > 0)

      // Query 2: Fetch staff_time_projects by IDs from query 1
      // Query 3: Fetch staff_time_entries for date range
      // (queries 2 and 3 run in parallel)
      const [projectsRes, entriesRes] = await Promise.all([
        assignedProjectIds.length > 0
          ? readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `/api/staff/timesheets/time-projects?ids=${assignedProjectIds.join(',')}&pageSize=100`,
              undefined,
              { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { items: [] } },
            )
          : Promise.resolve({ items: [] as Array<Record<string, unknown>> }),
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/staff/timesheets/time-entries?pageSize=100&staffMemberId=${memberId}&from=${fromDate}&to=${toDate}`,
          undefined,
          { errorMessage: t('staff.timesheets.my.errors.load', 'Failed to load timesheets.'), fallback: { items: [] } },
        ),
      ])

      const projectItems = Array.isArray(projectsRes.items) ? projectsRes.items : []
      setProjects(projectItems.map((item) => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? ''),
        code: typeof item.code === 'string' ? item.code : null,
      })))

      const entryItems = Array.isArray(entriesRes.items) ? entriesRes.items : []
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
      setIsLoading(false)
    }
  }, [year, month, daysInMonth, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData, scopeVersion])

  const handleCellChange = React.useCallback((projectId: string, dateKey: string, value: string) => {
    setRawText((prev) => {
      const projectTexts = { ...(prev[projectId] ?? {}) }
      projectTexts[dateKey] = value
      return { ...prev, [projectId]: projectTexts }
    })
  }, [])

  const handleCellBlur = React.useCallback((projectId: string, dateKey: string) => {
    const text = rawText[projectId]?.[dateKey]
    if (text === undefined) return
    const minutes = decimalToMinutes(text)
    setDirty((prev) => {
      const projectEntries: Record<string, CellEntry> = { ...(prev[projectId] ?? {}) }
      const cellEntries = entries[projectId]?.[dateKey] ?? []
      const firstId = cellEntries[0]?.id
      projectEntries[dateKey] = { id: firstId, minutes }
      return { ...prev, [projectId]: projectEntries }
    })
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
          bulkEntries.push({
            id: firstId,
            date: dateKey,
            timeProjectId: projectId,
            durationMinutes: cell.minutes,
          })
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

  const getRowTotal = React.useCallback((projectId: string): number => {
    let total = 0
    for (const day of days) {
      const dateKey = formatDateKey(year, month, day)
      total += getCellValue(projectId, dateKey)
    }
    return total
  }, [days, year, month, getCellValue])

  const getDayTotal = React.useCallback((day: number): number => {
    const dateKey = formatDateKey(year, month, day)
    let total = 0
    for (const project of projects) {
      total += getCellValue(project.id, dateKey)
    }
    return total
  }, [year, month, projects, getCellValue])

  const grandTotal = React.useMemo(() => {
    let total = 0
    for (const project of projects) {
      total += getRowTotal(project.id)
    }
    return total
  }, [projects, getRowTotal])

  const workingDays = React.useMemo(() => {
    let count = 0
    for (const day of days) {
      if (!isWeekendDay(year, month, day)) {
        const dateKey = formatDateKey(year, month, day)
        let dayHasHours = false
        for (const project of projects) {
          if (getCellValue(project.id, dateKey) > 0) { dayHasHours = true; break }
        }
        if (dayHasHours) count++
      }
    }
    return count
  }, [days, year, month, projects, getCellValue])

  const dailyAverage = React.useMemo(() => {
    if (workingDays === 0) return 0
    return grandTotal / workingDays
  }, [grandTotal, workingDays])

  if (isLoading) {
    return <Page><PageBody><LoadingMessage label={t('staff.timesheets.my.loading', 'Loading timesheets...')} /></PageBody></Page>
  }

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
        {/* Summary cards */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t('staff.timesheets.my.total_hours', 'Total Hours')}</p>
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

        {/* Month navigation + save */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPrevMonth}>&larr;</Button>
            <span className="text-lg font-semibold min-w-[180px] text-center">{monthLabel}</span>
            <Button variant="outline" size="sm" onClick={goToNextMonth}>&rarr;</Button>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <span className="text-xs text-amber-600 font-medium">
                {t('staff.timesheets.my.unsaved', 'Unsaved changes')}
              </span>
            )}
            <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? t('staff.timesheets.my.saving', 'Saving...') : t('staff.timesheets.my.save_changes', 'Save Changes')}
            </Button>
          </div>
        </div>

        {/* Grid */}
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
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium min-w-[160px]">
                    {t('staff.timesheets.my.project', 'Project')}
                  </th>
                  {days.map((day) => {
                    const dateObj = new Date(year, month, day)
                    const dayName = DAY_NAMES[dateObj.getDay()]
                    const isWeekend = isWeekendDay(year, month, day)
                    return (
                      <th
                        key={day}
                        className={`px-1 py-2 text-center font-medium min-w-[52px] ${isWeekend ? 'bg-muted/80 text-muted-foreground' : ''}`}
                      >
                        <div className="text-xs text-muted-foreground">{dayName}</div>
                        <div>{day}</div>
                      </th>
                    )
                  })}
                  <th className="px-3 py-2 text-center font-medium min-w-[64px]">
                    {t('staff.timesheets.my.total', 'Total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium">
                      <div className="truncate max-w-[150px]" title={project.name}>
                        {project.name}
                      </div>
                      {project.code && (
                        <div className="text-xs text-muted-foreground">{project.code}</div>
                      )}
                    </td>
                    {days.map((day) => {
                      const dateKey = formatDateKey(year, month, day)
                      const isWeekend = isWeekendDay(year, month, day)
                      const cellMinutes = getCellValue(project.id, dateKey)
                      const isDirty = dirty[project.id]?.[dateKey] !== undefined
                      return (
                        <td
                          key={day}
                          className={`px-0.5 py-0.5 ${isWeekend ? 'bg-muted/40' : ''}`}
                        >
                          {isWeekend ? (
                            <div className="w-full rounded px-1 py-1 text-center text-xs text-muted-foreground/50">
                              -
                            </div>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              className={`w-full rounded border px-1 py-1 text-center text-xs transition-colors
                                ${isDirty ? 'border-amber-400 bg-amber-50' : 'border-transparent bg-transparent'}
                                ${cellMinutes > 0 ? 'font-bold' : ''}
                                hover:border-muted-foreground/30 focus:border-primary focus:bg-background focus:outline-none`}
                              value={rawText[project.id]?.[dateKey] ?? minutesToDecimal(cellMinutes)}
                              onChange={(e) => handleCellChange(project.id, dateKey, e.target.value)}
                              onBlur={() => handleCellBlur(project.id, dateKey)}
                              placeholder="0"
                            />
                          )}
                        </td>
                      )
                    })}
                    <td className="px-3 py-1.5 text-center font-semibold text-sm">
                      {minutesToDecimal(getRowTotal(project.id)) || '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted px-3 py-2">
                    {t('staff.timesheets.my.daily_total', 'Daily Total')}
                  </td>
                  {days.map((day) => {
                    const isWeekend = isWeekendDay(year, month, day)
                    const dayMinutes = getDayTotal(day)
                    return (
                      <td key={day} className={`px-1 py-2 text-center text-xs ${isWeekend ? 'text-muted-foreground/50' : ''}`}>
                        {isWeekend ? '-' : (minutesToDecimal(dayMinutes) || '-')}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-center">{minutesToDecimal(grandTotal) || '0'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
