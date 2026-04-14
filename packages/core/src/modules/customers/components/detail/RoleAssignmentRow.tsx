'use client'

import * as React from 'react'
import { Mail, Phone, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { fetchAssignableStaffMembers } from './assignableStaff'
import { getInitials } from './utils'

export interface RoleAssignment {
  id: string
  roleType: string
  userId: string
  userName?: string | null
  userEmail?: string | null
  userPhone?: string | null
  createdAt?: string
  updatedAt?: string
}

interface RoleAssignmentRowProps {
  role: RoleAssignment
  roleTypeLabel: string
  runMutationWithContext: <T,>(
    operation: () => Promise<T>,
    mutationPayload?: Record<string, unknown>,
  ) => Promise<T>
  entityType: 'company' | 'person'
  entityId: string
  onRemoved: () => void
  onUpdated: () => void
}

function formatAssignedAt(value: string | undefined, t: ReturnType<typeof useT>): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays <= 0) return t('customers.roles.assignedToday', 'Assigned today')
  if (diffDays === 1) return t('customers.roles.assignedYesterday', 'Assigned yesterday')
  return t('customers.roles.assignedDaysAgo', 'Assigned {{count}} days ago', { count: diffDays })
}

export function RoleAssignmentRow({
  role,
  roleTypeLabel,
  runMutationWithContext,
  entityType,
  entityId,
  onRemoved,
  onUpdated,
}: RoleAssignmentRowProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [removing, setRemoving] = React.useState(false)
  const [changingUser, setChangingUser] = React.useState(false)

  const searchUsers = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    try {
      const members = await fetchAssignableStaffMembers(query, { pageSize: 20 })
      return members.map((member) => ({
        id: member.userId,
        title: member.displayName,
        subtitle: member.displayName && member.email ? member.email : null,
      }))
    } catch (error) {
      console.error('customers.roles.searchUsers failed', error)
      return []
    }
  }, [])

  const handleUserChange = React.useCallback(async (userId: string | null) => {
    if (!userId || userId === role.userId) return
    const basePath = entityType === 'company' ? 'companies' : 'people'
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/customers/${basePath}/${entityId}/roles?roleId=${role.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId }),
          }),
        { roleId: role.id, userId },
      )
      setChangingUser(false)
      onUpdated()
    } catch (error) {
      console.error('customers.roles.update failed', error)
    }
  }, [entityId, entityType, onUpdated, role.id, role.userId, runMutationWithContext])

  const handleRemove = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('customers.roles.removeConfirm', 'Remove this role assignment?'),
      variant: 'default',
    })
    if (!confirmed) return

    setRemoving(true)
    const basePath = entityType === 'company' ? 'companies' : 'people'
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/customers/${basePath}/${entityId}/roles?roleId=${role.id}`, {
            method: 'DELETE',
          }),
        { roleId: role.id },
      )
      onRemoved()
    } catch (error) {
      console.error('customers.roles.remove failed', error)
    } finally {
      setRemoving(false)
    }
  }, [confirm, entityId, entityType, onRemoved, role.id, runMutationWithContext, t])

  const currentUserOptions = React.useMemo<LookupSelectItem[]>(
    () =>
      role.userId
        ? [{
            id: role.userId,
            title: role.userName ?? role.userEmail ?? role.userId,
            subtitle: role.userName && role.userEmail ? role.userEmail : null,
          }]
        : [],
    [role.userEmail, role.userId, role.userName],
  )

  const initials = React.useMemo(() => {
    const name = role.userName ?? role.userEmail ?? ''
    return getInitials(name || '?')
  }, [role.userEmail, role.userName])

  const displayName = role.userName ?? role.userEmail ?? role.userId
  const assignedLabel = formatAssignedAt(role.createdAt, t)

  return (
    <>
      {ConfirmDialogElement}
      <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Badge variant="outline" className="max-w-full break-words rounded-full px-2 py-0 text-left text-[10px] font-semibold">
            {roleTypeLabel}
          </Badge>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={removing}
            aria-label={t('customers.roles.remove', 'Remove role')}
          >
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="break-all text-sm font-semibold leading-5 text-foreground">{displayName}</div>
            {role.userEmail ? (
              <div className="mt-1 break-all text-xs text-muted-foreground">{role.userEmail}</div>
            ) : null}
            {assignedLabel ? (
              <div className="mt-2 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {assignedLabel}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {role.userEmail ? (
            <IconButton asChild variant="outline" size="sm" className="shrink-0">
              <a href={`mailto:${role.userEmail}`} aria-label={t('customers.roles.email', 'Send email')}>
                <Mail className="size-4" />
              </a>
            </IconButton>
          ) : (
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled
              aria-label={t('customers.roles.emailUnavailable', 'Email unavailable')}
            >
              <Mail className="size-4" />
            </IconButton>
          )}
          {role.userPhone ? (
            <IconButton asChild variant="outline" size="sm" className="shrink-0">
              <a href={`tel:${role.userPhone}`} aria-label={t('customers.roles.call', 'Call')}>
                <Phone className="size-4" />
              </a>
            </IconButton>
          ) : (
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled
              aria-label={t('customers.roles.phoneUnavailable', 'Phone unavailable')}
            >
              <Phone className="size-4" />
            </IconButton>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start px-2 py-1 text-xs sm:ml-auto sm:w-auto"
            onClick={() => setChangingUser((current) => !current)}
          >
            {t('customers.roles.changeUser', 'Change user')}
          </Button>
        </div>

        {changingUser ? (
          <div className="mt-4 border-t pt-4">
            <LookupSelect
              value={role.userId}
              onChange={async (userId) => {
                await handleUserChange(userId)
              }}
              fetchItems={searchUsers}
              options={currentUserOptions}
              placeholder={t('customers.roles.searchPlaceholder', 'Search team member...')}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
