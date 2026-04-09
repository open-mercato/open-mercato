'use client'

import * as React from 'react'
import { Users, Phone, Check, Mail, Calendar, MapPin, Link2, AlertTriangle, Clock, Bell, Eye, Repeat, Search, Building2, Briefcase } from 'lucide-react'
import { z } from 'zod'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs'

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

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const searchParam = query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''
    readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
      `/api/staff/team-members?pageSize=10&isActive=true${searchParam}`,
      { signal: controller.signal },
    )
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : []
        const mapped: Array<{ userId: string; name: string; email: string }> = []
        for (const item of items) {
          const userId = typeof item?.userId === 'string' ? item.userId : typeof item?.user_id === 'string' ? item.user_id : null
          if (!userId) continue
          const user = item?.user && typeof item.user === 'object' ? (item.user as Record<string, unknown>) : null
          const name = typeof item?.displayName === 'string' ? item.displayName : typeof item?.display_name === 'string' ? item.display_name : (user && typeof user.email === 'string' ? user.email : userId)
          const email = user && typeof user.email === 'string' ? user.email : ''
          mapped.push({ userId, name, email })
        }
        setResults(mapped)
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs border-dashed">
          <Users className="mr-1 size-3" />
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
          {!loading && results.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.noResults', 'No results')}</p>}
          {results.map((r) => {
            const alreadyAdded = existingIds.has(r.userId)
            return (
              <button
                key={r.userId}
                type="button"
                disabled={alreadyAdded}
                onClick={() => {
                  onAdd({ userId: r.userId, name: r.name, email: r.email, color: PARTICIPANT_COLORS[existingIds.size % PARTICIPANT_COLORS.length] })
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  alreadyAdded ? 'opacity-40 cursor-default' : 'hover:bg-accent cursor-pointer',
                )}
              >
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold shrink-0">
                  {r.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.email && <span className="text-xs text-muted-foreground truncate">{r.email}</span>}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const ENTITY_LINK_TYPES = ['company', 'deal'] as const

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
  const [linkType, setLinkType] = React.useState<'company' | 'deal'>('company')
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
      : `/api/customers/deals?pageSize=10${searchParam}`
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
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs border-dashed">
          + {t('customers.schedule.addLink', 'Add link')}
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
              onClick={() => { setLinkType(type); setQuery('') }}
            >
              {type === 'company' ? <Building2 className="mr-1 size-3" /> : <Briefcase className="mr-1 size-3" />}
              {type === 'company' ? t('customers.schedule.linkType.company', 'Company') : t('customers.schedule.linkType.deal', 'Deal')}
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
              <button
                key={r.id}
                type="button"
                disabled={alreadyLinked}
                onClick={() => {
                  onAdd({ id: r.id, type: linkType, label: r.label })
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  alreadyLinked ? 'opacity-40 cursor-default' : 'hover:bg-accent cursor-pointer',
                )}
              >
                {linkType === 'company' ? <Building2 className="size-3.5 text-muted-foreground shrink-0" /> : <Briefcase className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative'

interface ScheduleActivityDialogProps {
  open: boolean
  onClose: () => void
  entityId: string
  entityName?: string
  companyName?: string | null
  entityType: 'company' | 'person' | 'deal'
  onActivityCreated?: () => void
}

export function ScheduleActivityDialog({
  open,
  onClose,
  entityId,
  entityName,
  companyName,
  entityType,
  onActivityCreated,
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
      setRecurrenceEnabled(false)
      setConflict(null)
    }
  }, [open])

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

      await apiCallOrThrow('/api/customers/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
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
      onActivityCreated?.()
      onClose()
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
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('customers.schedule.title', 'Schedule activity')}</DialogTitle>
          {entityName && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="inline-block size-2 rounded-full bg-emerald-500 shrink-0" />
              {t('customers.schedule.context', 'On timeline: {{name}}', { name: entityName })}
              {companyName && <span>· {companyName}</span>}
            </p>
          )}
        </DialogHeader>

        {/* Conflict warning */}
        {conflict && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {t('customers.schedule.conflict.title', 'Calendar conflict')}
              </p>
              <p className="text-amber-700 dark:text-amber-300 mt-0.5">{conflict}</p>
            </div>
          </div>
        )}

        {/* Type tabs */}
        <div className="flex gap-1 rounded-lg border p-1">
          {TYPE_TABS.map(({ type, icon: Icon, labelKey, fallback }) => (
            <Button
              key={type}
              type="button"
              variant={activityType === type ? 'default' : 'ghost'}
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setActivityType(type)}
            >
              <Icon className="size-4" />
              {t(labelKey, fallback)}
            </Button>
          ))}
        </div>

        {/* Title */}
        <div>
          <label className="text-sm font-medium">{t('customers.schedule.titleLabel', 'Title')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('customers.schedule.titlePlaceholder', 'Activity title...')}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
        </div>

        {/* Date / Time / Duration */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">{t('customers.schedule.date', 'Date')}</label>
            <div className="mt-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              <Calendar className="size-4 text-muted-foreground" />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-transparent focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">{t('customers.schedule.start', 'Start')}</label>
            <div className="mt-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={allDay} className="flex-1 bg-transparent focus:outline-none disabled:opacity-50" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">{t('customers.schedule.duration', 'Duration')}</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={allDay}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              {DURATION_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        </div>

        {/* All day + timezone + recurrence */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="rounded" />
            {t('customers.schedule.allDay', 'All day')}
          </label>
          <span>·</span>
          <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
          <span>·</span>
          <button
            type="button"
            onClick={() => setRecurrenceEnabled(!recurrenceEnabled)}
            className={cn('flex items-center gap-1', recurrenceEnabled && 'text-primary font-medium')}
          >
            <Repeat className="size-3.5" />
            {recurrenceEnabled
              ? t('customers.schedule.recurrence.active', 'Repeats')
              : t('customers.schedule.recurrence.none', 'No repeat')}
          </button>
        </div>

        {/* Recurrence config */}
        {recurrenceEnabled && (
          <div className="rounded-lg border border-[#e2e8a0] bg-[#fafde8] p-4 space-y-3 dark:border-[#4a4f20] dark:bg-[#2a2d10]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Repeat className="size-4" />
                {t('customers.schedule.recurrence.title', 'Recurrence')}
              </span>
            </div>
            <div className="flex gap-1.5">
              {DAYS_OF_WEEK.map((day, i) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleRecurrenceDay(i)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-xs font-medium transition-colors',
                    recurrenceDays[i] ? 'bg-foreground text-background' : 'bg-muted hover:bg-accent',
                  )}
                >
                  {day.slice(0, 2)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>{t('customers.schedule.recurrence.ends', 'Ends')}:</span>
              <Button type="button" variant={recurrenceEndType === 'never' ? 'default' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setRecurrenceEndType('never')}>
                {t('customers.schedule.recurrence.never', 'Never')}
              </Button>
              <Button type="button" variant={recurrenceEndType === 'count' ? 'default' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setRecurrenceEndType('count')}>
                {t('customers.schedule.recurrence.afterCount', 'After {{count}} occurrences', { count: recurrenceCount })}
              </Button>
              <Button type="button" variant={recurrenceEndType === 'date' ? 'default' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setRecurrenceEndType('date')}>
                {recurrenceEndDate || t('customers.schedule.recurrence.onDate', 'On date')}
              </Button>
            </div>
          </div>
        )}

        {/* Participants */}
        {(activityType === 'meeting' || activityType === 'call') && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('customers.schedule.participants', 'Participants')}
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {participants.map((p) => (
                <Badge key={p.userId} variant="secondary" className="gap-1.5 pl-1">
                  <span className={cn('inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white', p.color ?? 'bg-primary')}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  {p.name}
                  <button type="button" onClick={() => removeParticipant(p.userId)} className="ml-0.5 text-muted-foreground hover:text-foreground">×</button>
                </Badge>
              ))}
              <ParticipantSearchPopover
                existingIds={new Set(participants.map((p) => p.userId))}
                onAdd={(p) => setParticipants((prev) => [...prev, { ...p, status: 'pending' as RsvpStatus }])}
                t={t}
              />
            </div>

            {/* Guest permissions — shown when participants exist */}
            {participants.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="text-muted-foreground font-medium">{t('customers.schedule.guestPermissions', 'Guest permissions:')}</span>
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
              return (
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{t('customers.schedule.rsvp.label', 'Responses:')}</span>
                  {accepted > 0 && <span className="flex items-center gap-1 text-emerald-600 font-medium">✓ {accepted} {t('customers.schedule.rsvp.accepted', 'accepted')}</span>}
                  {pending > 0 && <span className="flex items-center gap-1 text-amber-500 font-medium">⏳ {pending} {t('customers.schedule.rsvp.pending', 'pending')}</span>}
                  {declined > 0 && <span className="flex items-center gap-1 text-red-500 font-medium">✕ {declined} {t('customers.schedule.rsvp.declined', 'declined')}</span>}
                </div>
              )
            })()}
          </div>
        )}

        {/* Location */}
        <div>
          <label className="text-sm font-medium">{t('customers.schedule.location', 'Location')}</label>
          <div className="mt-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
            <MapPin className="size-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('customers.schedule.locationPlaceholder', 'Add location or meeting link...')}
              className="flex-1 bg-transparent focus:outline-none"
            />
          </div>
        </div>

        {/* Linked entities */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('customers.schedule.linkedEntities', 'Linked entities')}
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {linkedEntities.map((entity) => (
              <Badge
                key={entity.id}
                variant="outline"
                className={cn(
                  'gap-1.5',
                  entity.type === 'deal' && 'border-[#c5e847] bg-[#fafde8] dark:border-[#7a9a1a] dark:bg-[#2a2d10]',
                )}
              >
                {entity.type === 'company' ? <Building2 className="size-3" /> : entity.type === 'deal' ? <Briefcase className="size-3" /> : <Link2 className="size-3" />}
                {entity.label}
                <button type="button" onClick={() => setLinkedEntities((prev) => prev.filter((e) => e.id !== entity.id))} className="ml-0.5 text-muted-foreground hover:text-foreground">×</button>
              </Badge>
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
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('customers.schedule.description', 'Description')}
          </label>
          <div className="mt-1">
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">
              <Bell className="mr-1 inline size-3.5" />
              {t('customers.schedule.reminder', 'Reminder')}
            </label>
            <select
              value={reminderMinutes}
              onChange={(e) => setReminderMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {REMINDER_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t('customers.schedule.reminder.none', 'None') : `${m} min`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">
              <Eye className="mr-1 inline size-3.5" />
              {t('customers.schedule.visibility', 'Visibility')}
            </label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="team">{t('customers.schedule.visibility.team', 'Team only')}</option>
              <option value="public">{t('customers.schedule.visibility.public', 'Public')}</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('customers.schedule.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !title.trim()}>
            <Calendar className="mr-1.5 size-4" />
            {saving
              ? t('customers.schedule.saving', 'Saving...')
              : t('customers.schedule.save', 'Save activity')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
