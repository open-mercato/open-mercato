'use client'

import * as React from 'react'
import { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react'
import { z } from 'zod'
import { Play, Square } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { dismissRecordConflict, surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { callbackProp } from '../time-tracking/componentContracts'
import { ProjectColorDot } from './ProjectColorDot'
import { useActiveTimesheetTimer } from './useActiveTimesheetTimer'
import { useTimesheetPreference } from './useTimesheetPreference'
import { resolveSeedProjectId } from './resolveSeedProjectId'
import { startTimerEntry } from './startTimer'
import { isConflictError, isRecordLockedError, resolveTimerActionError } from './timerErrors'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff')

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
  /** Ids of the projects the member has opted into their grid (`show_in_grid`). */
  visibleProjectIds?: string[]
  /**
   * The host could not load the member's projects, so an empty `projects` list means
   * "unknown", not "none assigned" — the Start hint must not send them to an admin.
   */
  projectsUnavailable?: boolean
}

const TIMER_MUTATION_CONTEXT_ID = 'staff-timesheets-timer-bar'

// The timer's writes are one-shot and carry no record-lock resource on purpose.
// A resource makes the enterprise record-lock widget treat this bar as an editing
// session: it takes a lock after every write that nothing heartbeats or releases,
// sends that stale lock's base with later writes, and keeps a conflict in client
// state with no dialog here to resolve it — which blocked every note save and
// Stop until reload (#8236). The server still applies record locks and the
// `updated_at` check to every one of these writes.
type TimerMutationContext = {
  formId: string
  staffMemberId: string | null
  action: 'timer-create' | 'timer-start' | 'timer-stop' | 'timer-notes'
  retryLastMutation: () => Promise<boolean>
}

type NoteSaveOutcome = { ok: true } | { ok: false; error: unknown }

const NOTE_SAVED: NoteSaveOutcome = { ok: true }

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

function DefaultTimerBar({
  projects,
  staffMemberId,
  onTimerStopped,
  visibleProjectIds,
  projectsUnavailable,
}: TimerBarProps) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<TimerMutationContext>({
    contextId: TIMER_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const timerBarInjectionContext = useMemo(
    () => ({ staffMemberId, retryLastMutation }),
    [retryLastMutation, staffMemberId],
  )

  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [description, setDescription] = useState('')
  const [persistedDescription, setPersistedDescription] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [projectFilter, setProjectFilter] = useState('')
  const [hasPendingNoteSync, setHasPendingNoteSync] = useState(false)
  const [noteBaseVersion, setNoteBaseVersion] = useState<string | null>(null)

  const descriptionRef = useRef(description)
  const persistedDescriptionRef = useRef(persistedDescription)
  const startRequestedRef = useRef(false)
  const noteEntryIdRef = useRef<string | null>(null)
  const surfacedRemoteNoteVersionRef = useRef<string | null>(null)
  const adoptingLatestNoteRef = useRef(false)
  const noteConflictSurfacedRef = useRef(false)
  const stopInProgressRef = useRef(false)
  const pendingNoteSaveRef = useRef<Promise<NoteSaveOutcome> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasSeededRef = useRef(false)
  const seededForMemberRef = useRef<string | null>(null)
  const activeTimer = useActiveTimesheetTimer({ staffMemberId })
  const preference = useTimesheetPreference(staffMemberId)

  const activeEntryId = activeTimer.entryId
  const activeProjectId = activeTimer.projectId
  const isRunning = activeTimer.running
  const refreshActiveTimer = activeTimer.refresh

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const activeProjectName = activeProject?.name ?? activeTimer.projectName
  const activeProjectColor = activeProject?.color ?? activeTimer.projectColor
  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  const startHintId = useId()
  const startDisabledReason = selectedProjectId
    ? null
    : projects.length === 0
      ? projectsUnavailable
        ? t(
            'staff.timesheets.my.timer.startDisabledProjectsUnavailable',
            'Your projects could not be loaded — try again',
          )
        : t(
            'staff.timesheets.my.timer.startDisabledNoProjects',
            'No projects assigned yet — ask an admin to assign you to one',
          )
      : t('staff.timesheets.my.timer.startDisabledNoProject', 'Pick a project to start the timer')

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(projectFilter.toLowerCase()),
  )

  const startElapsedCounter = useCallback((startedAt: string) => {
    const startTime = new Date(startedAt).getTime()
    const calcElapsed = () => Math.max(0, Math.floor((Date.now() - startTime) / 1000))
    setElapsedSeconds(calcElapsed())

    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setElapsedSeconds(calcElapsed())
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
    descriptionRef.current = description
    persistedDescriptionRef.current = persistedDescription
  }, [description, persistedDescription])

  useEffect(() => {
    if (activeTimer.running && activeTimer.startedAt) {
      startElapsedCounter(activeTimer.startedAt)
      return
    }
    stopElapsedCounter()
  }, [activeTimer.running, activeTimer.startedAt, startElapsedCounter, stopElapsedCounter])

  // The server's note only replaces the field when the user has nothing unsaved in
  // it. Text typed while this bar's own start is still in flight (Enter does nothing
  // until the timer runs) would otherwise be overwritten by the note the start was
  // sent with. A timer started elsewhere (another tab, the dashboard widget) always
  // adopts the server note, so a half-typed draft is never saved onto it.
  //
  // A refetch of the SAME running entry is different: the draft belongs to that
  // entry, so it is kept, together with the version it was based on. Adopting the
  // refetched note and version would silently drop the typed text, and saving the
  // draft against the refetched version would silently overwrite the other tab's
  // note; keeping the old version lets the save hit the optimistic-lock conflict
  // bar instead. A note changed elsewhere is surfaced once per remote version.
  // When the refetched note is still the one the draft started from, only the
  // version moved (typically this bar's own save, seen by a later refetch), so the
  // draft moves onto it: keeping the old version reported the user's own save back
  // as "changed by someone else" (#8236).
  // The latest field values are read through refs so typing does not re-run this.
  useEffect(() => {
    if (!activeTimer.running || !activeTimer.entryId) {
      noteEntryIdRef.current = null
      return
    }
    const remoteNotes = activeTimer.notes
    const remoteVersion = activeTimer.updatedAt ?? null
    const isSameEntry = noteEntryIdRef.current === activeTimer.entryId
    noteEntryIdRef.current = activeTimer.entryId
    const hasUnsavedEdit =
      descriptionRef.current.trim() !== persistedDescriptionRef.current.trim()
    const isOwnStart = startRequestedRef.current
    startRequestedRef.current = false
    if (hasUnsavedEdit && isOwnStart) {
      if (remoteNotes != null) setPersistedDescription(remoteNotes)
      setNoteBaseVersion(remoteVersion)
      setHasPendingNoteSync(true)
      return
    }
    if (hasUnsavedEdit && isSameEntry) {
      const remoteNote = (remoteNotes ?? '').trim()
      if (remoteNote === persistedDescriptionRef.current.trim()) {
        setNoteBaseVersion(remoteVersion)
        return
      }
      if (remoteNote === descriptionRef.current.trim()) {
        setPersistedDescription(remoteNotes ?? '')
        setNoteBaseVersion(remoteVersion)
        return
      }
      if (!adoptingLatestNoteRef.current && surfacedRemoteNoteVersionRef.current !== remoteVersion) {
        surfacedRemoteNoteVersionRef.current = remoteVersion
        flash(
          t(
            'staff.timesheets.my.timer.noteChangedElsewhere',
            'This timer\'s note was changed in another tab. Your unsaved text is kept; saving it will ask you to resolve the conflict.',
          ),
          'warning',
        )
      }
      return
    }
    if (remoteNotes != null) {
      setDescription(remoteNotes)
      setPersistedDescription(remoteNotes)
    }
    setNoteBaseVersion(remoteVersion)
  }, [activeTimer.running, activeTimer.entryId, activeTimer.notes, activeTimer.updatedAt, t])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Seed the picker once the inputs it ranks are actually known.
  //
  // Both guards matter. Seeding before the active-timer lookup settles would apply
  // a lower rung and then be overtaken by the running timer, so the picker would
  // visibly flip or stick on the wrong project — the exact confusion #3750 reports.
  // And seeding only while the selection is still null means a deliberate pick
  // always beats a late-arriving fetch.
  useEffect(() => {
    if (hasSeededRef.current) return
    if (!staffMemberId) return
    if (activeTimer.isLoading || preference.isLoading) return
    // A failed lookup settles `isLoading` but falls back to an empty timer, so
    // rung 1 would read `null` and a lower rung would win — then latch. On the
    // next 30s refetch the running timer reappears, hides the picker, and the
    // wrong seed only resurfaces after a Stop. An unresolved timer is "not
    // settled yet", not "nothing running".
    if (activeTimer.error) return
    // Same reasoning for the preference: a failed fetch settles with
    // `lastProjectId: null`, so rung 2 would be skipped and a lower rung would
    // latch before a retry could correct it. Lower stakes than the timer —
    // rungs 3 and 4 need exactly one candidate, so the worst case is the same
    // project or no seed, never a wrong one — but the two guards should agree.
    if (preference.error) return
    if (projects.length === 0) return
    if (selectedProjectId !== null) return

    hasSeededRef.current = true
    const seeded = resolveSeedProjectId({
      runningProjectId: activeTimer.projectId,
      lastProjectId: preference.lastProjectId,
      visibleProjectIds: visibleProjectIds ?? [],
      assignedProjectIds: projects.map((p) => p.id),
    })
    if (seeded) setSelectedProjectId(seeded)
  }, [
    staffMemberId,
    activeTimer.isLoading,
    activeTimer.error,
    activeTimer.projectId,
    preference.isLoading,
    preference.error,
    preference.lastProjectId,
    projects,
    selectedProjectId,
    visibleProjectIds,
  ])

  // `StaffTeamMember` is organization-scoped, so a different member id means a
  // different organization. If this component ever survives that switch without
  // remounting, a latched ref would hold the previous org's project while
  // `projects` refreshes to the new org's list.
  //
  // This covers the *preference* path only. `activeTimesheetTimerQueryKey` is a
  // bare constant with no member or org in it, so the active-timer query can
  // still serve the previous org's cached result across such a switch. That is
  // a pre-existing gap, recorded in the spec as an adjacent issue; the
  // `assignedProjectIds` guard in `resolveSeedProjectId` keeps it from
  // producing a cross-org *seed*, so the residue is a stale display.
  //
  // Only on an actual member-to-member change: firing on mount would race the
  // seed effect and clear the selection it had just applied, and treating a
  // transition to `null` as a switch would discard a deliberate pick.
  useEffect(() => {
    const previous = seededForMemberRef.current
    if (!staffMemberId) return
    seededForMemberRef.current = staffMemberId
    if (previous === null || previous === staffMemberId) return
    hasSeededRef.current = false
    setSelectedProjectId(null)
  }, [staffMemberId])

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
      const startPayload = {
        staffMemberId,
        timeProjectId: selectedProjectId,
        date: today,
        notes: description || null,
      }
      startRequestedRef.current = true
      await runMutation({
        operation: () => startTimerEntry(startPayload),
        context: {
          formId: TIMER_MUTATION_CONTEXT_ID,
          staffMemberId,
          action: 'timer-start',
          retryLastMutation,
        },
        mutationPayload: startPayload,
      })

      setPersistedDescription(description)

      // Remember the project on a *successful start* only — not on selection, so an
      // idle mis-click in the dropdown never becomes tomorrow's default. The timer
      // is already running at this point, so a failed write must not surface an
      // error or fail the start; the next successful start corrects the memory.
      void preference.save(selectedProjectId).catch((prefErr: unknown) => {
        logger.warn('staff.timesheets.timer.preferenceWriteFailed', { err: prefErr })
      })

      await activeTimer.refresh()
    } catch (err) {
      startRequestedRef.current = false
      flash(
        resolveTimerActionError(err, t('staff.timesheets.my.timer.startError', 'Failed to start timer')),
        'error',
      )
    } finally {
      setIsStarting(false)
    }
  }

  // Refresh on the conflict bar loads the entry's latest note and version and keeps
  // what the user typed: the draft is saved against the latest version on the next
  // Enter, and the note saved elsewhere is shown so overwriting it is a choice.
  const adoptLatestNote = useCallback((entryId: string) => {
    noteConflictSurfacedRef.current = false
    adoptingLatestNoteRef.current = true
    void refreshActiveTimer()
      .then((latest) => {
        if (!latest.running || latest.entryId !== entryId) return
        const latestNote = latest.notes ?? ''
        surfacedRemoteNoteVersionRef.current = latest.updatedAt ?? null
        setPersistedDescription(latestNote)
        setNoteBaseVersion(latest.updatedAt ?? null)
        if (descriptionRef.current.trim() === latestNote.trim()) {
          setDescription(latestNote)
          return
        }
        flash(
          t(
            'staff.timesheets.my.timer.noteRefreshedDraftKept',
            'Loaded the latest version of this timer. Its saved note is now "{note}". Your text is still in the field: press Enter to save it instead.',
            { note: latestNote },
          ),
          'info',
        )
      })
      .catch((refreshErr: unknown) => {
        logger.warn('staff.timesheets.timer.refreshAfterNoteConflictFailed', { err: refreshErr })
      })
      .finally(() => {
        adoptingLatestNoteRef.current = false
      })
  }, [refreshActiveTimer, t])

  const surfaceNoteSaveError = useCallback((error: unknown, entryId: string) => {
    if (isRecordLockedError(error)) {
      flash(
        t(
          'staff.timesheets.my.timer.noteLocked',
          'Someone else is editing this time entry, so the note was not saved. Your text is kept in the field: try again in a moment.',
        ),
        'error',
      )
      return
    }
    const surfaced = surfaceRecordConflict(error, t, {
      title: t('staff.timesheets.my.timer.noteConflictTitle', 'Timer note changed elsewhere'),
      onRefresh: () => adoptLatestNote(entryId),
    })
    if (surfaced) {
      noteConflictSurfacedRef.current = true
      return
    }
    flash(
      resolveTimerActionError(
        error,
        t(
          'staff.timesheets.my.timer.noteSaveError',
          'Could not save the timer note. Your text is kept in the field: press Enter to try again.',
        ),
      ),
      'error',
    )
  }, [adoptLatestNote, t])

  const persistRunningDescription = useCallback(async (
    entryId: string,
    normalizedDescription: string,
    expectedUpdatedAt: string | null,
  ): Promise<NoteSaveOutcome> => {
    setIsSavingDescription(true)
    try {
      const notesPayload = { id: entryId, notes: normalizedDescription || null }
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(expectedUpdatedAt), () =>
            apiCallOrThrow('/api/staff/timesheets/time-entries', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(notesPayload),
            }),
          ),
        context: {
          formId: TIMER_MUTATION_CONTEXT_ID,
          staffMemberId,
          action: 'timer-notes',
          retryLastMutation,
        },
        mutationPayload: notesPayload,
      })
      setPersistedDescription(normalizedDescription)
      // The save bumped the entry's version; without re-reading it the next note
      // edit would send the stale one and trip a false optimistic-lock conflict.
      await refreshActiveTimer().catch((refreshErr: unknown) => {
        logger.warn('staff.timesheets.timer.refreshAfterNoteSaveFailed', { err: refreshErr })
      })
      return NOTE_SAVED
    } catch (error) {
      return { ok: false, error }
    } finally {
      setIsSavingDescription(false)
    }
  }, [runMutation, staffMemberId, retryLastMutation, refreshActiveTimer])

  const saveRunningDescription = useCallback((): Promise<NoteSaveOutcome> => {
    // Clicking Stop right after editing the note fires the input's blur save and
    // then `handleStop`'s own save, both closing over the same not-yet-updated
    // baseline. Joining the save already in flight keeps that to one write.
    if (pendingNoteSaveRef.current) return pendingNoteSaveRef.current
    if (!activeEntryId) return Promise.resolve(NOTE_SAVED)

    const normalizedDescription = description.trim()
    const normalizedPersistedDescription = persistedDescription.trim()
    if (normalizedDescription === normalizedPersistedDescription) return Promise.resolve(NOTE_SAVED)

    const entryId = activeEntryId
    // A failure is surfaced here, once, however many callers joined the save —
    // unless Stop is running: it stops the timer anyway and reports the note itself.
    const pending = persistRunningDescription(entryId, normalizedDescription, noteBaseVersion)
      .then((outcome) => {
        if (!outcome.ok && !stopInProgressRef.current) surfaceNoteSaveError(outcome.error, entryId)
        return outcome
      })
      .finally(() => {
        pendingNoteSaveRef.current = null
      })
    pendingNoteSaveRef.current = pending
    return pending
  }, [activeEntryId, noteBaseVersion, description, persistedDescription, persistRunningDescription, surfaceNoteSaveError])

  useEffect(() => {
    if (!hasPendingNoteSync || !isRunning || !activeEntryId) return
    setHasPendingNoteSync(false)
    void saveRunningDescription()
  }, [hasPendingNoteSync, isRunning, activeEntryId, saveRunningDescription])

  // The note and the stop are separate writes, and Stop always tries the stop.
  // A note that cannot be saved (a conflict, a record lock, a blocked or failed
  // request) used to cancel the stop, which left the timer running in every
  // window (#8236). Now the timer stops, the typed text stays in the field, and
  // the user is told the note was not saved onto the stopped entry.
  const handleStop = async () => {
    if (!activeEntryId) return

    const entryId = activeEntryId
    stopInProgressRef.current = true
    setIsStopping(true)
    try {
      const noteOutcome = await saveRunningDescription()
      const stopPayload = {
        id: entryId,
        action: 'timer-stop',
        staffMemberId,
      }
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow(
              `/api/staff/timesheets/time-entries/${entryId}/timer-stop`,
              { method: 'POST' },
            ),
          context: {
            formId: TIMER_MUTATION_CONTEXT_ID,
            staffMemberId,
            action: 'timer-stop',
            retryLastMutation,
          },
          mutationPayload: stopPayload,
        })
      } catch (err) {
        if (!noteOutcome.ok) surfaceNoteSaveError(noteOutcome.error, entryId)
        flash(
          isRecordLockedError(err)
            ? t(
                'staff.timesheets.my.timer.stopLocked',
                'Someone else is editing this time entry, so the timer was not stopped. Try again in a moment.',
              )
            : resolveTimerActionError(err, t('staff.timesheets.my.timer.stopError', 'Failed to stop timer')),
          'error',
        )
        return
      }

      // A saved note belongs to the entry that just stopped. Left in the field it
      // was sent again by the NEXT start (`notes: description || null`), so a fresh
      // timer silently inherited the previous task's note; both the field and the
      // baseline the unsaved-edit check compares against are cleared. A note that
      // was NOT saved stays in the field, visibly, with a warning.
      setPersistedDescription('')
      if (noteOutcome.ok) {
        setDescription('')
      } else {
        // The conflict bar this note raised (here, or by the guarded mutation for
        // any 409) offers a Refresh for a timer that is no longer running.
        if (noteConflictSurfacedRef.current || isConflictError(noteOutcome.error)) {
          noteConflictSurfacedRef.current = false
          dismissRecordConflict()
        }
        flash(
          t(
            'staff.timesheets.my.timer.stoppedNoteNotSaved',
            'Timer stopped, but your note could not be saved to it. The text is kept in the note field so you can add it to the entry.',
          ),
          'warning',
        )
      }
      await activeTimer.refresh().catch((refreshErr: unknown) => {
        logger.warn('staff.timesheets.timer.refreshAfterStopFailed', { err: refreshErr })
      })
      onTimerStopped()
    } finally {
      stopInProgressRef.current = false
      setIsStopping(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 mb-4">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={isSavingDescription}
        onBlur={() => {
          if (isRunning) {
            void saveRunningDescription()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isRunning) {
            event.preventDefault()
            void saveRunningDescription()
          }
        }}
        placeholder={t(
          'staff.timesheets.my.timer.placeholder',
          'What are you working on?',
        )}
        // `min-w-0` is what actually lets this shrink: a flex child defaults to
        // `min-width: auto`, and an input's intrinsic minimum is its `size`
        // attribute (~20 characters), which held the whole row open. `basis-full`
        // then gives it its own line below `sm` rather than a ~44px sliver.
        className="min-w-0 flex-1 basis-full bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground sm:basis-0"
      />

      <div className="relative" ref={dropdownRef}>
        {isRunning ? (
          activeProjectName ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border bg-muted">
              <ProjectColorDot colorKey={activeProjectColor} projectName={activeProjectName} size="xs" />
              {activeProjectName}
            </span>
          ) : null
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              // h-8, matching the Start/Stop `IconButton size="default"` (size-8)
              // beside it. `Button` and `IconButton` do NOT share a size scale:
              // IconButton `default` is 32px and `lg` is 36px, so `Button
              // size="default"` (36px) would break the row, not fix it.
              // See `.ai/ui-components.md` § primitive pairing.
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
              <div className="absolute right-0 top-full mt-1 z-dropdown min-w-52 rounded-md border bg-popover p-1 shadow-lg">
                <SearchInput
                  size="sm"
                  value={projectFilter}
                  onChange={setProjectFilter}
                  placeholder={t(
                    'staff.timesheets.my.timer.searchProject',
                    'Search projects...',
                  )}
                  className="mb-1"
                  autoFocus
                />
                <div className="max-h-52 overflow-y-auto">
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

      <span className="font-mono text-sm tabular-nums min-w-16 text-right">
        {formatElapsed(elapsedSeconds)}
      </span>

      <InjectionSpot
        spotId={extensionPoints.hosts.timerBarActions.spotId}
        context={timerBarInjectionContext}
        data={{ isRunning, activeEntryId, selectedProjectId }}
      />

      {isRunning ? (
        <IconButton
          type="button"
          variant="destructive"
          size="default"
          onClick={handleStop}
          disabled={isStopping}
          aria-label={t('staff.timesheets.my.timer.stop', 'Stop timer')}
        >
          <Square className="size-4" />
        </IconButton>
      ) : (
        <>
          <SimpleTooltip content={startDisabledReason} side="top">
            <span className="inline-flex" tabIndex={startDisabledReason ? 0 : undefined}>
              <IconButton
                type="button"
                variant="primary"
                size="default"
                onClick={handleStart}
                disabled={isStarting || !selectedProjectId}
                aria-label={t('staff.timesheets.my.timer.start', 'Start timer')}
                aria-describedby={startDisabledReason ? startHintId : undefined}
              >
                <Play className="size-4" />
              </IconButton>
            </span>
          </SimpleTooltip>
          {startDisabledReason ? (
            <span id={startHintId} className="sr-only">
              {startDisabledReason}
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}

const projectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  color: z.string().nullable().optional(),
})

const timerBarPropsSchema: z.ZodType<TimerBarProps> = z.object({
  projects: z.array(projectOptionSchema),
  staffMemberId: z.string().nullable(),
  onTimerStopped: callbackProp<() => void>(),
  visibleProjectIds: z.array(z.string()).optional(),
  projectsUnavailable: z.boolean().optional(),
})

registerComponent<TimerBarProps>({
  id: extensionPoints.hosts.timerBarComponent.componentId,
  component: DefaultTimerBar,
  metadata: {
    module: 'staff',
    description: 'Running-timer bar with the project picker and start/stop controls.',
    propsSchema: timerBarPropsSchema,
  },
})

export function TimerBar(props: TimerBarProps) {
  const Resolved = useRegisteredComponent<TimerBarProps>(
    extensionPoints.hosts.timerBarComponent.componentId,
    DefaultTimerBar,
  )
  return <Resolved {...props} />
}
