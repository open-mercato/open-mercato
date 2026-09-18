import * as React from 'react'
import type { ActivityType } from './fieldConfig'

export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative'

export type Participant = {
  userId?: string
  name: string
  email?: string
  color?: string
  status?: RsvpStatus
}

export type LinkedEntity = {
  id: string
  type: 'company' | 'deal' | 'offer'
  label: string
}

export type ScheduleActivityEditData = {
  id: string
  /** Record version for the OSS optimistic-lock header on edit (#2055). */
  updatedAt?: string | null
  interactionType?: string
  title?: string | null
  body?: string | null
  scheduledAt?: string | null
  /**
   * Historical timestamp for completed activities (status `done`). Required for
   * the edit prefill to restore the original date/time instead of falling back
   * to "today" (#1807).
   */
  occurredAt?: string | null
  durationMinutes?: number | null
  /** Interaction priority column (0-100, nullable) backing the task priority control (#5943). */
  priority?: number | null
  location?: string | null
  allDay?: boolean | null
  recurrenceRule?: string | null
  recurrenceEnd?: string | null
  participants?: Array<{ userId?: string; name?: string; email?: string; status?: string }> | null
  reminderMinutes?: number | null
  visibility?: string | null
  linkedEntities?: Array<{ id: string; type: string; label: string }> | null
  guestPermissions?: { canInviteOthers?: boolean; canModify?: boolean; canSeeList?: boolean } | null
}

export const PARTICIPANT_COLORS = [
  'bg-chart-emerald',
  'bg-chart-blue',
  'bg-chart-orange',
  'bg-chart-violet',
  'bg-chart-pink',
  'bg-chart-teal',
]

// Per-Figma defaults for the Reminder dropdown when the user picks an activity
// type. Meeting/email keep the standard 15 min; tasks default to 1 day (1440 min)
// because they're plan-ahead artefacts; calls default to 5 min as a stand-in for
// the Figma "After call ends" treatment (which would need a non-numeric sentinel
// in the API contract — tracked as a follow-up).
const DEFAULT_REMINDER_MINUTES: Record<ActivityType, number> = {
  meeting: 15,
  call: 5,
  task: 1440,
  email: 15,
  note: 15,
}

// Create-mode date/time defaults. A fixed morning slot made every activity opened
// later in the day start in the past, so the seed is always computed forward from
// "now" (#5940): tasks are plan-ahead artefacts and default to the end of the
// working day, everything else to the next half-hour slot.
const DEFAULT_SLOT_MINUTES = 30
const TASK_DEFAULT_HOUR = 17
const NEXT_DAY_START_HOUR = 9

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function nextSlotAfter(now: Date): Date {
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + (DEFAULT_SLOT_MINUTES - (next.getMinutes() % DEFAULT_SLOT_MINUTES)))
  if (!isSameLocalDay(next, now)) {
    next.setHours(NEXT_DAY_START_HOUR, 0, 0, 0)
  }
  return next
}

/**
 * Default start moment for a newly created activity of `type`, always strictly
 * after `now` so a brand-new record is never born overdue (#5940).
 */
export function resolveDefaultActivityStart(type: ActivityType, now: Date): Date {
  if (type === 'task') {
    const endOfWorkingDay = new Date(now)
    endOfWorkingDay.setHours(TASK_DEFAULT_HOUR, 0, 0, 0)
    if (endOfWorkingDay.getTime() > now.getTime()) return endOfWorkingDay
  }
  return nextSlotAfter(now)
}

function formatLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function formatLocalTimeInput(date: Date): string {
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`
}

interface UseScheduleFormStateParams {
  open: boolean
  editData: ScheduleActivityEditData | null | undefined
}

export function useScheduleFormState({ open, editData }: UseScheduleFormStateParams) {
  // An empty `id` is the menu-driven "New X" convention — a create with a preset
  // type, not an edit. The save path already reads it this way (`isSaveEdit`), so
  // the seeding below must agree or new records inherit edit-mode fallbacks (#5940).
  const isEditing = Boolean(editData?.id)
  const [initialStart] = React.useState(() => resolveDefaultActivityStart('meeting', new Date()))
  const [activityType, setActivityType] = React.useState<ActivityType>('meeting')
  const [title, setTitle] = React.useState('')
  const [date, setDate] = React.useState(() => formatLocalDateInput(initialStart))
  const [startTime, setStartTime] = React.useState(() => formatLocalTimeInput(initialStart))
  const [duration, setDuration] = React.useState(30)
  const [allDay, setAllDay] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [markdownEnabled, setMarkdownEnabled] = React.useState(true)
  const [location, setLocation] = React.useState('')
  const [reminderMinutes, setReminderMinutes] = React.useState(15)
  const [visibility, setVisibility] = React.useState('team')
  const [participants, setParticipants] = React.useState<Participant[]>([])
  const [linkedEntities, setLinkedEntities] = React.useState<LinkedEntity[]>([])
  const [recurrenceEnabled, setRecurrenceEnabled] = React.useState(false)
  const [recurrenceDays, setRecurrenceDays] = React.useState<boolean[]>([true, false, true, false, false, false, false])
  const [recurrenceEndType, setRecurrenceEndType] = React.useState<'never' | 'count' | 'date'>('never')
  const [recurrenceCount, setRecurrenceCount] = React.useState(8)
  const [recurrenceEndDate, setRecurrenceEndDate] = React.useState('')
  const [conflict, setConflict] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [guestPermissions, setGuestPermissions] = React.useState({ canInviteOthers: true, canModify: false, canSeeList: true })

  React.useEffect(() => {
    if (open) {
      if (editData) {
        // Edit mode: populate from existing interaction
        const resolvedType = (editData.interactionType as ActivityType) ?? 'meeting'
        setActivityType(resolvedType)
        setTitle(editData.title ?? '')
        // For historical activities the canonical timestamp is `occurredAt`; for
        // planned/future ones it's `scheduledAt`. Without this fallback editing a
        // past activity prefilled to "today" instead of its actual moment (#1807).
        // Keep seed values in the user's local timezone, matching the cluster-E
        // local-day convention.
        const sourceTimestamp = editData.occurredAt ?? editData.scheduledAt ?? null
        const seedDate = sourceTimestamp ? new Date(sourceTimestamp) : null
        // No usable timestamp means this is a preset create (or a corrupt row), so
        // fall forward to the create-mode default instead of "now" (#5940).
        const dateForForm =
          seedDate && !Number.isNaN(seedDate.getTime())
            ? seedDate
            : resolveDefaultActivityStart(resolvedType, new Date())
        setDate(formatLocalDateInput(dateForForm))
        setStartTime(formatLocalTimeInput(dateForForm))
        setDuration(editData.durationMinutes ?? 30)
        setAllDay(editData.allDay ?? false)
        setDescription(editData.body ?? '')
        setLocation(editData.location ?? '')
        // Use per-type default when the editData omits an explicit reminder
        // (the menu-driven "New X" flow opens the dialog with `reminderMinutes: null`).
        setReminderMinutes(editData.reminderMinutes ?? DEFAULT_REMINDER_MINUTES[resolvedType])
        setVisibility(editData.visibility ?? 'team')
        setParticipants(
          Array.isArray(editData.participants)
            ? editData.participants.map((p, i) => ({
                userId: p.userId,
                name: p.name ?? p.email ?? p.userId ?? '',
                email: p.email,
                color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
                status: (p.status ?? 'pending') as RsvpStatus,
              }))
            : [],
        )
        setLinkedEntities(
          Array.isArray(editData.linkedEntities)
            ? editData.linkedEntities.map((e) => ({ id: e.id, type: e.type as LinkedEntity['type'], label: e.label }))
            : [],
        )
        if (editData.recurrenceRule) {
          setRecurrenceEnabled(true)
          // Parse RRULE to set days and end type
          const rule = editData.recurrenceRule
          const byDayMatch = rule.match(/BYDAY=([A-Z,]+)/)
          if (byDayMatch) {
            const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
            const activeDays = byDayMatch[1].split(',')
            setRecurrenceDays(dayNames.map((d) => activeDays.includes(d)))
          }
          const countMatch = rule.match(/COUNT=(\d+)/)
          const untilMatch = rule.match(/UNTIL=(\d{8})/)
          if (countMatch) {
            setRecurrenceEndType('count')
            setRecurrenceCount(Number(countMatch[1]))
          } else if (untilMatch) {
            setRecurrenceEndType('date')
            const raw = untilMatch[1]
            setRecurrenceEndDate(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`)
          } else {
            setRecurrenceEndType('never')
          }
        } else {
          setRecurrenceEnabled(false)
        }
        if (editData.guestPermissions) {
          setGuestPermissions({
            canInviteOthers: editData.guestPermissions.canInviteOthers ?? true,
            canModify: editData.guestPermissions.canModify ?? false,
            canSeeList: editData.guestPermissions.canSeeList ?? true,
          })
        }
      } else {
        // Create mode: reset all fields
        const defaultStart = resolveDefaultActivityStart('meeting', new Date())
        setActivityType('meeting')
        setTitle('')
        setDate(formatLocalDateInput(defaultStart))
        setStartTime(formatLocalTimeInput(defaultStart))
        setDuration(30)
        setAllDay(false)
        setDescription('')
        setLocation('')
        setReminderMinutes(DEFAULT_REMINDER_MINUTES.meeting)
        setVisibility('team')
        setParticipants([])
        setLinkedEntities([])
        setRecurrenceEnabled(false)
      }
      setConflict(null)
    }
    return () => {
      // Safety net: restore body scroll if Radix Dialog fails to clean up
      document.body.style.removeProperty('overflow')
      document.body.style.removeProperty('pointer-events')
    }
  }, [open, editData])

  // Update the Reminder default when the activity type changes in create mode.
  // Skipped in edit mode (the persisted value wins), and gated by `open` to
  // avoid flipping the default in a closed-but-mounted dialog.
  const lastReminderTypeRef = React.useRef<ActivityType>('meeting')
  React.useEffect(() => {
    if (!open || isEditing) {
      lastReminderTypeRef.current = activityType
      return
    }
    if (lastReminderTypeRef.current === activityType) return
    lastReminderTypeRef.current = activityType
    setReminderMinutes(DEFAULT_REMINDER_MINUTES[activityType])
  }, [activityType, isEditing, open])

  const removeParticipant = React.useCallback((index: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const toggleRecurrenceDay = React.useCallback((index: number) => {
    setRecurrenceDays((prev) => {
      const next = [...prev]
      next[index] = !next[index]
      return next
    })
  }, [])

  return {
    activityType,
    setActivityType,
    title,
    setTitle,
    date,
    setDate,
    startTime,
    setStartTime,
    duration,
    setDuration,
    allDay,
    setAllDay,
    description,
    setDescription,
    markdownEnabled,
    setMarkdownEnabled,
    location,
    setLocation,
    reminderMinutes,
    setReminderMinutes,
    visibility,
    setVisibility,
    participants,
    setParticipants,
    linkedEntities,
    setLinkedEntities,
    recurrenceEnabled,
    setRecurrenceEnabled,
    recurrenceDays,
    setRecurrenceDays,
    recurrenceEndType,
    setRecurrenceEndType,
    recurrenceCount,
    setRecurrenceCount,
    recurrenceEndDate,
    setRecurrenceEndDate,
    conflict,
    setConflict,
    saving,
    setSaving,
    guestPermissions,
    setGuestPermissions,
    removeParticipant,
    toggleRecurrenceDay,
  }
}
