'use client'

import * as React from 'react'
import { Check, CheckCircle2, Clock, Users, X, XCircle } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasMoreFromPage } from '@open-mercato/shared/lib/pagination/load-more'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { fetchAssignableStaffMembersPage } from '../assignableStaff'
import type { ActivityType, ScheduleFieldId } from './fieldConfig'
import { isVisible, getFieldLabel } from './fieldConfig'
import type { Participant, RsvpStatus } from './useScheduleFormState'
import { PARTICIPANT_COLORS } from './useScheduleFormState'

const PAGE_SIZE = 20

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
  // Short-page termination instead of a `total`-derived page bound — see
  // `hasMoreFromPage`. Measured on the served count, not on `members`, which is
  // deduped by user id.
  const [hasMore, setHasMore] = React.useState(false)
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
    fetchAssignableStaffMembersPage(query, { page, pageSize: PAGE_SIZE, signal: controller.signal })
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
        setHasMore(hasMoreFromPage(result.servedCount, PAGE_SIZE))
        setLoadError(null)
      })
      .catch(() => {
        setResults([])
        setHasMore(false)
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
        <Button type="button" variant="outline">
          <Users className="size-3.5" />
          {t('customers.schedule.addParticipant', 'Add participant')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('customers.schedule.searchParticipant', 'Search team members...')}
          className="mb-2"
          autoFocus
        />
        {selectableResults.length ? (
          <div className="mb-2">
            <Button
              type="button"
              variant="outline"
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
                  'h-9 flex w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                  // Fight the Button primitive's disabled:opacity-50 — stacked with a
                  // local opacity the row faded to ~20% and read as empty space. An
                  // added member stays legible: muted text + explicit check.
                  alreadyAdded ? 'cursor-default text-muted-foreground disabled:opacity-100' : 'hover:bg-accent cursor-pointer',
                )}
              >
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-bold shrink-0">
                  {r.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.email && <span className="text-xs text-muted-foreground truncate">{r.email}</span>}
                {alreadyAdded ? <Check className="size-3.5 shrink-0 text-status-success-icon" aria-hidden /> : null}
              </Button>
            )
          })}
          {!loading && !loadError && hasMore ? (
            <div className="px-2 py-2">
              <Button type="button" variant="outline" className="w-full" onClick={() => setPage((current) => current + 1)}>
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
  removeParticipant: (index: number) => void
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

  const sectionLabel = getFieldLabel(
    activityType,
    'participants',
    t,
    'customers.schedule.participants',
    'Participants',
  )

  return (
    <div>
      <label className="text-sm font-medium">
        {sectionLabel}
      </label>
      <div className="mt-2 flex flex-wrap content-center items-center gap-2">
        {/* DS Tag [1.1] (Figma 431:16147): compact radius-6 rect, avatar + label + × */}
        {participants.map((p, index) => (
          <div key={p.userId ?? p.email ?? index} className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-background pl-1 pr-1.5">
            <span className={cn('inline-flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white', p.color ?? 'bg-primary')}>
              {p.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-xs font-medium text-foreground">{p.name}</span>
            <IconButton type="button" variant="ghost" size="sm" onClick={() => removeParticipant(index)} className="h-auto text-muted-foreground hover:text-foreground p-0" aria-label={t('customers.schedule.removeParticipant', 'Remove participant')}>
              <X className="size-3" />
            </IconButton>
          </div>
        ))}
        <ParticipantSearchPopover
          existingIds={new Set(participants.map((p) => p.userId).filter((userId): userId is string => Boolean(userId)))}
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
        <div className="mt-3 flex flex-wrap items-center gap-x-[16px] gap-y-[6px] text-xs">
          <span className="font-medium text-muted-foreground">{t('customers.schedule.guestPermissions', 'Guest permissions:')}</span>
          <label htmlFor="guest-perm-invite" className="flex items-center gap-1.5 cursor-pointer">
            <Checkbox id="guest-perm-invite" checked={guestPermissions.canInviteOthers} onCheckedChange={(checked) => setGuestPermissions((p) => ({ ...p, canInviteOthers: checked === true }))} />
            {t('customers.schedule.guestPerm.invite', 'Invite others')}
          </label>
          <label htmlFor="guest-perm-modify" className="flex items-center gap-1.5 cursor-pointer">
            <Checkbox id="guest-perm-modify" checked={guestPermissions.canModify} onCheckedChange={(checked) => setGuestPermissions((p) => ({ ...p, canModify: checked === true }))} />
            {t('customers.schedule.guestPerm.modify', 'Modify')}
          </label>
          <label htmlFor="guest-perm-see-list" className="flex items-center gap-1.5 cursor-pointer">
            <Checkbox id="guest-perm-see-list" checked={guestPermissions.canSeeList} onCheckedChange={(checked) => setGuestPermissions((p) => ({ ...p, canSeeList: checked === true }))} />
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
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">{t('customers.schedule.rsvp.label', 'Responses:')}</span>
            {accepted > 0 && <span className="flex items-center gap-1 font-medium text-status-success-text"><CheckCircle2 className="size-3.5" /> {accepted} {t('customers.schedule.rsvp.accepted', 'tak')}</span>}
            {pending > 0 && <span className="flex items-center gap-1 font-medium text-muted-foreground"><Clock className="size-3.5" /> {pending} {t('customers.schedule.rsvp.pending', 'czeka')}</span>}
            {declined > 0 && <span className="flex items-center gap-1 font-medium text-status-error-text"><XCircle className="size-3.5" /> {declined} {t('customers.schedule.rsvp.declined', 'nie')}</span>}
          </div>
        )
      })()}
    </div>
  )
}
