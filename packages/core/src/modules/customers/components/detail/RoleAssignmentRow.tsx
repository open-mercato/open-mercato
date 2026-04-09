'use client'

import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

interface RoleAssignment {
  id: string
  roleType: string
  userId: string
  userName?: string
  userEmail?: string
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
      const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/staff/team-members?search=${encodeURIComponent(query)}&pageSize=20&isActive=true`,
      )
      const rawItems = Array.isArray(data?.items) ? data.items : []
      const deduped = new Map<string, LookupSelectItem>()
      for (const item of rawItems) {
        const userId =
          typeof item?.userId === 'string'
            ? item.userId
            : typeof item?.user_id === 'string'
              ? item.user_id
              : null
        if (!userId || deduped.has(userId)) continue
        const displayName =
          typeof item?.displayName === 'string' && item.displayName.trim().length
            ? item.displayName
            : typeof item?.display_name === 'string' && item.display_name.trim().length
              ? item.display_name
              : null
        const user =
          item?.user && typeof item.user === 'object'
            ? (item.user as Record<string, unknown>)
            : null
        const email =
          user && typeof user.email === 'string' && user.email.trim().length
            ? user.email
            : null
        deduped.set(userId, {
          id: userId,
          title: displayName ?? email ?? userId,
          subtitle: displayName && email ? email : null,
        })
      }
      return Array.from(deduped.values())
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
    }
    setRemoving(false)
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
    const words = name.trim().split(/\s+/)
    if (words.length === 0 || !words[0]) return '?'
    if (words.length === 1) return words[0].charAt(0).toUpperCase()
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
  }, [role.userName, role.userEmail])

  const displayName = role.userName ?? role.userEmail ?? role.userId

  return (
    <>
      {ConfirmDialogElement}
      <div className="flex items-center gap-3 rounded-md px-1 py-1.5">
        {/* Avatar circle */}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
          {initials}
        </div>

        {/* Role info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{roleTypeLabel}</span>
          </div>
          {changingUser ? (
            <div className="mt-0.5 text-xs">
              <LookupSelect
                value={role.userId}
                onChange={async (userId) => {
                  await handleUserChange(userId)
                  setChangingUser(false)
                }}
                fetchItems={searchUsers}
                options={currentUserOptions}
                placeholder={t('customers.roles.searchPlaceholder', 'Search team member...')}
              />
            </div>
          ) : (
            <span className="block truncate text-sm font-medium">{displayName}</span>
          )}
        </div>

        {/* Three-dot menu */}
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('customers.roles.moreActions', 'More actions')}
            >
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => {
                setChangingUser(true)
              }}
            >
              {t('customers.roles.changeUser', 'Change user')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={removing}
            >
              {t('customers.roles.remove', 'Remove role')}
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}

export type { RoleAssignment }
