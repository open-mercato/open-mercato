'use client'

import * as React from 'react'
import { Search, Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import type { DictionaryEntryOption } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import type { RoleAssignment } from './RoleAssignmentRow'
import { fetchAssignableStaffMembersPage } from './assignableStaff'
import { getInitials } from './utils'

type StaffMember = {
  id: string
  displayName: string
  email: string | null
  teamName: string | null
}

interface AssignRoleDialogProps {
  open: boolean
  onClose: () => void
  onAssign: (roleType: string, userId: string) => Promise<void>
  roleTypes: DictionaryEntryOption[]
  entityName: string
  existingRoleTypes?: Set<string>
  existingAssignments?: RoleAssignment[]
  initialRoleType?: string | null
}

type StepId = 1 | 2 | 3

type TeamFilter = {
  id: string
  label: string
  count: number
}

const ASSIGNABLE_STAFF_PAGE_SIZE = 24

export function AssignRoleDialog({
  open,
  onClose,
  onAssign,
  roleTypes,
  entityName,
  existingRoleTypes,
  existingAssignments = [],
  initialRoleType = null,
}: AssignRoleDialogProps) {
  const t = useT()
  const [step, setStep] = React.useState<StepId>(1)
  const [selectedRoleType, setSelectedRoleType] = React.useState('')
  const [selectedUser, setSelectedUser] = React.useState<StaffMember | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [users, setUsers] = React.useState<StaffMember[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [activeTeam, setActiveTeam] = React.useState('all')
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [totalUsers, setTotalUsers] = React.useState(0)
  const [currentPage, setCurrentPage] = React.useState(1)
  const deferredSearchQuery = React.useDeferredValue(searchQuery)
  const requestSequenceRef = React.useRef(0)

  const availableRoleTypes = React.useMemo(
    () => roleTypes.filter((roleType) => !existingRoleTypes?.has(roleType.value)),
    [existingRoleTypes, roleTypes],
  )

  React.useEffect(() => {
    if (!open) {
      setStep(1)
      setSelectedRoleType('')
      setSelectedUser(null)
      setSearchQuery('')
      setUsers([])
      setActiveTeam('all')
      setLoadError(null)
      setTotalUsers(0)
      setCurrentPage(1)
      requestSequenceRef.current = 0
      return
    }
    const resolvedInitialRoleType =
      typeof initialRoleType === 'string' && initialRoleType.trim().length > 0
        ? initialRoleType.trim()
        : ''
    setStep(resolvedInitialRoleType ? 2 : 1)
    setSelectedRoleType(resolvedInitialRoleType)
    setSelectedUser(null)
    setSearchQuery('')
    setUsers([])
    setActiveTeam('all')
    setLoadError(null)
    setTotalUsers(0)
    setCurrentPage(1)
    requestSequenceRef.current = 0
  }, [initialRoleType, open])

  const searchUsers = React.useCallback(
    async ({
      query,
      page,
      append,
    }: {
      query: string
      page: number
      append: boolean
    }) => {
      const requestId = append ? requestSequenceRef.current : requestSequenceRef.current + 1
      requestSequenceRef.current = requestId

      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      try {
        const result = await fetchAssignableStaffMembersPage(query, {
          page,
          pageSize: ASSIGNABLE_STAFF_PAGE_SIZE,
        })
        if (requestSequenceRef.current !== requestId) return

        const nextUsers = result.items.map((member) => ({
          id: member.userId,
          displayName: member.displayName,
          email: member.email,
          teamName: member.teamName,
        }))

        setUsers((current) => {
          if (!append) return nextUsers
          const merged = new Map(current.map((user) => [user.id, user]))
          nextUsers.forEach((user) => merged.set(user.id, user))
          return Array.from(merged.values())
        })
        setTotalUsers(result.total)
        setCurrentPage(result.page)
        setLoadError(null)
      } catch {
        if (requestSequenceRef.current !== requestId) return
        if (!append) {
          setUsers([])
          setTotalUsers(0)
          setCurrentPage(1)
        }
        setLoadError(
          t(
            'customers.assignableStaff.loadError',
            'Unable to load team members. Check your permissions and try again.',
          ),
        )
      } finally {
        if (requestSequenceRef.current !== requestId) return
        if (append) {
          setLoadingMore(false)
        } else {
          setLoading(false)
        }
      }
    },
    [t],
  )

  React.useEffect(() => {
    if (step >= 2) {
      // fire-and-forget: search results populate async; errors shown in list UI
      searchUsers({ query: deferredSearchQuery, page: 1, append: false }).catch(() => {})
    }
  }, [deferredSearchQuery, searchUsers, step])

  const handleLoadMore = React.useCallback(() => {
    if (loading || loadingMore || users.length >= totalUsers) return
    // fire-and-forget: search results populate async; errors shown in list UI
    searchUsers({
      query: deferredSearchQuery,
      page: currentPage + 1,
      append: true,
    }).catch(() => {})
  }, [currentPage, deferredSearchQuery, loading, loadingMore, searchUsers, totalUsers, users.length])

  const selectedRole = React.useMemo(
    () => roleTypes.find((roleType) => roleType.value === selectedRoleType) ?? null,
    [roleTypes, selectedRoleType],
  )

  const roleTypeLabelMap = React.useMemo(
    () => new Map(roleTypes.map((roleType) => [roleType.value, roleType.label])),
    [roleTypes],
  )

  const conflictsByUserId = React.useMemo(() => {
    const next = new Map<string, string[]>()
    existingAssignments.forEach((assignment) => {
      if (!assignment.userId) return
      if (assignment.roleType === selectedRoleType) return
      const label = roleTypeLabelMap.get(assignment.roleType) ?? assignment.roleType
      const current = next.get(assignment.userId) ?? []
      if (!current.includes(label)) {
        current.push(label)
        next.set(assignment.userId, current)
      }
    })
    return next
  }, [existingAssignments, roleTypeLabelMap, selectedRoleType])

  const selectedUserConflict = React.useMemo(() => {
    if (!selectedUser) return null
    return conflictsByUserId.get(selectedUser.id) ?? null
  }, [conflictsByUserId, selectedUser])

  const teamFilters = React.useMemo<TeamFilter[]>(() => {
    const counts = new Map<string, number>()
    users.forEach((user) => {
      const key =
        user.teamName?.trim() || t('customers.roles.dialog.team.unassigned', 'No team')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return [
      { id: 'all', label: t('customers.roles.dialog.team.all', 'All'), count: users.length },
      ...Array.from(counts.entries()).map(([label, count]) => ({ id: label, label, count })),
    ]
  }, [t, users])

  const filteredUsers = React.useMemo(() => {
    if (activeTeam === 'all') return users
    return users.filter(
      (user) =>
        (user.teamName?.trim() || t('customers.roles.dialog.team.unassigned', 'No team')) ===
        activeTeam,
    )
  }, [activeTeam, t, users])

  const visibleCountLabel = React.useMemo(() => {
    if (totalUsers <= 0) return null
    return t(
      'customers.roles.dialog.visibleCount',
      'Showing {{shown}} of {{total}} team members',
      {
        shown: String(users.length),
        total: String(totalUsers),
      },
    )
  }, [t, totalUsers, users.length])

  const canLoadMore = users.length < totalUsers

  const handleAssign = React.useCallback(async () => {
    if (!selectedRoleType || !selectedUser) return
    setSaving(true)
    try {
      await onAssign(selectedRoleType, selectedUser.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }, [onAssign, onClose, selectedRoleType, selectedUser])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (step === 3 && !saving && selectedUser && selectedRoleType) {
          handleAssign()
        } else if (step === 1 && selectedRoleType && availableRoleTypes.length) {
          setStep(2)
        } else if (step === 2 && selectedUser) {
          setStep(3)
        }
      }
    },
    [availableRoleTypes.length, handleAssign, saving, selectedRoleType, selectedUser, step],
  )

  const previewCard =
    selectedUser && selectedRole ? (
      <div className="rounded-[12px] border border-border/70 bg-muted/30 px-4 py-4">
        <p className="text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('customers.roles.dialog.preview', 'Assignment preview')}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-background text-sm font-semibold text-foreground">
            {getInitials(selectedUser.displayName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
              <span>{selectedUser.displayName}</span>
              <span className="text-muted-foreground">→</span>
              <span>{selectedRole.label}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {selectedUser.email ? <span>{selectedUser.email}</span> : null}
              {selectedUser.teamName ? <span>{selectedUser.teamName}</span> : null}
            </div>
            {selectedUserConflict?.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-status-error-border bg-status-error-bg px-2 py-0.5 text-xs font-semibold text-status-error-text"
                >
                  {t('customers.roles.dialog.conflict', 'Conflict: {{roles}}', {
                    roles: selectedUserConflict.join(', '),
                  })}
                </Badge>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogContent
        className="min-h-0 max-h-[min(90vh,760px)] overflow-hidden p-0 sm:max-w-[580px]"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-2xl font-semibold leading-none">
            {t('customers.roles.dialog.title', 'Assign role')}
          </DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('customers.roles.dialog.subtitle', 'Multi-role assignment for {{name}}', {
              name: entityName,
            })}
          </p>
        </DialogHeader>

        <div className="border-b border-border/70 px-6 py-4">
          <div className="flex items-center justify-center gap-3 text-xs">
            <StepBadge
              step={1}
              currentStep={step}
              label={t('customers.roles.dialog.step1', 'Role type')}
            />
            <div className="h-px w-10 bg-border" />
            <StepBadge
              step={2}
              currentStep={step}
              label={t('customers.roles.dialog.step2', 'Select person')}
            />
            <div className="h-px w-10 bg-border" />
            <StepBadge
              step={3}
              currentStep={step}
              label={t('customers.roles.dialog.step3', 'Confirm')}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-6 py-5">
            {step === 1 ? (
              <div className="space-y-4">
                <div className="rounded-[12px] bg-muted/30 px-4 py-4">
                  <p
                    id="assign-role-dialog-type-label"
                    className="text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {t('customers.roles.dialog.roleTypeLabel', 'Role type')}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      aria-labelledby="assign-role-dialog-type-label"
                      value={selectedRoleType}
                      onChange={(event) => setSelectedRoleType(event.target.value)}
                      className="h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                    >
                      <option value="">
                        {t('customers.roles.selectRoleType', 'Select role type...')}
                      </option>
                      {availableRoleTypes.map((roleType) => (
                        <option key={roleType.id} value={roleType.value}>
                          {roleType.label}
                        </option>
                      ))}
                    </select>
                    {selectedRole ? (
                      <Badge
                        variant="outline"
                        className="rounded-[6px] px-2 py-1 text-xs"
                      >
                        {t('customers.roles.dialog.sourceBadge.dictionary', 'Dictionary')}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {!availableRoleTypes.length ? (
                  <div className="rounded-[12px] border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                    {t(
                      'customers.roles.dialog.noAvailableRoles',
                      'All available role types are already assigned.',
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                <div className="rounded-[12px] bg-muted/30 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t('customers.roles.dialog.roleTypeLabel', 'Role type')}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-lg font-semibold text-foreground">
                          {selectedRole?.label ?? selectedRoleType}
                        </span>
                        <Badge
                          variant="outline"
                          className="rounded-[6px] px-2 py-1 text-xs"
                        >
                          {t('customers.roles.dialog.sourceBadge.dictionary', 'Dictionary')}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setStep(1)}
                    >
                      {t('customers.roles.dialog.change', 'Change')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-overline font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('customers.roles.dialog.teamLabel', 'Select a team member')}
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t(
                        'customers.roles.dialog.searchPlaceholder',
                        'Search by name, e-mail or team...',
                      )}
                      className="h-10 rounded-[10px] border-border/80 pl-9 shadow-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {teamFilters.map((teamFilter) => {
                    const isActive = activeTeam === teamFilter.id
                    return (
                      <Button
                        key={teamFilter.id}
                        type="button"
                        variant={isActive ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setActiveTeam(teamFilter.id)}
                        className="h-7 rounded-[8px] px-2.5 text-xs"
                      >
                        {teamFilter.label}
                        <span className="rounded-full bg-background/80 px-1 text-xs text-muted-foreground">
                          {teamFilter.count}
                        </span>
                      </Button>
                    )
                  })}
                </div>

                <div className="space-y-2">
                  {visibleCountLabel ? (
                    <p className="text-xs text-muted-foreground">{visibleCountLabel}</p>
                  ) : null}
                  {loading ? (
                    <div className="rounded-[12px] border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
                      {t('customers.roles.loading', 'Loading...')}
                    </div>
                  ) : loadError ? (
                    <div className="rounded-[12px] border border-dashed border-status-error-border bg-status-error-bg/70 px-4 py-8 text-center text-sm text-status-error-text">
                      {loadError}
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="rounded-[12px] border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
                      {t(
                        'customers.roles.dialog.noResults',
                        'No matching team members found.',
                      )}
                    </div>
                  ) : (
                    filteredUsers.map((user) => {
                      const isSelected = selectedUser?.id === user.id
                      const userConflicts = conflictsByUserId.get(user.id) ?? []
                      return (
                        <Button
                          key={user.id}
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedUser(user)}
                          className={`h-auto flex w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
                            isSelected
                              ? 'border-foreground bg-background shadow-sm'
                              : 'border-border/70 bg-background hover:bg-accent/40'
                          }`}
                        >
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                            {getInitials(user.displayName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">
                                {user.displayName}
                              </span>
                              {user.teamName ? (
                                <Badge
                                  variant="muted"
                                  className="rounded-[6px] px-2 py-0.5 text-xs font-medium"
                                >
                                  {user.teamName}
                                </Badge>
                              ) : null}
                              {userConflicts.length ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-status-error-border bg-status-error-bg px-2 py-0.5 text-xs font-semibold text-status-error-text"
                                >
                                  {t('customers.roles.dialog.conflict', 'Conflict: {{roles}}', {
                                    roles: userConflicts.join(', '),
                                  })}
                                </Badge>
                              ) : null}
                            </div>
                            {user.email ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {user.email}
                              </div>
                            ) : null}
                          </div>
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-foreground bg-foreground text-background'
                                : 'border-border/80 bg-background text-transparent'
                            }`}
                          >
                            <Check className="size-3.5" />
                          </span>
                        </Button>
                      )
                    })
                  )}
                  {canLoadMore && !loadError ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="w-full"
                    >
                      {loadingMore
                        ? t('customers.roles.dialog.loadingMore', 'Loading more...')
                        : t('customers.roles.dialog.loadMore', 'Load more')}
                    </Button>
                  ) : null}
                </div>

                {previewCard}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-4">
                {previewCard}
                <p className="text-sm text-muted-foreground">
                  {t(
                    'customers.roles.dialog.constraint',
                    'One person per role. The assignment can be changed at any time.',
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border/70 px-6 py-4 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t(
              'customers.roles.dialog.footerNote',
              'One person per role · can be changed at any time',
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('customers.roles.cancelAdd', 'Cancel')}
            </Button>
            {step === 1 ? (
              <Button
                type="button"
                onClick={() => setStep(2)}
                disabled={!selectedRoleType || !availableRoleTypes.length}
              >
                {t('customers.roles.dialog.next', 'Next')}
              </Button>
            ) : null}
            {step === 2 ? (
              <Button type="button" onClick={() => setStep(3)} disabled={!selectedUser}>
                {t('customers.roles.dialog.next', 'Next')}
              </Button>
            ) : null}
            {step === 3 ? (
              <Button
                type="button"
                onClick={handleAssign}
                disabled={saving || !selectedUser || !selectedRoleType}
              >
                {saving
                  ? t('customers.roles.assigning', 'Assigning...')
                  : t('customers.roles.dialog.assign', 'Assign role')}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StepBadge({
  step,
  currentStep,
  label,
}: {
  step: StepId
  currentStep: StepId
  label: string
}) {
  const isComplete = currentStep > step
  const isCurrent = currentStep === step

  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex size-5 items-center justify-center rounded-full border text-xs font-semibold ${
          isComplete || isCurrent
            ? 'border-foreground bg-foreground text-background'
            : 'border-border bg-background text-muted-foreground'
        }`}
      >
        {isComplete ? <Check className="size-3" /> : step}
      </span>
      <span className={isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
    </div>
  )
}
