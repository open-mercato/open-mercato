import * as React from 'react'
import type { ActivityType } from './fieldConfig'

export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative'

export type Participant = {
  userId: string
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
  interactionType?: string
  title?: string | null
  body?: string | null
  scheduledAt?: string | null
  durationMinutes?: number | null
  location?: string | null
  allDay?: boolean | null
  recurrenceRule?: string | null
  recurrenceEnd?: string | null
  participants?: Array<{ userId: string; name?: string; email?: string; status?: string }> | null
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
}

interface UseScheduleFormStateParams {
  open: boolean
  editData: ScheduleActivityEditData | null | undefined
}

export function useScheduleFormState({ open, editData }: UseScheduleFormStateParams) {
  const [activityType, setActivityType] = React.useState<ActivityType>('meeting')
  const [title, setTitle] = React.useState('')
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = React.useState('10:00')
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
        const scheduledDate = editData.scheduledAt ? new Date(editData.scheduledAt) : new Date()
        setDate(scheduledDate.toISOString().slice(0, 10))
        setStartTime(scheduledDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
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
                name: p.name ?? p.userId,
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
        setActivityType('meeting')
        setTitle('')
        setDate(new Date().toISOString().slice(0, 10))
        setStartTime('10:00')
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
    if (!open || editData) {
      lastReminderTypeRef.current = activityType
      return
    }
    if (lastReminderTypeRef.current === activityType) return
    lastReminderTypeRef.current = activityType
    setReminderMinutes(DEFAULT_REMINDER_MINUTES[activityType])
  }, [activityType, editData, open])

  const removeParticipant = React.useCallback((userId: string) => {
    setParticipants((prev) => prev.filter((p) => p.userId !== userId))
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
