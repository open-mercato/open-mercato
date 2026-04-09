'use client'

import * as React from 'react'
import { Search, Check } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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
}

type StepId = 1 | 2 | 3

type TeamFilter = {
  id: string
  label: string
  count: number
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (!words.length || !words[0]) return '?'
  if (words.length === 1) return words[0].charAt(0).toUpperCase()
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
}

export function AssignRoleDialog({
  open,
  onClose,
  onAssign,
  roleTypes,
  entityName,
  existingRoleTypes,
}: AssignRoleDialogProps) {
  const t = useT()
  const [step, setStep] = React.useState<StepId>(1)
  const [selectedRoleType, setSelectedRoleType] = React.useState('')
  const [selectedUser, setSelectedUser] = React.useState<StaffMember | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [users, setUsers] = React.useState<StaffMember[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [activeTeam, setActiveTeam] = React.useState('all')

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
    }
  }, [open])

  const searchUsers = React.useCallback(async (query: string) => {
    setLoading(true)
    try {
      const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/staff/team-members?search=${encodeURIComponent(query)}&pageSize=24&isActive=true`,
      )
      const rawItems = Array.isArray(data?.items) ? data.items : []
      const mapped: StaffMember[] = []
      const seen = new Set<string>()
      for (const item of rawItems) {
        const userId =
          typeof item?.userId === 'string'
            ? item.userId
            : typeof item?.user_id === 'string'
              ? item.user_id
              : null
        if (!userId || seen.has(userId)) continue
        seen.add(userId)
        const user =
          item?.user && typeof item.user === 'object'
            ? (item.user as Record<string, unknown>)
            : null
        const displayName =
          typeof item?.displayName === 'string' && item.displayName.trim().length
            ? item.displayName.trim()
            : typeof item?.display_name === 'string' && item.display_name.trim().length
              ? item.display_name.trim()
              : null
        const email =
          user && typeof user.email === 'string' && user.email.trim().length
            ? user.email.trim()
            : null
        const teamName =
          typeof item?.teamName === 'string' && item.teamName.trim().length
            ? item.teamName.trim()
            : typeof item?.team_name === 'string' && item.team_name.trim().length
              ? item.team_name.trim()
              : null
        mapped.push({
          id: userId,
          displayName: displayName ?? email ?? userId,
          email,
          teamName,
        })
      }
      setUsers(mapped)
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (step >= 2) {
      searchUsers(searchQuery).catch(() => {})
    }
  }, [searchQuery, searchUsers, step])

  const selectedRole = React.useMemo(
    () => availableRoleTypes.find((roleType) => roleType.value === selectedRoleType) ?? null,
    [availableRoleTypes, selectedRoleType],
  )

  const teamFilters = React.useMemo<TeamFilter[]>(() => {
    const counts = new Map<string, number>()
    users.forEach((user) => {
      const key = user.teamName?.trim() || t('customers.roles.dialog.team.unassigned', 'No team')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return [
      { id: 'all', label: t('customers.roles.dialog.team.all', 'All'), count: users.length },
      ...Array.from(counts.entries()).map(([label, count]) => ({ id: label, label, count })),
    ]
  }, [t, users])

  const filteredUsers = React.useMemo(() => {
    if (activeTeam === 'all') return users
    return users.filter((user) => (user.teamName?.trim() || t('customers.roles.dialog.team.unassigned', 'No team')) === activeTeam)
  }, [activeTeam, t, users])

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

  const previewCard = selectedUser && selectedRole ? (
    <div className="rounded-[12px] border border-border/70 bg-muted/30 px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
        </div>
      </div>
    </div>
  ) : null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-[580px] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-[28px] font-semibold leading-none">
            {t('customers.roles.dialog.title', 'Assign role')}
          </DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('customers.roles.dialog.subtitle', 'Multi-role assignment for {{name}}', { name: entityName })}
          </p>
        </DialogHeader>

        <div className="border-b border-border/70 px-6 py-4">
          <div className="flex items-center justify-center gap-3 text-xs">
            <StepBadge step={1} currentStep={step} label={t('customers.roles.dialog.step1', 'Role type')} />
            <div className="h-px w-10 bg-border" />
            <StepBadge step={2} currentStep={step} label={t('customers.roles.dialog.step2', 'Select person')} />
            <div className="h-px w-10 bg-border" />
            <StepBadge step={3} currentStep={step} label={t('customers.roles.dialog.step3', 'Confirm')} />
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="rounded-[12px] bg-muted/30 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t('customers.roles.dialog.roleTypeLabel', 'Role type')}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <select
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
                    <Badge variant="outline" className="rounded-[6px] px-2 py-1 text-[10px]">
                      dictionary
                    </Badge>
                  ) : null}
                </div>
              </div>

              {!availableRoleTypes.length ? (
                <div className="rounded-[12px] border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                  {t('customers.roles.dialog.noAvailableRoles', 'All available role types are already assigned.')}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="rounded-[12px] bg-muted/30 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {t('customers.roles.dialog.roleTypeLabel', 'Role type')}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-lg font-semibold text-foreground">
                        {selectedRole?.label ?? selectedRoleType}
                      </span>
                      <Badge variant="outline" className="rounded-[6px] px-2 py-1 text-[10px]">
                        dictionary
                      </Badge>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
                    {t('customers.roles.dialog.change', 'Change')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t('customers.roles.dialog.teamLabel', 'Select a team member')}
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('customers.roles.dialog.searchPlaceholder', 'Search by name, e-mail or team...')}
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
                      className="h-7 rounded-[8px] px-2.5 text-[10px]"
                    >
                      {teamFilter.label}
                      <span className="rounded-full bg-background/80 px-1 text-[9px] text-muted-foreground">
                        {teamFilter.count}
                      </span>
                    </Button>
                  )
                })}
              </div>

              <div className="space-y-2">
                {loading ? (
                  <div className="rounded-[12px] border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t('customers.roles.loading', 'Loading...')}
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t('customers.roles.dialog.noResults', 'No matching team members found.')}
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = selectedUser?.id === user.id
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedUser(user)}
                        className={`flex w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
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
                            <span className="text-sm font-semibold text-foreground">{user.displayName}</span>
                            {user.teamName ? (
                              <Badge variant="muted" className="rounded-[6px] px-2 py-0.5 text-[9px] font-medium">
                                {user.teamName}
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
                      </button>
                    )
                  })
                )}
              </div>

              {previewCard}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              {previewCard}
              <p className="text-sm text-muted-foreground">
                {t('customers.roles.dialog.constraint', 'One person per role. The assignment can be changed at any time.')}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/70 px-6 py-4 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t('customers.roles.dialog.footerNote', 'One person per role · can be changed at any time')}
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
              <Button type="button" onClick={handleAssign} disabled={saving || !selectedUser || !selectedRoleType}>
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
        className={`flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
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
