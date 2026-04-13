'use client'

import * as React from 'react'
import { Users, Phone, Check, Mail, Calendar, MapPin, Link2, AlertTriangle, Clock, Bell, Eye, Repeat, Search, Building2, Briefcase, FileText, Globe, X, ChevronDown, CheckCircle2, XCircle } from 'lucide-react'
import { z } from 'zod'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs'
import { fetchAssignableStaffMembers } from './assignableStaff'

type ActivityType = 'meeting' | 'call' | 'task' | 'email'

const TYPE_TABS: Array<{ type: ActivityType; icon: React.ComponentType<{ className?: string }>; labelKey: string; fallback: string }> = [
  { type: 'meeting', icon: Users, labelKey: 'customers.schedule.types.meeting', fallback: 'Meeting' },
  { type: 'call', icon: Phone, labelKey: 'customers.schedule.types.call', fallback: 'Call' },
  { type: 'task', icon: Check, labelKey: 'customers.schedule.types.task', fallback: 'Task' },
  { type: 'email', icon: Mail, labelKey: 'customers.schedule.types.email', fallback: 'Email' },
]

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]
const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60]
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type Participant = {
  userId: string
  name: string
  email?: string
  color?: string
  status?: RsvpStatus
}

type LinkedEntity = {
  id: string
  type: 'company' | 'deal' | 'offer'
  label: string
}

const PARTICIPANT_COLORS = ['bg-green-500', 'bg-blue-500', 'bg-orange-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500']

function ParticipantSearchPopover({
  existingIds,
  onAdd,
  t,
}: {
  existingIds: Set<string>
  onAdd: (p: Participant) => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Array<{ userId: string; name: string; email: string }>>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    fetchAssignableStaffMembers(query, { pageSize: 10, signal: controller.signal })
      .then((members) => {
        setResults(
          members.map((member) => ({
            userId: member.userId,
            name: member.displayName,
            email: member.email ?? '',
          })),
        )
        setLoadError(null)
      })
      .catch(() => {
        setResults([])
        setLoadError(
          t(
            'customers.assignableStaff.loadError',
            'Unable to load team members. Check your permissions and try again.',
          ),
        )
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, query, t])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-auto inline-flex items-center gap-[6px] rounded-[999px] border border-emerald-300 bg-emerald-50 px-[10px] py-[6px] text-[12px] font-semibold text-foreground">
          <Users className="size-[13px]" />
          {t('customers.schedule.addParticipant', 'Add participant')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 mb-2">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('customers.schedule.searchParticipant', 'Search team members...')}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            autoFocus
          />
        </div>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {loading && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.searching', 'Searching...')}</p>}
          {!loading && loadError && <p className="px-2 py-3 text-xs text-red-700 text-center">{loadError}</p>}
          {!loading && !loadError && results.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.noResults', 'No results')}</p>}
          {results.map((r) => {
            const alreadyAdded = existingIds.has(r.userId)
            return (
              <Button
                key={r.userId}
                type="button"
                variant="ghost"
                size="sm"
                disabled={alreadyAdded}
                onClick={() => {
                  onAdd({ userId: r.userId, name: r.name, email: r.email, color: PARTICIPANT_COLORS[existingIds.size % PARTICIPANT_COLORS.length] })
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'h-auto flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  alreadyAdded ? 'opacity-40 cursor-default' : 'hover:bg-accent cursor-pointer',
                )}
              >
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold shrink-0">
                  {r.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.email && <span className="text-xs text-muted-foreground truncate">{r.email}</span>}
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const ENTITY_LINK_TYPES = ['company', 'deal', 'offer'] as const

function EntityLinkSearchPopover({
  existingIds,
  onAdd,
  t,
}: {
  existingIds: Set<string>
  onAdd: (entity: LinkedEntity) => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const [linkType, setLinkType] = React.useState<'company' | 'deal' | 'offer'>('company')
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Array<{ id: string; label: string }>>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const searchParam = query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''
    const endpoint = linkType === 'company'
      ? `/api/customers/companies?pageSize=10${searchParam}`
      : linkType === 'deal'
        ? `/api/customers/deals?pageSize=10${searchParam}`
        : `/api/sales/quotes?pageSize=10${searchParam}`
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(endpoint, { signal: controller.signal })
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : []
        setResults(items.map((item) => ({
          id: typeof item?.id === 'string' ? item.id : '',
          label: typeof item?.display_name === 'string' ? item.display_name
            : typeof item?.displayName === 'string' ? item.displayName
            : typeof item?.title === 'string' ? item.title
            : typeof item?.name === 'string' ? item.name
            : String(item?.id ?? ''),
        })).filter((r) => r.id))
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, query, linkType])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-auto inline-flex items-center gap-[6px] rounded-[999px] border border-border bg-white px-[10px] py-[6px] text-[12px] text-muted-foreground">
          <span className="text-[13px]">+</span>
          {t('customers.schedule.addLink', 'Add link')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex gap-1 mb-2">
          {ENTITY_LINK_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              variant={linkType === type ? 'default' : 'ghost'}
              size="sm"
              className="h-6 text-xs flex-1"
              onClick={() => { setLinkType(type as typeof linkType); setQuery('') }}
            >
              {type === 'company' ? <Building2 className="mr-1 size-3" /> : type === 'deal' ? <Briefcase className="mr-1 size-3" /> : <FileText className="mr-1 size-3" />}
              {type === 'company' ? t('customers.schedule.linkType.company', 'Company') : type === 'deal' ? t('customers.schedule.linkType.deal', 'Deal') : t('customers.schedule.linkType.offer', 'Offer')}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 mb-2">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('customers.schedule.searchEntity', 'Search...')}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            autoFocus
          />
        </div>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {loading && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.searching', 'Searching...')}</p>}
          {!loading && results.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.noResults', 'No results')}</p>}
          {results.map((r) => {
            const alreadyLinked = existingIds.has(r.id)
            return (
              <Button
                key={r.id}
                type="button"
                variant="ghost"
                size="sm"
                disabled={alreadyLinked}
                onClick={() => {
                  onAdd({ id: r.id, type: linkType, label: r.label })
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'h-auto flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  alreadyLinked ? 'opacity-40 cursor-default' : 'hover:bg-accent cursor-pointer',
                )}
              >
                {linkType === 'company' ? <Building2 className="size-3.5 text-muted-foreground shrink-0" /> : linkType === 'deal' ? <Briefcase className="size-3.5 text-muted-foreground shrink-0" /> : <FileText className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative'

type ScheduleActivityEditData = {
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

interface ScheduleActivityDialogProps {
  open: boolean
  onClose: () => void
  entityId: string
  entityName?: string
  companyName?: string | null
  entityType: 'company' | 'person' | 'deal'
  onActivityCreated?: () => void
  /** When provided, dialog opens in edit mode with pre-filled data */
  editData?: ScheduleActivityEditData | null
}

export function ScheduleActivityDialog({
  open,
  onClose,
  entityId,
  entityName,
  companyName,
  entityType,
  onActivityCreated,
  editData,
}: ScheduleActivityDialogProps) {
  const t = useT()
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
        setActivityType((editData.interactionType as ActivityType) ?? 'meeting')
        setTitle(editData.title ?? '')
        const scheduledDate = editData.scheduledAt ? new Date(editData.scheduledAt) : new Date()
        setDate(scheduledDate.toISOString().slice(0, 10))
        setStartTime(scheduledDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
        setDuration(editData.durationMinutes ?? 30)
        setAllDay(editData.allDay ?? false)
        setDescription(editData.body ?? '')
        setLocation(editData.location ?? '')
        setReminderMinutes(editData.reminderMinutes ?? 15)
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
        setReminderMinutes(15)
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

  // Conflict detection — debounced check when date/time/duration changes
  React.useEffect(() => {
    if (!open || allDay || !date || !startTime) {
      setConflict(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          date,
          startTime,
          duration: String(duration),
        })
        const data = await readApiResultOrThrow<{
          hasConflicts: boolean
          conflicts: Array<{ id: string; title: string | null; startTime: string; endTime: string; type: string }>
        }>(`/api/customers/interactions/conflicts?${params.toString()}`)
        if (data?.hasConflicts && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
          const descriptions = data.conflicts
            .map((c) => `${c.startTime}–${c.endTime}: ${c.title ?? c.type}`)
            .join(', ')
          setConflict(
            t('customers.schedule.conflict.description', 'Overlaps with: {{items}}', { items: descriptions }),
          )
        } else {
          setConflict(null)
        }
      } catch {
        setConflict(null)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [open, date, startTime, duration, allDay, t])

  const handleSave = React.useCallback(async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      const scheduledAt = allDay
        ? new Date(`${date}T00:00:00`).toISOString()
        : new Date(`${date}T${startTime}:00`).toISOString()

      const recurrenceRule = recurrenceEnabled
        ? buildRecurrenceRule(recurrenceDays, recurrenceEndType, recurrenceCount, recurrenceEndDate)
        : null

      const isEditing = Boolean(editData?.id)
      await apiCallOrThrow('/api/customers/interactions', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { id: editData!.id } : {}),
          entityId,
          interactionType: activityType,
          title: title.trim(),
          body: description.trim() || null,
          status: 'planned',
          scheduledAt,
          durationMinutes: allDay ? null : duration,
          location: location.trim() || null,
          allDay,
          recurrenceRule,
          recurrenceEnd: recurrenceEndType === 'date' && recurrenceEndDate
            ? new Date(recurrenceEndDate).toISOString()
            : null,
          participants: participants.length > 0
            ? participants.map((p) => ({ userId: p.userId, name: p.name, email: p.email, status: p.status ?? 'pending' }))
            : null,
          guestPermissions: participants.length > 0 ? guestPermissions : null,
          linkedEntities: linkedEntities.length > 0
            ? linkedEntities.map((e) => ({ id: e.id, type: e.type, label: e.label }))
            : null,
          reminderMinutes,
          visibility,
        }),
      })
      flash(t('customers.schedule.saved', 'Activity scheduled'), 'success')
      onClose()
      // Delay data reload so the dialog can unmount cleanly and Radix restores body scroll
      requestAnimationFrame(() => { onActivityCreated?.() })
    } catch {
      flash(t('customers.schedule.error', 'Failed to schedule activity'), 'error')
    } finally {
      setSaving(false)
    }
  }, [activityType, allDay, date, description, duration, entityId, location, onActivityCreated, onClose, participants, recurrenceCount, recurrenceDays, recurrenceEnabled, recurrenceEndDate, recurrenceEndType, reminderMinutes, startTime, t, title, visibility])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden border-border p-0 shadow-xl sm:max-w-[680px] sm:rounded-[16px] [&>[data-dialog-close]]:hidden" onKeyDown={handleKeyDown} aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>{editData ? t('customers.schedule.editTitle', 'Edit activity') : t('customers.schedule.title', 'Schedule activity')}</DialogTitle>
        </VisuallyHidden>
        <div className="flex shrink-0 items-start justify-between gap-[12px] border-b border-border bg-white px-[24px] py-[20px]">
          <div className="flex flex-col gap-[6px]">
            <h2 className="text-[18px] font-bold leading-tight text-foreground">
              {editData ? t('customers.schedule.editTitle', 'Edit activity') : t('customers.schedule.title', 'Schedule activity')}
            </h2>
            {entityName && (
              <div className="flex items-center gap-[6px]">
                <span className="inline-block size-[14px] rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[12px] text-muted-foreground">
                  {t('customers.schedule.context', 'On timeline: {{name}}', { name: entityName })}
                  {companyName && ` · ${companyName}`}
                </span>
              </div>
            )}
          </div>
          <IconButton type="button" variant="ghost" size="sm" onClick={onClose} className="flex size-[36px] shrink-0 items-center justify-center rounded-[8px] border border-border bg-white" aria-label={t('customers.schedule.cancel', 'Cancel')}>
            <X className="size-[16px] text-muted-foreground" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-[18px] bg-white p-[24px]">

        {/* Conflict warning */}
        {conflict && (
          <div className="flex items-start gap-[12px] rounded-[12px] border border-amber-200 bg-amber-50 px-[16px] py-[14px]">
            <AlertTriangle className="size-[18px] shrink-0 text-destructive mt-0.5" />
            <div>
              <p className="text-[13px] font-bold text-destructive">
                {t('customers.schedule.conflict.title', 'Calendar conflict')}
              </p>
              <p className="text-[12px] text-muted-foreground mt-[4px]">{conflict}</p>
            </div>
          </div>
        )}

        {/* Type tabs */}
        <div className="flex gap-[2px] rounded-[10px] border border-border bg-muted p-[4px]">
          {TYPE_TABS.map(({ type, icon: Icon, labelKey, fallback }) => {
            const isActive = activityType === type
            return (
              <Button
                key={type}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setActivityType(type)}
                className={cn(
                  'h-auto flex items-center gap-[8px] rounded-[8px] px-[14px] py-[9px] text-[13px] transition-colors',
                  isActive
                    ? 'bg-white font-semibold text-foreground shadow-sm'
                    : 'bg-transparent font-normal text-muted-foreground',
                )}
              >
                <Icon className="size-[14px]" />
                {t(labelKey, fallback)}
              </Button>
            )
          })}
        </div>

        {/* Title */}
        <div className="flex flex-col gap-[6px]">
          <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.titleLabel', 'Title')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('customers.schedule.titlePlaceholder', 'Activity title...')}
            className="w-full rounded-[8px] border border-border bg-white px-[12px] py-[10px] text-[13px] text-foreground outline-none focus:border-foreground"
            autoFocus
          />
        </div>

        {/* Date / Time / Duration */}
        <div className="flex gap-[12px]">
          <div className="flex flex-[2] flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.date', 'Date')}</label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-white px-[12px] py-[10px]">
              <Calendar className="size-[14px] text-muted-foreground" />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-transparent text-[13px] text-foreground focus:outline-none" />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.start', 'Start')}</label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-white px-[12px] py-[10px]">
              <Clock className="size-[14px] text-muted-foreground" />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} className="flex-1 bg-transparent text-[13px] text-foreground focus:outline-none disabled:opacity-50" />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.duration', 'Duration')}</label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-white px-[12px] py-[10px]">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={allDay}
                className="flex-1 appearance-none bg-transparent text-[13px] text-foreground focus:outline-none disabled:opacity-50"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
              <ChevronDown className="size-[14px] text-muted-foreground" />
            </div>
          </div>
        </div>

        {/* All day + timezone + recurrence */}
        <div className="flex flex-wrap items-center gap-[14px] text-[12px] text-muted-foreground">
          <label className="flex items-center gap-[8px] cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="rounded" />
            {t('customers.schedule.allDay', 'All day')}
          </label>
          <span className="text-muted-foreground">·</span>
          <span className="flex items-center gap-[6px]">
            <Globe className="size-[14px]" />
            {Intl.DateTimeFormat().resolvedOptions().timeZone} (GMT{new Date().getTimezoneOffset() <= 0 ? '+' : '-'}{String(Math.abs(Math.floor(new Date().getTimezoneOffset() / 60))).padStart(1, '0')})
          </span>
          <span className="text-muted-foreground">·</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRecurrenceEnabled(!recurrenceEnabled)}
            className={cn('h-auto flex items-center gap-[6px]', recurrenceEnabled && 'font-medium text-foreground')}
          >
            <Repeat className="size-[14px]" />
            {recurrenceEnabled
              ? t('customers.schedule.recurrence.active', 'Repeats')
              : t('customers.schedule.recurrence.none', 'No repeat')}
          </Button>
        </div>

        {/* Recurrence config */}
        {recurrenceEnabled && (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-[16px] space-y-[12px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-[8px] text-[13px] font-semibold text-foreground">
                <Repeat className="size-[14px]" />
                {t('customers.schedule.recurrence.title', 'Recurrence')}
              </span>
              <Button type="button" variant="ghost" size="sm" className="h-auto text-[12px] font-medium text-foreground">
                {t('customers.schedule.recurrence.edit', 'Edit')}
              </Button>
            </div>
            <div className="flex gap-[8px]">
              {DAYS_OF_WEEK.map((day, i) => (
                <Button
                  key={day}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleRecurrenceDay(i)}
                  className={cn(
                    'h-auto flex size-[32px] items-center justify-center rounded-full text-[11px] font-medium transition-colors p-0',
                    recurrenceDays[i] ? 'bg-foreground text-white' : 'border border-border bg-white text-muted-foreground hover:bg-muted',
                  )}
                >
                  {day.slice(0, 2)}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-[8px] text-[12px] text-muted-foreground">
              <span>{t('customers.schedule.recurrence.ends', 'Ends')}:</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('never')} className={cn('h-auto rounded-full px-[12px] py-[4px] text-[11px] font-medium', recurrenceEndType === 'never' ? 'bg-white border border-border text-foreground' : 'text-muted-foreground')}>
                {t('customers.schedule.recurrence.never', 'Never')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('count')} className={cn('h-auto rounded-full px-[12px] py-[4px] text-[11px] font-medium', recurrenceEndType === 'count' ? 'bg-foreground text-white' : 'text-muted-foreground')}>
                {t('customers.schedule.recurrence.afterCount', 'After {{count}} occurrences', { count: recurrenceCount })}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRecurrenceEndType('date')} className={cn('h-auto rounded-full px-[12px] py-[4px] text-[11px] font-medium', recurrenceEndType === 'date' ? 'bg-white border border-border text-foreground' : 'text-muted-foreground')}>
                {recurrenceEndDate || t('customers.schedule.recurrence.onDate', 'On date')}
              </Button>
            </div>
          </div>
        )}

        {/* Participants */}
        {(activityType === 'meeting' || activityType === 'call') && (
          <div>
            <label className="text-[11px] font-semibold uppercase text-muted-foreground tracking-[0.5px]">
              {t('customers.schedule.participants', 'Participants')}
            </label>
            <div className="mt-[10px] flex flex-wrap content-center items-center gap-[8px] rounded-[10px] border border-border bg-white px-[12px] py-[10px]">
              {participants.map((p) => (
                <div key={p.userId} className="inline-flex items-center gap-[6px] rounded-[999px] border border-border bg-muted px-[10px] py-[6px]">
                  <span className={cn('inline-flex size-[20px] items-center justify-center rounded-full text-[10px] font-bold text-white', p.color ?? 'bg-primary')}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-[12px] text-foreground">{p.name}</span>
                  <IconButton type="button" variant="ghost" size="sm" onClick={() => removeParticipant(p.userId)} className="h-auto text-muted-foreground hover:text-foreground p-0" aria-label={t('customers.schedule.removeParticipant', 'Remove participant')}>
                    <X className="size-[12px]" />
                  </IconButton>
                </div>
              ))}
              <ParticipantSearchPopover
                existingIds={new Set(participants.map((p) => p.userId))}
                onAdd={(p) => setParticipants((prev) => [...prev, { ...p, status: 'pending' as RsvpStatus }])}
                t={t}
              />
            </div>

            {/* Guest permissions — shown when participants exist */}
            {participants.length > 0 && (
              <div className="mt-[12px] flex flex-wrap items-center gap-x-[16px] gap-y-[6px] text-[12px]">
                <span className="font-medium text-muted-foreground">{t('customers.schedule.guestPermissions', 'Guest permissions:')}</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={guestPermissions.canInviteOthers} onChange={(e) => setGuestPermissions((p) => ({ ...p, canInviteOthers: e.target.checked }))} className="rounded" />
                  {t('customers.schedule.guestPerm.invite', 'Invite others')}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={guestPermissions.canModify} onChange={(e) => setGuestPermissions((p) => ({ ...p, canModify: e.target.checked }))} className="rounded" />
                  {t('customers.schedule.guestPerm.modify', 'Modify')}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={guestPermissions.canSeeList} onChange={(e) => setGuestPermissions((p) => ({ ...p, canSeeList: e.target.checked }))} className="rounded" />
                  {t('customers.schedule.guestPerm.seeList', 'See list')}
                </label>
              </div>
            )}

            {/* RSVP summary — shown when participants exist */}
            {participants.length > 0 && (() => {
              const accepted = participants.filter((p) => p.status === 'accepted').length
              const pending = participants.filter((p) => !p.status || p.status === 'pending').length
              const declined = participants.filter((p) => p.status === 'declined').length
              if (accepted === 0 && pending === 0 && declined === 0) return null
              return (
                <div className="mt-[8px] flex items-center gap-[12px] text-[12px]">
                  <span className="text-muted-foreground">{t('customers.schedule.rsvp.label', 'Responses:')}</span>
                  {accepted > 0 && <span className="flex items-center gap-[4px] font-medium text-green-600"><CheckCircle2 className="size-[14px]" /> {accepted} {t('customers.schedule.rsvp.accepted', 'tak')}</span>}
                  {pending > 0 && <span className="flex items-center gap-[4px] font-medium text-amber-500"><Clock className="size-[14px]" /> {pending} {t('customers.schedule.rsvp.pending', 'czeka')}</span>}
                  {declined > 0 && <span className="flex items-center gap-[4px] font-medium text-red-500"><XCircle className="size-[14px]" /> {declined} {t('customers.schedule.rsvp.declined', 'nie')}</span>}
                </div>
              )
            })()}
          </div>
        )}

        {/* Location */}
        <div className="flex flex-col gap-[6px]">
          <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">{t('customers.schedule.location', 'Location')}</label>
          <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-white px-[12px] py-[10px]">
            <MapPin className="size-[14px] text-muted-foreground shrink-0" />
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('customers.schedule.locationPlaceholder', 'Add location or meeting link...')}
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>

        {/* Linked entities */}
        <div>
          <label className="text-[11px] font-semibold uppercase text-muted-foreground tracking-[0.5px]">
            {t('customers.schedule.linkedEntities', 'Linked entities')}
          </label>
          <div className="mt-[10px] flex flex-wrap content-center items-center gap-[8px]">
            {linkedEntities.map((entity) => (
              <div
                key={entity.id}
                className={cn(
                  'inline-flex items-center gap-[6px] rounded-[999px] border px-[10px] py-[6px] text-[12px]',
                  entity.type === 'deal'
                    ? 'border-emerald-300 bg-emerald-50 font-semibold text-foreground'
                    : 'border-border bg-muted text-foreground',
                )}
              >
                {entity.type === 'company' ? <Building2 className="size-[13px]" /> : entity.type === 'deal' ? <Briefcase className="size-[13px]" /> : <FileText className="size-[13px]" />}
                {entity.label}
                <IconButton type="button" variant="ghost" size="sm" onClick={() => setLinkedEntities((prev) => prev.filter((e) => e.id !== entity.id))} className="h-auto text-muted-foreground hover:text-foreground p-0" aria-label={t('customers.schedule.removeLink', 'Remove link')}>
                  <X className="size-[10px]" />
                </IconButton>
              </div>
            ))}
            <EntityLinkSearchPopover
              existingIds={new Set(linkedEntities.map((e) => e.id))}
              onAdd={(entity) => setLinkedEntities((prev) => [...prev, entity])}
              t={t}
            />
          </div>
        </div>

        {/* Description — rich text with markdown */}
        <div>
          <label className="text-[11px] font-semibold uppercase text-muted-foreground tracking-[0.5px]">
            {t('customers.schedule.description', 'Description')}
          </label>
          <div className="mt-[8px]">
            <SwitchableMarkdownInput
              value={description}
              onChange={setDescription}
              isMarkdownEnabled={markdownEnabled}
              height={120}
              placeholder={t('customers.schedule.descriptionPlaceholder', 'Add details...')}
            />
          </div>
        </div>

        {/* Reminder + Visibility */}
        <div className="flex gap-[12px]">
          <div className="flex flex-1 flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">
              {t('customers.schedule.reminder', 'Reminder')}
            </label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-white px-[12px] py-[10px]">
              <Bell className="size-[14px] text-muted-foreground" />
              <select
                value={reminderMinutes}
                onChange={(e) => setReminderMinutes(Number(e.target.value))}
                className="flex-1 appearance-none bg-transparent text-[13px] text-foreground focus:outline-none"
              >
                {REMINDER_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? t('customers.schedule.reminder.none', 'None') : `${m} min`}
                  </option>
                ))}
              </select>
              <ChevronDown className="size-[14px] text-muted-foreground" />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-[6px]">
            <label className="text-[11px] font-semibold text-muted-foreground tracking-[0.5px]">
              {t('customers.schedule.visibility', 'Visibility')}
            </label>
            <div className="flex items-center gap-[8px] rounded-[8px] border border-border bg-white px-[12px] py-[10px]">
              <Eye className="size-[14px] text-muted-foreground" />
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="flex-1 appearance-none bg-transparent text-[13px] text-foreground focus:outline-none"
              >
                <option value="team">{t('customers.schedule.visibility.team', 'Team only')}</option>
                <option value="public">{t('customers.schedule.visibility.public', 'Public')}</option>
              </select>
              <ChevronDown className="size-[14px] text-muted-foreground" />
            </div>
          </div>
        </div>

        </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-[10px] border-t border-border bg-muted/50 px-[24px] py-[18px]">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-[10px] border border-input bg-white px-[20px] py-[11px] text-[13px] font-semibold text-foreground">
            {t('customers.schedule.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !title.trim()} className="flex items-center gap-[8px] rounded-[10px] bg-foreground px-[22px] py-[11px] text-[13px] font-semibold text-white disabled:opacity-50">
            <Calendar className="size-[14px]" />
            {saving
              ? t('customers.schedule.saving', 'Saving...')
              : editData
                ? t('customers.schedule.update', 'Update activity')
                : t('customers.schedule.save', 'Save activity')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export type { ScheduleActivityEditData }

function buildRecurrenceRule(
  days: boolean[],
  endType: 'never' | 'count' | 'date',
  count: number,
  endDate: string,
): string {
  const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
  const selectedDays = days.map((active, i) => (active ? dayNames[i] : null)).filter(Boolean)
  let rule = `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')}`
  if (endType === 'count') rule += `;COUNT=${count}`
  if (endType === 'date' && endDate) rule += `;UNTIL=${endDate.replace(/-/g, '')}T235959Z`
  return rule
}
