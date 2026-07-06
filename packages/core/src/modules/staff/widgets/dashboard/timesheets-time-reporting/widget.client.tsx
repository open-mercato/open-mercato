"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { startTimerEntry } from '../../../lib/timesheets-ui/startTimer'
import { resolveTimerActionError } from '../../../lib/timesheets-ui/timerErrors'
import { DEFAULT_SETTINGS, hydrateSettings, type TimeReportingSettings } from './config'

type ProjectOption = { id: string; name: string; code: string | null }

type TimerState = {
  entryId: string | null
  running: boolean
  startedAt: string | null
  projectId: string | null
}

const TIMER_WIDGET_MUTATION_CONTEXT_ID = 'staff-timesheets-time-reporting-widget'

type TimerWidgetMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  staffMemberId: string
  action: 'timer-create' | 'timer-start' | 'timer-stop'
  retryLastMutation: () => Promise<boolean>
}

function formatElapsed(startedAt: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime())
  const totalSeconds = Math.floor(elapsed / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const TimeReportingWidget: React.FC<DashboardWidgetComponentProps<TimeReportingSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<TimerWidgetMutationContext>({
    contextId: TIMER_WIDGET_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])

  const [projects, setProjects] = React.useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(hydrated.lastProjectId)
  const [notes, setNotes] = React.useState('')
  const [timer, setTimer] = React.useState<TimerState>({ entryId: null, running: false, startedAt: null, projectId: null })
  const [elapsed, setElapsed] = React.useState('00:00:00')
  const [staffMemberId, setStaffMemberId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [actionLoading, setActionLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadState = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      // Assignments and the current user's staff member are independent — fetch them together.
      const [assignmentsRes, selfRes] = await Promise.all([
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          '/api/staff/timesheets/my-projects?pageSize=100',
          undefined,
          { errorMessage: '', fallback: { items: [] } },
        ),
        readApiResultOrThrow<{ member?: { id: string } | null }>(
          '/api/staff/team-members/self',
          undefined,
          { errorMessage: '', fallback: { member: null } },
        ),
      ])

      const assignmentItems = Array.isArray(assignmentsRes.items) ? assignmentsRes.items : []
      const projectIds = assignmentItems
        .map((item) => String(item.time_project_id ?? item.timeProjectId ?? ''))
        .filter((id) => id.length > 0)

      const memberId = selfRes.member?.id ?? null
      setStaffMemberId(memberId)

      const today = new Date().toISOString().slice(0, 10)

      // Project details depend on the assignment ids and active entries depend on the staff
      // member id, but the two requests are independent of each other — fetch them together.
      const [projectsRes, entriesRes] = await Promise.all([
        projectIds.length > 0
          ? readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `/api/staff/timesheets/time-projects?ids=${projectIds.join(',')}&pageSize=100`,
              undefined,
              { errorMessage: '', fallback: { items: [] } },
            )
          : Promise.resolve<{ items?: Array<Record<string, unknown>> }>({ items: [] }),
        memberId
          ? readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `/api/staff/timesheets/time-entries?staffMemberId=${memberId}&from=${today}&to=${today}&pageSize=100`,
              undefined,
              { errorMessage: '', fallback: { items: [] } },
            )
          : Promise.resolve<{ items?: Array<Record<string, unknown>> }>({ items: [] }),
      ])

      const projectItems = Array.isArray(projectsRes.items) ? projectsRes.items : []
      setProjects(projectItems.map((item) => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? ''),
        code: typeof item.code === 'string' ? item.code : null,
      })))

      if (memberId) {
        const entries = Array.isArray(entriesRes.items) ? entriesRes.items : []
        const running = entries.find((entry) => {
          const startedAt = entry.started_at ?? entry.startedAt
          const endedAt = entry.ended_at ?? entry.endedAt
          return startedAt != null && endedAt == null
        })
        if (running) {
          setTimer({
            entryId: String(running.id ?? ''),
            running: true,
            startedAt: String(running.started_at ?? running.startedAt ?? ''),
            projectId: String(running.time_project_id ?? running.timeProjectId ?? ''),
          })
        } else {
          setTimer({ entryId: null, running: false, startedAt: null, projectId: null })
        }
      }
    } catch (err) {
      console.error('staff.timesheets.timeReporting.load', err)
      setError(t('staff.timesheets.widgets.timeReporting.error', 'Failed to load timer state'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [onRefreshStateChange, t])

  React.useEffect(() => {
    void loadState()
  }, [loadState, refreshToken])

  // Tick elapsed time
  React.useEffect(() => {
    if (!timer.running || !timer.startedAt) return
    const tick = () => setElapsed(formatElapsed(timer.startedAt!))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [timer.running, timer.startedAt])

  const handleStart = React.useCallback(async () => {
    if (!selectedProjectId || !staffMemberId) return
    if (timer.running) return
    setActionLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      // Single atomic create+start request (issue #3311): a partial failure can
      // no longer leave an orphaned, unstarted timer entry, and a rejected start
      // now surfaces here instead of being silently ignored. The call is routed
      // through the mutation guard (issue #3308) so global injection modules can
      // run onBeforeSave/onAfterSave and surface conflicts consistently.
      const startPayload = {
        staffMemberId,
        timeProjectId: selectedProjectId,
        date: today,
        notes: notes.trim() || null,
      }
      await runMutation({
        operation: () => startTimerEntry(startPayload),
        context: {
          formId: TIMER_WIDGET_MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.time_entry',
          resourceId: staffMemberId,
          staffMemberId,
          action: 'timer-start',
          retryLastMutation,
        },
        mutationPayload: startPayload,
      })

      onSettingsChange({ ...hydrated, lastProjectId: selectedProjectId })
      await loadState()
    } catch (err) {
      console.error('staff.timesheets.timeReporting.start', err)
      setError(resolveTimerActionError(err, t('staff.timesheets.widgets.timeReporting.startError', 'Failed to start timer')))
    } finally {
      setActionLoading(false)
    }
  }, [selectedProjectId, staffMemberId, timer.running, notes, hydrated, onSettingsChange, loadState, runMutation, retryLastMutation, t])

  const handleStop = React.useCallback(async () => {
    if (!timer.entryId || !staffMemberId) return
    setActionLoading(true)
    try {
      const stopPayload = {
        id: timer.entryId,
        action: 'timer-stop',
        staffMemberId,
      }
      await runMutation({
        operation: () =>
          apiCall(`/api/staff/timesheets/time-entries/${timer.entryId}/timer-stop`, { method: 'POST' }),
        context: {
          formId: TIMER_WIDGET_MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.time_entry',
          resourceId: timer.entryId,
          staffMemberId,
          action: 'timer-stop',
          retryLastMutation,
        },
        mutationPayload: stopPayload,
      })
      await loadState()
    } catch (err) {
      console.error('staff.timesheets.timeReporting.stop', err)
      setError(resolveTimerActionError(err, t('staff.timesheets.widgets.timeReporting.stopError', 'Failed to stop timer')))
    } finally {
      setActionLoading(false)
    }
  }, [timer.entryId, staffMemberId, loadState, runMutation, retryLastMutation, t])

  if (mode === 'settings') {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {t('staff.timesheets.widgets.timeReporting.settings.description', 'No additional settings. Select a project and start tracking from the widget.')}
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">{t('staff.timesheets.widgets.timeReporting.loading', 'Loading...')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center py-8">
        <p role="alert" className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">
          {t('staff.timesheets.widgets.timeReporting.noProjects', 'No projects assigned.')}
        </p>
      </div>
    )
  }

  // Timer is running
  if (timer.running) {
    const runningProject = projects.find((p) => p.id === timer.projectId)
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {runningProject?.name ?? t('staff.timesheets.widgets.timeReporting.unknownProject', 'Unknown project')}
        </div>
        <div className="text-center">
          <p className="font-mono text-3xl font-bold tabular-nums">{elapsed}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('staff.timesheets.widgets.timeReporting.running', 'Timer running')}
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          onClick={handleStop}
          disabled={actionLoading}
        >
          {t('staff.timesheets.widgets.timeReporting.stop', 'Stop Timer')}
        </Button>
      </div>
    )
  }

  // Timer not running — show start form
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="timer-project">
          {t('staff.timesheets.widgets.timeReporting.project', 'Project')}
        </label>
        <select
          id="timer-project"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedProjectId ?? ''}
          onChange={(e) => setSelectedProjectId(e.target.value || null)}
        >
          <option value="">{t('staff.timesheets.widgets.timeReporting.selectProject', 'Select project...')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}{project.code ? ` (${project.code})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="timer-notes">
          {t('staff.timesheets.widgets.timeReporting.taskNote', 'Task / Note')}
        </label>
        <Input
          id="timer-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('staff.timesheets.widgets.timeReporting.notesPlaceholder', 'What are you working on?')}
        />
      </div>
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          {t('staff.timesheets.widgets.timeReporting.notRunning', 'Not running')}
        </p>
      </div>
      <Button
        type="button"
        className="w-full"
        onClick={handleStart}
        disabled={actionLoading || !selectedProjectId}
      >
        {t('staff.timesheets.widgets.timeReporting.start', 'Start Timer')}
      </Button>
    </div>
  )
}

export default TimeReportingWidget
