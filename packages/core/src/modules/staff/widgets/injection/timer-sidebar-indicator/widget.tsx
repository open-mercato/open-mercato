"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { ProjectColorDot } from '../../../lib/timesheets-ui/ProjectColorDot'
import { useActiveTimesheetTimer } from '../../../lib/timesheets-ui/useActiveTimesheetTimer'

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function TimerSidebarIndicator() {
  const t = useT()
  const timer = useActiveTimesheetTimer()
  const [elapsed, setElapsed] = React.useState(0)
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick the elapsed counter locally every second
  React.useEffect(() => {
    if (!timer.running || !timer.startedAt) {
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
  }, [timer.running, timer.startedAt])

  if (!timer.running || !timer.entryId) return null

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
