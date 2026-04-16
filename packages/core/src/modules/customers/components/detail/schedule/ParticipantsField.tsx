'use client'

import * as React from 'react'
import { Users, Search, X, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { fetchAssignableStaffMembersPage } from '../assignableStaff'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible } from './fieldConfig'
import type { Participant, RsvpStatus } from './useScheduleFormState'
import { PARTICIPANT_COLORS } from './useScheduleFormState'

function ParticipantSearchPopover({
  existingIds,
  onAdd,
  onAddMany,
  t,
}: {
  existingIds: Set<string>
  onAdd: (p: Participant) => void
  onAddMany: (participants: Participant[]) => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Array<{ userId: string; name: string; email: string }>>([])
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const selectableResults = React.useMemo(
    () => results.filter((result) => !existingIds.has(result.userId)),
    [existingIds, results],
  )

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    fetchAssignableStaffMembersPage(query, { page, pageSize: 20, signal: controller.signal })
      .then((result) => {
        const members = result.items
        const nextResults = members.map((member) => ({
          userId: member.userId,
          name: member.displayName,
          email: member.email ?? '',
        }))
        setResults((current) => {
          if (page <= 1) return nextResults
          const merged = new Map(current.map((entry) => [entry.userId, entry]))
          nextResults.forEach((entry) => merged.set(entry.userId, entry))
          return Array.from(merged.values())
        })
        setTotalPages(result.total > 0 ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1)
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
  }, [open, page, query, t])

  React.useEffect(() => {
    if (!open) return
    setPage(1)
  }, [open, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-auto inline-flex items-center gap-[6px] rounded-[999px] border border-emerald-300 bg-emerald-50 px-[10px] py-[6px] text-[12px] font-semibold text-foreground dark:border-emerald-700 dark:bg-emerald-950">
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
        {selectableResults.length ? (
          <div className="mb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                onAddMany(
                  selectableResults.map((participant, index) => ({
                    userId: participant.userId,
                    name: participant.name,
                    email: participant.email,
                    color: PARTICIPANT_COLORS[(existingIds.size + index) % PARTICIPANT_COLORS.length],
                  })),
                )
                setOpen(false)
                setQuery('')
              }}
            >
              {t('customers.schedule.addVisibleParticipants', 'Add all visible')}
            </Button>
          </div>
        ) : null}
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {loading && <p className="px-2 py-3 text-xs text-muted-foreground text-center">{t('customers.schedule.searching', 'Searching...')}</p>}
          {!loading && loadError && <p className="px-2 py-3 text-xs text-destructive text-center">{loadError}</p>}
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
          {!loading && !loadError && page < totalPages ? (
            <div className="px-2 py-2">
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setPage((current) => current + 1)}>
                {t('customers.schedule.loadMore', 'Load more')}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ParticipantsFieldProps {
  visible: Set<ScheduleFieldId>
  activityType: ActivityType
  participants: Participant[]
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>
  removeParticipant: (userId: string) => void
  guestPermissions: { canInviteOthers: boolean; canModify: boolean; canSeeList: boolean }
  setGuestPermissions: React.Dispatch<React.SetStateAction<{ canInviteOthers: boolean; canModify: boolean; canSeeList: boolean }>>
}

export function ParticipantsField({
  visible,
  activityType,
  participants,
  setParticipants,
  removeParticipant,
  guestPermissions,
  setGuestPermissions,
}: ParticipantsFieldProps) {
  const t = useT()

  if (!isVisible(activityType, 'participants')) return null

  return (
    <div>
      <label className="text-[11px] font-semibold uppercase text-muted-foreground tracking-[0.5px]">
        {t('customers.schedule.participants', 'Participants')}
      </label>
      <div className="mt-[10px] flex flex-wrap content-center items-center gap-[8px] rounded-[10px] border border-border bg-background px-[12px] py-[10px]">
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
          onAddMany={(nextParticipants) => {
            setParticipants((prev) => [
              ...prev,
              ...nextParticipants.map((participant) => ({ ...participant, status: 'pending' as RsvpStatus })),
            ])
          }}
          t={t}
        />
      </div>

      {/* Guest permissions -- shown when participants exist */}
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

      {/* RSVP summary -- shown when participants exist */}
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
  )
}
