'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ProjectColorDot } from './ProjectColorDot'

type ProjectOption = {
  id: string
  name: string
  code: string | null
  color?: string | null
}

type TimerBarProps = {
  projects: ProjectOption[]
  staffMemberId: string | null
  onTimerStopped: () => void
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getToday(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function TimerBar({ projects, staffMemberId, onTimerStopped }: TimerBarProps) {
  const t = useT()

  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [description, setDescription] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [projectFilter, setProjectFilter] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isRunning = activeEntryId !== null

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(projectFilter.toLowerCase()),
  )

  const startElapsedCounter = useCallback((startedAt: string) => {
    const startTime = new Date(startedAt).getTime()
    const now = Date.now()
    const initialElapsed = Math.max(0, Math.floor((now - startTime) / 1000))
    setElapsedSeconds(initialElapsed)

    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
  }, [])

  const stopElapsedCounter = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setElapsedSeconds(0)
  }, [])

  useEffect(() => {
    if (!staffMemberId) return

    const today = getToday()
    const checkActiveTimer = async () => {
      const response = await apiCall(
        `/api/staff/timesheets/time-entries?staffMemberId=${staffMemberId}&from=${today}&to=${today}&pageSize=50`,
      )
      if (!response.ok) return

      const data = response.result as Record<string, unknown> | null
      const items = (data?.items ?? data?.data ?? []) as Array<Record<string, unknown>>

      const activeEntry = items.find(
        (entry: Record<string, unknown>) =>
          entry.started_at && !entry.ended_at,
      )

      if (activeEntry) {
        setActiveEntryId(String(activeEntry.id ?? ''))
        setActiveProjectId(String(activeEntry.time_project_id ?? ''))
        setDescription(String(activeEntry.notes ?? ''))
        startElapsedCounter(String(activeEntry.started_at ?? ''))
      }
    }

    checkActiveTimer()
  }, [staffMemberId, startElapsedCounter])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowProjectDropdown(false)
        setProjectFilter('')
      }
    }

    if (showProjectDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showProjectDropdown])

  const handleStart = async () => {
    if (!selectedProjectId || !staffMemberId) return

    setIsStarting(true)
    try {
      const today = getToday()
      const createResponse = await apiCallOrThrow(
        '/api/staff/timesheets/time-entries',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            staffMemberId,
            timeProjectId: selectedProjectId,
            date: today,
            durationMinutes: 0,
            source: 'timer',
            notes: description || null,
          }),
        },
      )

      const created = createResponse.result as Record<string, unknown> | null
      const entryId = created?.id as string | undefined

      await apiCallOrThrow(
        `/api/staff/timesheets/time-entries/${entryId}/timer-start`,
        { method: 'POST' },
      )

      setActiveEntryId(entryId ?? null)
      setActiveProjectId(selectedProjectId)
      startElapsedCounter(new Date().toISOString())
    } catch {
      flash(
        t('staff.timesheets.my.timer.startError', 'Failed to start timer'),
        'error',
      )
    } finally {
      setIsStarting(false)
    }
  }

  const handleStop = async () => {
    if (!activeEntryId) return

    setIsStopping(true)
    try {
      await apiCallOrThrow(
        `/api/staff/timesheets/time-entries/${activeEntryId}/timer-stop`,
        { method: 'POST' },
      )

      setActiveEntryId(null)
      setActiveProjectId(null)
      setDescription('')
      stopElapsedCounter()
      onTimerStopped()
    } catch {
      flash(
        t('staff.timesheets.my.timer.stopError', 'Failed to stop timer'),
        'error',
      )
    } finally {
      setIsStopping(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3 mb-4">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        readOnly={isRunning}
        placeholder={t(
          'staff.timesheets.my.timer.placeholder',
          'What are you working on?',
        )}
        className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
      />

      <div className="relative" ref={dropdownRef}>
        {isRunning ? (
          activeProject ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border bg-muted">
              <ProjectColorDot colorKey={activeProject.color} projectName={activeProject.name} size="xs" />
              {activeProject.name}
            </span>
          ) : null
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowProjectDropdown(!showProjectDropdown)
                setProjectFilter('')
              }}
              className="text-xs font-medium"
            >
              {selectedProject
                ? (<><ProjectColorDot colorKey={selectedProject.color} projectName={selectedProject.name} size="xs" /><span className="ml-1">{selectedProject.name}</span></>)
                : t('staff.timesheets.my.timer.selectProject', 'Project')}
            </Button>

            {showProjectDropdown && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border bg-popover p-1 shadow-md">
                <input
                  type="text"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  placeholder={t(
                    'staff.timesheets.my.timer.searchProject',
                    'Search projects...',
                  )}
                  className="w-full bg-transparent border-b px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground mb-1"
                  autoFocus
                />
                <div className="max-h-[200px] overflow-y-auto">
                  {filteredProjects.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t(
                        'staff.timesheets.my.timer.noProjects',
                        'No projects found',
                      )}
                    </div>
                  ) : (
                    filteredProjects.map((project) => (
                      <Button
                        key={project.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-xs h-auto py-1.5"
                        onClick={() => {
                          setSelectedProjectId(project.id)
                          setShowProjectDropdown(false)
                          setProjectFilter('')
                        }}
                      >
                        <ProjectColorDot colorKey={project.color} projectName={project.name} size="xs" />
                        <span className="ml-1">{project.name}</span>
                        {project.code ? (
                          <span className="ml-1 text-muted-foreground">
                            ({project.code})
                          </span>
                        ) : null}
                      </Button>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <span className="font-mono text-sm tabular-nums min-w-[64px] text-right">
        {formatElapsed(elapsedSeconds)}
      </span>

      {isRunning ? (
        <IconButton
          type="button"
          variant="outline"
          size="default"
          onClick={handleStop}
          disabled={isStopping}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          aria-label={t('staff.timesheets.my.timer.stop', 'Stop timer')}
        >
          <Square className="size-4" />
        </IconButton>
      ) : (
        <IconButton
          type="button"
          variant="outline"
          size="default"
          onClick={handleStart}
          disabled={isStarting || !selectedProjectId}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          aria-label={t('staff.timesheets.my.timer.start', 'Start timer')}
        >
          <Play className="size-4" />
        </IconButton>
      )}
    </div>
  )
}
