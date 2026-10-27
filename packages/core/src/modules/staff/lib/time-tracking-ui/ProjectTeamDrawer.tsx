"use client"

import * as React from 'react'
import { Lock, Save } from 'lucide-react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  countPendingChanges,
  diffTeamSelection,
  formatProjectMinutes,
  resolveAssignmentState,
  resolveGraceDays,
  selectChangeCountKey,
  toIsoDate,
  type AssignedMember,
  type AssignmentState,
} from './projectTeamAssignment'

const logger = createLogger('staff').child({ component: 'ProjectTeamDrawer' })

const MUTATION_CONTEXT_ID = 'staff.time_tracking.project_team'
const DIRECTORY_PAGE_SIZE = 100
const ENTRIES_PAGE_SIZE = 100
const MAX_ENTRY_PAGES = 20
const SEARCH_DEBOUNCE_MS = 250

type ApiRow = Record<string, unknown>

type PersonProfile = {
  id: string
  name: string
  userId: string | null
}

type ProjectHours = {
  minutesByStaffMemberId: Map<string, number>
  partial: boolean
}

export type ProjectTeamDrawerProps = {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-checks the person who requested access (notification deep link, D-6). */
  preselectUserId?: string | null
  onSaved?: () => void
}

function readString(row: ApiRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (value instanceof Date) return value.toISOString()
  }
  return null
}

function readNumber(row: ApiRow, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function readItems(payload: { items?: unknown } | null | undefined): ApiRow[] {
  const items = payload?.items
  return Array.isArray(items) ? (items as ApiRow[]) : []
}

function toProfile(row: ApiRow): PersonProfile | null {
  const id = readString(row, 'id')
  if (!id) return null
  return {
    id,
    name: readString(row, 'display_name', 'displayName') ?? id,
    userId: readString(row, 'user_id', 'userId'),
  }
}

function toAssignedMember(row: ApiRow): AssignedMember | null {
  const membershipId = readString(row, 'id')
  const staffMemberId = readString(row, 'staff_member_id', 'staffMemberId')
  if (!membershipId || !staffMemberId) return null
  return {
    membershipId,
    staffMemberId,
    role: readString(row, 'role'),
    status: readString(row, 'status'),
    startDate: toIsoDate(readString(row, 'assigned_start_date', 'assignedStartDate')),
    endDate: toIsoDate(readString(row, 'assigned_end_date', 'assignedEndDate')),
  }
}

function todayIsoDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Hours logged per person in this project. There is no aggregate endpoint yet,
 * so the drawer pages the (tenant-scoped) entries list and sums client-side;
 * beyond `MAX_ENTRY_PAGES` the totals are reported as a lower bound rather than
 * silently under-reporting.
 */
async function loadProjectHours(projectId: string): Promise<ProjectHours> {
  const minutesByStaffMemberId = new Map<string, number>()
  let partial = false
  for (let page = 1; page <= MAX_ENTRY_PAGES; page += 1) {
    const params = new URLSearchParams({
      projectId,
      page: String(page),
      pageSize: String(ENTRIES_PAGE_SIZE),
    })
    const res = await apiCall<{ items?: unknown; total?: number }>(
      `/api/staff/timesheets/time-entries?${params.toString()}`,
    )
    if (!res.ok) return { minutesByStaffMemberId, partial: true }
    const rows = readItems(res.result)
    for (const row of rows) {
      const staffMemberId = readString(row, 'staff_member_id', 'staffMemberId')
      if (!staffMemberId) continue
      const minutes = readNumber(row, 'duration_minutes', 'durationMinutes')
      minutesByStaffMemberId.set(staffMemberId, (minutesByStaffMemberId.get(staffMemberId) ?? 0) + minutes)
    }
    if (rows.length < ENTRIES_PAGE_SIZE) return { minutesByStaffMemberId, partial: false }
    const total = typeof res.result?.total === 'number' ? res.result.total : null
    if (total !== null && page * ENTRIES_PAGE_SIZE >= total) return { minutesByStaffMemberId, partial: false }
    partial = true
  }
  return { minutesByStaffMemberId, partial }
}

type TeamPickRowProps = {
  profile: PersonProfile
  hint: string
  checked: boolean
  locked: boolean
  lockedHint: string
  lockLabel: string
  badge: React.ReactNode
  windowLine: React.ReactNode
  endDateControl: React.ReactNode
  selectLabel: string
  onToggle: (next: boolean) => void
}

function TeamPickRow({
  profile,
  hint,
  checked,
  locked,
  lockedHint,
  lockLabel,
  badge,
  windowLine,
  endDateControl,
  selectLabel,
  onToggle,
}: TeamPickRowProps) {
  return (
    <li className="rounded-md border border-border" data-staff-member-id={profile.id}>
      <label className="flex cursor-pointer items-start gap-3 p-3">
        <span className="mt-0.5 shrink-0">
          <Checkbox
            checked={checked}
            disabled={locked}
            aria-label={locked ? `${selectLabel} — ${lockedHint}` : selectLabel}
            onCheckedChange={(next) => onToggle(next === true)}
          />
        </span>
        <Avatar label={profile.name} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{profile.name}</span>
          <span className="text-xs text-muted-foreground">{hint}</span>
          {windowLine}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {locked ? (
            <SimpleTooltip content={lockedHint}>
              <Badge variant="neutral" className="gap-1">
                <Lock className="size-3" aria-hidden />
                {lockLabel}
              </Badge>
            </SimpleTooltip>
          ) : null}
          {badge}
        </span>
      </label>
      {endDateControl}
    </li>
  )
}

export function ProjectTeamDrawer({
  projectId,
  projectName,
  open,
  onOpenChange,
  preselectUserId,
  onSaved,
}: ProjectTeamDrawerProps) {
  const t = useT()
  const currentUserId = useCurrentUserId()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.projects.team.drawer.saveError', 'Could not save the project team.'),
  })

  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [assigned, setAssigned] = React.useState<AssignedMember[]>([])
  const [profiles, setProfiles] = React.useState<Map<string, PersonProfile>>(new Map())
  const [directoryIds, setDirectoryIds] = React.useState<string[]>([])
  const [directoryTotal, setDirectoryTotal] = React.useState(0)
  const [selfStaffMemberId, setSelfStaffMemberId] = React.useState<string | null>(null)
  const [graceDays, setGraceDays] = React.useState<number>(resolveGraceDays(null))
  const [hours, setHours] = React.useState<ProjectHours | null>(null)
  const [hoursLoading, setHoursLoading] = React.useState(true)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [endDrafts, setEndDrafts] = React.useState<Map<string, string | null>>(new Map())
  const [query, setQuery] = React.useState('')
  const [debouncedQuery, setDebouncedQuery] = React.useState('')

  const mergeProfiles = React.useCallback((rows: ApiRow[]) => {
    setProfiles((previous) => {
      const next = new Map(previous)
      for (const row of rows) {
        const profile = toProfile(row)
        if (profile) next.set(profile.id, profile)
      }
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!open) return
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [open, query])

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setDebouncedQuery('')
    }
  }, [open])

  const loadTeam = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [membersRes, selfRes, settingsRes] = await Promise.all([
        apiCall<{ items?: unknown }>(
          `/api/staff/timesheets/time-projects/${projectId}/employees?page=1&pageSize=${DIRECTORY_PAGE_SIZE}&status=active`,
        ),
        apiCall<{ member?: { id?: string; displayName?: string; userId?: string | null } | null }>(
          '/api/staff/team-members/self',
        ),
        apiCall<{ access?: { assignmentGraceDays?: unknown } | null }>('/api/staff/timesheets/settings'),
      ])

      if (!membersRes.ok) {
        setLoadError(t('staff.time_tracking.projects.team.drawer.loadError', 'Could not load the project team.'))
        return
      }

      const members = readItems(membersRes.result)
        .map(toAssignedMember)
        .filter((member): member is AssignedMember => member !== null)
      setAssigned(members)
      setSelected(new Set(members.map((member) => member.staffMemberId)))
      setEndDrafts(new Map(members.map((member) => [member.staffMemberId, member.endDate])))

      const selfMember = selfRes.ok ? selfRes.result?.member ?? null : null
      if (selfMember?.id) {
        setSelfStaffMemberId(selfMember.id)
        mergeProfiles([
          { id: selfMember.id, display_name: selfMember.displayName ?? selfMember.id, user_id: selfMember.userId ?? null },
        ])
      }

      if (settingsRes.ok) {
        setGraceDays(resolveGraceDays(settingsRes.result?.access?.assignmentGraceDays))
      }

      const assignedIds = members.map((member) => member.staffMemberId)
      if (assignedIds.length > 0) {
        const profileRes = await apiCall<{ items?: unknown }>(
          `/api/staff/team-members?ids=${assignedIds.join(',')}&pageSize=${DIRECTORY_PAGE_SIZE}`,
        )
        if (profileRes.ok) mergeProfiles(readItems(profileRes.result))
      }
    } catch (error) {
      logger.error('staff.time_tracking.projects.team.load failed', { err: error })
      setLoadError(t('staff.time_tracking.projects.team.drawer.loadError', 'Could not load the project team.'))
    } finally {
      setLoading(false)
    }
  }, [projectId, mergeProfiles, t])

  React.useEffect(() => {
    if (!open) return
    void loadTeam()
  }, [open, loadTeam])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setHoursLoading(true)
    void (async () => {
      try {
        const result = await loadProjectHours(projectId)
        if (!cancelled) setHours(result)
      } catch (error) {
        logger.error('staff.time_tracking.projects.team.hours failed', { err: error })
        if (!cancelled) setHours(null)
      } finally {
        if (!cancelled) setHoursLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, projectId])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(DIRECTORY_PAGE_SIZE),
        isActive: 'true',
      })
      if (debouncedQuery.length > 0) params.set('search', debouncedQuery)
      const res = await apiCall<{ items?: unknown; total?: number }>(`/api/staff/team-members?${params.toString()}`)
      if (cancelled || !res.ok) return
      const rows = readItems(res.result)
      mergeProfiles(rows)
      setDirectoryIds(rows.map((row) => readString(row, 'id')).filter((id): id is string => id !== null))
      setDirectoryTotal(typeof res.result?.total === 'number' ? res.result.total : rows.length)
    })()
    return () => { cancelled = true }
  }, [open, debouncedQuery, mergeProfiles])

  const lockedStaffMemberId = React.useMemo(() => {
    if (selfStaffMemberId) return selfStaffMemberId
    if (!currentUserId) return null
    for (const profile of profiles.values()) {
      if (profile.userId && profile.userId === currentUserId) return profile.id
    }
    return null
  }, [selfStaffMemberId, currentUserId, profiles])

  const lockedStaffMemberIds = React.useMemo(
    () => new Set(lockedStaffMemberId ? [lockedStaffMemberId] : []),
    [lockedStaffMemberId],
  )

  React.useEffect(() => {
    if (!open || !preselectUserId || loading) return
    for (const profile of profiles.values()) {
      if (profile.userId !== preselectUserId) continue
      setSelected((previous) => (previous.has(profile.id) ? previous : new Set(previous).add(profile.id)))
      return
    }
  }, [open, preselectUserId, loading, profiles])

  const assignedByStaffMemberId = React.useMemo(() => {
    const map = new Map<string, AssignedMember>()
    for (const member of assigned) {
      if (!map.has(member.staffMemberId)) map.set(member.staffMemberId, member)
    }
    return map
  }, [assigned])

  const changes = React.useMemo(
    () => diffTeamSelection(assigned, { selectedStaffMemberIds: selected, endDateByStaffMemberId: endDrafts }, lockedStaffMemberIds),
    [assigned, selected, endDrafts, lockedStaffMemberIds],
  )
  const pendingChanges = countPendingChanges(changes)

  const memberMinutes = React.useCallback(
    (staffMemberId: string): number | null => {
      if (!hours) return null
      return hours.minutesByStaffMemberId.get(staffMemberId) ?? 0
    },
    [hours],
  )

  const hoursLabel = React.useCallback(
    (staffMemberId: string): string => {
      if (hoursLoading) return '…'
      const minutes = memberMinutes(staffMemberId)
      if (minutes === null) return formatProjectMinutes(0)
      const formatted = formatProjectMinutes(minutes)
      if (!hours?.partial) return formatted
      return t('staff.time_tracking.projects.team.drawer.hoursAtLeast', 'at least {hours}', { hours: formatted })
    },
    [hours, hoursLoading, memberMinutes, t],
  )

  const roleLabel = React.useCallback(
    (staffMemberId: string): string => {
      const member = assignedByStaffMemberId.get(staffMemberId)
      if (member?.role && member.role.trim().length > 0) return member.role
      if (staffMemberId === lockedStaffMemberId) {
        return t('staff.time_tracking.projects.team.drawer.roleLeader', 'Team Leader')
      }
      return t('staff.time_tracking.projects.team.drawer.roleMember', 'Team Member')
    },
    [assignedByStaffMemberId, lockedStaffMemberId, t],
  )

  const toggleMember = React.useCallback(
    async (staffMemberId: string, next: boolean) => {
      if (lockedStaffMemberIds.has(staffMemberId)) return
      if (!next && assignedByStaffMemberId.has(staffMemberId)) {
        const profile = profiles.get(staffMemberId)
        const name = profile?.name ?? staffMemberId
        const minutes = memberMinutes(staffMemberId)
        const needsConfirm = minutes === null || minutes > 0
        if (needsConfirm) {
          const text = minutes === null || hoursLoading
            ? t(
                'staff.time_tracking.projects.team.drawer.removeConfirm.textUnknown',
                '{name} may have time logged in this project — revoke access?',
                { name },
              )
            : t(
                'staff.time_tracking.projects.team.drawer.removeConfirm.text',
                '{name} has {hours} in this project — revoke access?',
                { name, hours: formatProjectMinutes(minutes) },
              )
          const confirmed = await confirm({
            title: t('staff.time_tracking.projects.team.drawer.removeConfirm.title', 'Revoke access?'),
            text,
            variant: 'destructive',
          })
          if (!confirmed) return
        }
      }
      setSelected((previous) => {
        const draft = new Set(previous)
        if (next) draft.add(staffMemberId)
        else draft.delete(staffMemberId)
        return draft
      })
    },
    [assignedByStaffMemberId, confirm, hoursLoading, lockedStaffMemberIds, memberMinutes, profiles, t],
  )

  const setEndDate = React.useCallback((staffMemberId: string, value: string | null) => {
    setEndDrafts((previous) => {
      const draft = new Map(previous)
      draft.set(staffMemberId, value && value.length > 0 ? value : null)
      return draft
    })
  }, [])

  // Membership rows are an assignment junction, so they are exempt from OSS
  // optimistic locking (data-integrity contract); the drawer never PATCHes the
  // project aggregate itself, so no expected-updated-at header applies here.
  const persistChanges = React.useCallback(async () => {
    const employeesPath = `staff/timesheets/time-projects/${projectId}/employees`
    const startDate = todayIsoDate()

    for (const staffMemberId of changes.additions) {
      await createCrud(employeesPath, {
        timeProjectId: projectId,
        staffMemberId,
        assignedStartDate: startDate,
        assignedEndDate: endDrafts.get(staffMemberId) ?? null,
      }, {
        errorMessage: t('staff.time_tracking.projects.team.drawer.saveError', 'Could not save the project team.'),
      })
    }

    // Re-dating is an update of the membership row itself (T2.12): the audit
    // trail must read "assignment end date changed", not "member removed,
    // member added". Only the changed field is sent, so the recorded diff names
    // `assignedEndDate` alone.
    //
    // No optimistic-lock header, deliberately. The endpoint accepts and enforces
    // one (the CRUD factory registers a reader for this entity), but this drawer
    // saves a whole batch — additions, re-datings and removals — with no
    // rollback. A per-row version round-trip belongs with a per-row conflict UX;
    // the batch save is not it.
    //
    // What this loop guarantees and what it does not (C6):
    //  * GUARANTEED — the loop stops at the first failure, so no write is
    //    attempted after one fails, and `handleSave` reloads the drawer from the
    //    server before showing the error, so what the user then sees is the
    //    persisted team rather than the optimistic local snapshot.
    //  * NOT GUARANTEED — atomicity. There is no transaction across these three
    //    passes: whatever was written before the failure stays written and is
    //    not rolled back. The reload therefore also drops the part of the batch
    //    that never reached the server; the user re-applies it and saves again.
    for (const update of changes.endDateUpdates) {
      await updateCrud(employeesPath, {
        id: update.member.membershipId,
        assignedEndDate: update.endDate,
      }, {
        errorMessage: t('staff.time_tracking.projects.team.drawer.saveError', 'Could not save the project team.'),
      })
    }

    for (const member of changes.removals) {
      await deleteCrud(employeesPath, member.membershipId, {
        errorMessage: t('staff.time_tracking.projects.team.drawer.saveError', 'Could not save the project team.'),
      })
    }
  }, [changes, endDrafts, projectId, t])

  const handleSave = React.useCallback(async () => {
    if (saving || pendingChanges === 0) return
    setSaving(true)
    try {
      await runMutation({
        operation: persistChanges,
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.time_project_member',
          resourceId: projectId,
          action: 'assign-team',
          retryLastMutation,
        },
        mutationPayload: {
          timeProjectId: projectId,
          additions: changes.additions,
          removals: changes.removals.map((member) => member.membershipId),
          endDateUpdates: changes.endDateUpdates.map((update) => ({
            id: update.member.membershipId,
            assignedEndDate: update.endDate,
          })),
        },
      })
      flash(t('staff.time_tracking.projects.team.drawer.saved', 'Project team updated.'), 'success')
      onSaved?.()
      onOpenChange(false)
    } catch (error) {
      logger.error('staff.time_tracking.projects.team.save failed', { err: error })
      // The batch is not transactional (see `persistChanges`), so the local
      // snapshot can no longer be trusted: re-read the memberships first and
      // only then report, so the error and the rows underneath it agree.
      await loadTeam()
      const reason =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('staff.time_tracking.projects.team.drawer.saveError', 'Could not save the project team.')
      flash(
        t(
          'staff.time_tracking.projects.team.drawer.partialSaveError',
          '{reason} Saving stopped part-way through, so the team shown below was reloaded from the server — check it and apply the remaining changes again.',
          { reason },
        ),
        'error',
      )
    } finally {
      setSaving(false)
    }
  }, [
    changes,
    loadTeam,
    onOpenChange,
    onSaved,
    pendingChanges,
    persistChanges,
    projectId,
    retryLastMutation,
    runMutation,
    saving,
    t,
  ])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleSave()
      }
    },
    [handleSave],
  )

  /**
   * The drawer batches the whole team edit and writes nothing until Save, so
   * Escape, the ×, the overlay and Cancel each stand to discard a set of changes
   * the footer is at that moment counting out loud. They all reach `onOpenChange`,
   * so the guard sits there once rather than on each of them.
   */
  const requestClose = React.useCallback(async () => {
    if (saving) return
    if (pendingChanges === 0) {
      onOpenChange(false)
      return
    }
    const confirmed = await confirm({
      title: t('staff.time_tracking.projects.team.drawer.discard.title', 'Discard the team changes?'),
      text: t(
        'staff.time_tracking.projects.team.drawer.discard.text',
        'Nothing has been saved yet, so closing now loses every change in this drawer.',
      ),
      confirmText: t('staff.time_tracking.projects.team.drawer.discard.confirm', 'Discard'),
      cancelText: t('staff.time_tracking.projects.team.drawer.discard.cancel', 'Keep editing'),
      variant: 'destructive',
    })
    if (confirmed) onOpenChange(false)
  }, [confirm, onOpenChange, pendingChanges, saving, t])

  const matchesQuery = React.useCallback(
    (profile: PersonProfile) => {
      if (debouncedQuery.length === 0) return true
      return profile.name.toLocaleLowerCase().includes(debouncedQuery.toLocaleLowerCase())
    },
    [debouncedQuery],
  )

  const assignedRowIds = React.useMemo(() => {
    const ids = new Set<string>(assignedByStaffMemberId.keys())
    if (lockedStaffMemberId) ids.add(lockedStaffMemberId)
    return Array.from(ids)
  }, [assignedByStaffMemberId, lockedStaffMemberId])

  const assignedRows = React.useMemo(
    () =>
      assignedRowIds
        .map((id) => profiles.get(id) ?? { id, name: id, userId: null })
        .filter(matchesQuery)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [assignedRowIds, profiles, matchesQuery],
  )

  const otherRows = React.useMemo(
    () =>
      directoryIds
        .filter((id) => !assignedRowIds.includes(id))
        .map((id) => profiles.get(id) ?? { id, name: id, userId: null })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [directoryIds, assignedRowIds, profiles],
  )

  const changeCountLabel = React.useMemo(() => {
    if (pendingChanges === 0) {
      return t('staff.time_tracking.projects.team.drawer.footer.noChanges', 'No changes')
    }
    const bucket = selectChangeCountKey(pendingChanges)
    if (bucket === 'one') {
      return t('staff.time_tracking.projects.team.drawer.footer.changes.one', '1 change to save', { count: pendingChanges })
    }
    if (bucket === 'few') {
      return t('staff.time_tracking.projects.team.drawer.footer.changes.few', '{count} changes to save', { count: pendingChanges })
    }
    return t('staff.time_tracking.projects.team.drawer.footer.changes.many', '{count} changes to save', { count: pendingChanges })
  }, [pendingChanges, t])

  const renderStateBadge = React.useCallback(
    (staffMemberId: string, isAssigned: boolean, isChecked: boolean, state: AssignmentState, endDate: string | null) => {
      if (isAssigned && !isChecked) {
        return (
          <Badge variant="error">
            {t('staff.time_tracking.projects.team.drawer.badges.removing', 'being removed')}
          </Badge>
        )
      }
      if (!isAssigned && isChecked) {
        return (
          <Badge variant="success">
            {t('staff.time_tracking.projects.team.drawer.badges.adding', 'being added')}
          </Badge>
        )
      }
      if (!isAssigned) return null
      if (state === 'expired') {
        return (
          <Badge variant="warning">
            {t('staff.time_tracking.projects.team.drawer.badges.expired', 'expired {date}', { date: endDate ?? '' })}
          </Badge>
        )
      }
      if (state === 'scheduled') {
        return (
          <Badge variant="neutral">
            {t('staff.time_tracking.projects.team.drawer.badges.scheduled', 'from {date}', {
              date: assignedByStaffMemberId.get(staffMemberId)?.startDate ?? '',
            })}
          </Badge>
        )
      }
      return null
    },
    [assignedByStaffMemberId, t],
  )

  const renderRow = React.useCallback(
    (profile: PersonProfile) => {
      const member = assignedByStaffMemberId.get(profile.id) ?? null
      const isLocked = lockedStaffMemberIds.has(profile.id)
      const isChecked = isLocked || selected.has(profile.id)
      const draftEndDate = endDrafts.has(profile.id) ? endDrafts.get(profile.id) ?? null : member?.endDate ?? null
      const state = member
        ? resolveAssignmentState({ startDate: member.startDate, endDate: draftEndDate }, graceDays)
        : 'active'
      const role = roleLabel(profile.id)
      const hint = isLocked
        ? t('staff.time_tracking.projects.team.drawer.hintFromRole', '{role} · access from role', { role })
        : member
          ? t('staff.time_tracking.projects.team.drawer.hintInProject', '{role} · {hours} in this project', {
              role,
              hours: hoursLabel(profile.id),
            })
          : t('staff.time_tracking.projects.team.drawer.hintPerson', '{role} · {hours}', {
              role,
              hours: hoursLabel(profile.id),
            })

      const windowLine = member && (member.startDate || draftEndDate) ? (
        <span className="text-xs text-muted-foreground">
          {draftEndDate
            ? t('staff.time_tracking.projects.team.drawer.window.range', 'from {start} · until {end}', {
                start: member.startDate ?? '',
                end: draftEndDate,
              })
            : t('staff.time_tracking.projects.team.drawer.window.startOnly', 'from {start}', {
                start: member.startDate ?? '',
              })}
          {state === 'expired' ? (
            <span className="block text-status-warning-text">
              {t(
                'staff.time_tracking.projects.team.drawer.window.expiredHint',
                'The assignment expired — this person no longer has access to the project.',
              )}
            </span>
          ) : null}
        </span>
      ) : null

      const endDateControl = member && !isLocked ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <label className="text-xs text-muted-foreground" htmlFor={`team-end-date-${profile.id}`}>
            {t('staff.time_tracking.projects.team.drawer.window.label', 'Assignment end')}
          </label>
          <Input
            id={`team-end-date-${profile.id}`}
            type="date"
            size="sm"
            className="w-40"
            value={draftEndDate ?? ''}
            onChange={(event) => setEndDate(profile.id, event.target.value)}
          />
          {draftEndDate ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEndDate(profile.id, null)}>
              {t('staff.time_tracking.projects.team.drawer.window.clear', 'Clear')}
            </Button>
          ) : null}
        </div>
      ) : null

      return (
        <TeamPickRow
          key={profile.id}
          profile={profile}
          hint={hint}
          checked={isChecked}
          locked={isLocked}
          lockLabel={t('staff.time_tracking.projects.team.drawer.badges.always', 'always')}
          lockedHint={t(
            'staff.time_tracking.projects.team.drawer.lockedHint',
            "The Team Leader's access comes from the projects permission, not from an assignment, so it cannot be changed here.",
          )}
          badge={renderStateBadge(profile.id, member !== null, isChecked, state, draftEndDate)}
          windowLine={windowLine}
          endDateControl={endDateControl}
          selectLabel={t('staff.time_tracking.projects.team.drawer.selectPerson', 'Assign {name}', { name: profile.name })}
          onToggle={(next) => { void toggleMember(profile.id, next) }}
        />
      )
    },
    [
      assignedByStaffMemberId,
      endDrafts,
      graceDays,
      hoursLabel,
      lockedStaffMemberIds,
      renderStateBadge,
      roleLabel,
      selected,
      setEndDate,
      t,
      toggleMember,
    ],
  )

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true)
          return
        }
        void requestClose()
      }}
    >
      <DrawerContent
        className="sm:max-w-lg"
        onKeyDown={handleKeyDown}
        closeAriaLabel={t('staff.time_tracking.projects.team.drawer.close', 'Close')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('staff.time_tracking.projects.team.drawer.title', 'Project team')}</DrawerTitle>
          <DrawerDescription>{projectName}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-4">
          {loading ? (
            <LoadingMessage label={t('staff.time_tracking.projects.team.drawer.loading', 'Loading the team…')} />
          ) : loadError ? (
            <ErrorMessage label={loadError} />
          ) : (
            <>
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('staff.time_tracking.projects.team.drawer.search', 'Search for a person…')}
              />

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('staff.time_tracking.projects.team.drawer.assigned', 'Assigned ({count})', {
                    count: assignedRowIds.length,
                  })}
                </h3>
                {assignedRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('staff.time_tracking.projects.team.empty', 'Nobody is assigned yet.')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">{assignedRows.map(renderRow)}</ul>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('staff.time_tracking.projects.team.drawer.others', 'Everyone else in the organization')}
                </h3>
                {otherRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('staff.time_tracking.projects.team.drawer.othersEmpty', 'No other people found.')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">{otherRows.map(renderRow)}</ul>
                )}
                {directoryTotal > directoryIds.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'staff.time_tracking.projects.team.drawer.directoryTruncated',
                      'Showing the first {count} people — use the search box to find the rest.',
                      { count: directoryIds.length },
                    )}
                  </p>
                ) : null}
              </section>

              <Alert status="information">
                <AlertDescription>
                  {t(
                    'staff.time_tracking.projects.team.drawer.info.keepsTime',
                    'Revoking access does not delete logged time — the entries stay in the project and in reports.',
                  )}
                </AlertDescription>
                <AlertDescription>
                  {t(
                    'staff.time_tracking.projects.team.drawer.info.immediate',
                    'Access works immediately after saving — no re-login needed.',
                  )}
                </AlertDescription>
              </Alert>
            </>
          )}
        </DrawerBody>
        <DrawerFooter leading={<span className="text-xs text-muted-foreground">{changeCountLabel}</span>}>
          <Button type="button" variant="ghost" onClick={() => { void requestClose() }}>
            {t('staff.time_tracking.projects.team.drawer.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={saving || pendingChanges === 0} onClick={() => { void handleSave() }}>
            <Save className="size-4" aria-hidden />
            {saving
              ? t('staff.time_tracking.projects.team.drawer.saving', 'Saving…')
              : t('staff.time_tracking.projects.team.drawer.save', 'Save')}
          </Button>
        </DrawerFooter>
        {ConfirmDialogElement}
      </DrawerContent>
    </Drawer>
  )
}

export default ProjectTeamDrawer
