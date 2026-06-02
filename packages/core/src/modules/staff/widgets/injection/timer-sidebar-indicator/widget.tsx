"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { ProjectColorDot } from '../../../lib/timesheets-ui/ProjectColorDot'

type TimerState = {
  entryId: string
  projectName: string
  projectColor: string | null
  startedAt: string
}

const STORAGE_KEY = 'om:timesheets:activeTimer'

function saveToSession(state: TimerState | null) {
  try {
    if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch { /* private browsing */ }
}

function loadFromSession(): TimerState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.startedAt && parsed?.entryId) return parsed as TimerState
  } catch { /* corrupt or private browsing */ }
  return null
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function TimerSidebarIndicator() {
  const t = useT()
  // Initialise from sessionStorage so the indicator doesn't flash away on navigation
  const [timer, setTimer] = React.useState<TimerState | null>(loadFromSession)
  const [elapsed, setElapsed] = React.useState(0)
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Wrap setTimer to also persist to sessionStorage
  const updateTimer = React.useCallback((next: TimerState | null) => {
    setTimer(next)
    saveToSession(next)
  }, [])

  const pollTimer = React.useCallback(async () => {
    try {
      const selfRes = await apiCall<{ member?: { id: string } | null }>('/api/staff/team-members/self')
      const memberId = selfRes.result?.member?.id
      if (!memberId) { updateTimer(null); return }

      const today = getToday()
      const res = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/staff/timesheets/time-entries?staffMemberId=${memberId}&from=${today}&to=${today}&pageSize=50`,
      )
      const items = (res.result?.items ?? []) as Array<Record<string, unknown>>
      const active = items.find((e) => e.started_at && !e.ended_at)

      if (!active) {
        updateTimer(null)
        return
      }

      const projectId = String(active.time_project_id ?? '')
      let projectName = ''
      let projectColor: string | null = null
      if (projectId) {
        const projRes = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/staff/timesheets/time-projects?ids=${projectId}&pageSize=1`,
        )
        const proj = (projRes.result?.items ?? [])[0]
        if (proj) {
          projectName = String(proj.name ?? '')
          projectColor = typeof proj.color === 'string' ? proj.color : null
        }
      }

      updateTimer({
        entryId: String(active.id ?? ''),
        projectName,
        projectColor,
        startedAt: String(active.started_at ?? ''),
      })
    } catch {
      // Silent — don't crash the sidebar
    }
  }, [updateTimer])

  // Poll for active timer on mount + every 30s
  React.useEffect(() => {
    void pollTimer()
    const poll = setInterval(() => { void pollTimer() }, 30000)
    return () => clearInterval(poll)
  }, [pollTimer])

  // Tick the elapsed counter locally every second
  React.useEffect(() => {
    if (!timer) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      setElapsed(0)
      return
    }

    const startTime = new Date(timer.startedAt).getTime()
    const calcElapsed = () => Math.max(0, Math.floor((Date.now() - startTime) / 1000))
    setElapsed(calcElapsed())

    intervalRef.current = setInterval(() => setElapsed(calcElapsed()), 1000)
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
  }, [timer])

  if (!timer) return null

  return (
    <a
      href="/backend/staff/timesheets"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors cursor-pointer"
      title={t('staff.timesheets.sidebar.timerRunning', 'Timer running — click to view')}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      {timer.projectName ? (
        <span className="inline-flex items-center gap-1 truncate">
          <ProjectColorDot colorKey={timer.projectColor} projectName={timer.projectName} size="xs" />
          <span className="truncate">{timer.projectName}</span>
        </span>
      ) : null}
      <span className="ml-auto font-mono tabular-nums shrink-0">{formatElapsed(elapsed)}</span>
    </a>
  )
}

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'staff.injection.timer-sidebar-indicator',
    title: 'Active timer indicator',
    description: 'Shows a pulsing indicator in the sidebar when a timesheet timer is running.',
    features: ['staff.timesheets.manage_own'],
  },
  Widget: TimerSidebarIndicator,
}

export default widget
